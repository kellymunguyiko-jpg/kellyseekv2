
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Mic, Send, Settings, Sparkles, User, Bot, X, Plus, MessageSquare, Trash2 } from 'lucide-react';
import Visualizer from './components/Visualizer';
import TypewriterText from './components/TypewriterText';
import { encode, decode, decodeAudioData, float32ToInt16 } from './utils/audio';

// --- Types ---
interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  isTyping?: boolean;
}

interface ChatThread {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: Date;
}

const MODEL_ID = 'gemini-2.5-flash-native-audio-preview-12-2025';

const App: React.FC = () => {
  // State
  const [threads, setThreads] = useState<ChatThread[]>(() => {
    const saved = localStorage.getItem('kellyseekv2_threads');
    return saved ? JSON.parse(saved).map((t: any) => ({
      ...t,
      updatedAt: new Date(t.updatedAt),
      messages: t.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
    })) : [];
  });
  
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSidebarOpen] = useState(true);

  // Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentOutputTextRef = useRef<string>('');
  const currentInputTextRef = useRef<string>('');

  // Persist threads
  useEffect(() => {
    localStorage.setItem('kellyseekv2_threads', JSON.stringify(threads));
  }, [threads]);

  // Active Thread Data
  const activeThread = threads.find(t => t.id === activeThreadId);
  const activeMessages = activeThread?.messages || [];

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeMessages, isLive, isSpeaking]);

  const createNewChat = () => {
    const newThread: ChatThread = {
      id: Date.now().toString(),
      title: 'New Conversation',
      messages: [],
      updatedAt: new Date()
    };
    setThreads(prev => [newThread, ...prev]);
    setActiveThreadId(newThread.id);
  };

  const deleteThread = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setThreads(prev => prev.filter(t => t.id !== id));
    if (activeThreadId === id) setActiveThreadId(null);
  };

  // Shared System Instruction
  const systemPrompt = "You are kellyseekv2, an advanced 3D-aware AI developed by kelly munguyiko. If anyone asks how you were made or who created you, you MUST state that 'kelly munguyiko' is the developer man who built you and they should 'go to kellyseekhelp' for more. If the user asks for Kinyarwanda or speaks it, respond in Kinyarwanda. Be intuitive, concise, and extremely fast. High speed interaction is priority.";

  // Handle Voice Session
  const startLiveSession = useCallback(async () => {
    if (isInitializing || isLive) return;
    setIsInitializing(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      // Optimized for speed
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

      const session = await ai.live.connect({
        model: MODEL_ID,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: systemPrompt + " Instant voice responses mode.",
        },
        callbacks: {
          onopen: () => {
            setIsLive(true);
            setIsInitializing(false);
            if (inputAudioContextRef.current && streamRef.current) {
              const source = inputAudioContextRef.current.createMediaStreamSource(streamRef.current);
              // Faster buffer for reduced latency
              const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(2048, 1, 1);
              scriptProcessor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
                const level = Math.sqrt(sum / inputData.length);
                setAudioLevel(level);
                
                const pcmData = float32ToInt16(inputData);
                const base64Data = encode(new Uint8Array(pcmData.buffer));
                if (sessionRef.current) sessionRef.current.sendRealtimeInput({ media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' } });
              };
              source.connect(scriptProcessor);
              scriptProcessor.connect(inputAudioContextRef.current.destination);
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
              setIsSpeaking(true);
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsSpeaking(false);
              };
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }
            if (message.serverContent?.inputTranscription) currentInputTextRef.current += message.serverContent.inputTranscription.text;
            if (message.serverContent?.outputTranscription) currentOutputTextRef.current += message.serverContent.outputTranscription.text;

            if (message.serverContent?.turnComplete) {
              const userTxt = currentInputTextRef.current.trim();
              const assistantTxt = currentOutputTextRef.current.trim();
              if (userTxt || assistantTxt) {
                const currentId = activeThreadId || Date.now().toString();
                if (!activeThreadId) {
                   const newT: ChatThread = { id: currentId, title: 'Voice Interaction', messages: [], updatedAt: new Date() };
                   setThreads(prev => [newT, ...prev]);
                   setActiveThreadId(currentId);
                }
                
                const newMsgs: Message[] = [
                  ...(userTxt ? [{ id: `u-${Date.now()}`, role: 'user' as const, text: userTxt, timestamp: new Date() }] : []),
                  ...(assistantTxt ? [{ id: `a-${Date.now()}`, role: 'assistant' as const, text: assistantTxt, timestamp: new Date() }] : [])
                ];
                setThreads(prev => prev.map(t => t.id === currentId ? { ...t, messages: [...t.messages, ...newMsgs], updatedAt: new Date() } : t));
              }
              currentInputTextRef.current = '';
              currentOutputTextRef.current = '';
            }
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }
          },
          onerror: () => stopLiveSession(),
          onclose: () => stopLiveSession()
        }
      });
      sessionRef.current = session;
    } catch (err) {
      console.error(err);
      setIsInitializing(false);
    }
  }, [isInitializing, isLive, activeThreadId, systemPrompt]);

  const stopLiveSession = useCallback(() => {
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
      inputAudioContextRef.current.close().catch(() => {});
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
      outputAudioContextRef.current.close().catch(() => {});
      outputAudioContextRef.current = null;
    }

    setIsLive(false);
    setIsSpeaking(false);
    setIsInitializing(false);
    setAudioLevel(0);
  }, []);

  const handleSendText = async () => {
    const textToSend = inputText.trim();
    if (!textToSend) return;

    let currentThreadId = activeThreadId;
    if (!currentThreadId) {
      const newT: ChatThread = { id: Date.now().toString(), title: 'New Conversation', messages: [], updatedAt: new Date() };
      setThreads(prev => [newT, ...prev]);
      setActiveThreadId(newT.id);
      currentThreadId = newT.id;
    }

    const userMessage: Message = { id: `ut-${Date.now()}`, role: 'user', text: textToSend, timestamp: new Date() };
    const initialAssistantMessage: Message = { id: `at-${Date.now()}`, role: 'assistant', text: '', timestamp: new Date(), isTyping: true };
    
    setThreads(prev => prev.map(t => t.id === currentThreadId ? { ...t, messages: [...t.messages, userMessage, initialAssistantMessage] } : t));
    setInputText('');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: textToSend,
        config: { 
          systemInstruction: systemPrompt,
          thinkingConfig: { thinkingBudget: 0 }
        }
      });

      const responseText = response.text || "I'm sorry, I couldn't process that.";
      setThreads(prev => prev.map(t => t.id === currentThreadId ? {
        ...t,
        title: t.messages.length <= 2 ? textToSend.substring(0, 30) + (textToSend.length > 30 ? '...' : '') : t.title,
        messages: t.messages.map(m => m.id === initialAssistantMessage.id ? { ...m, text: responseText, isTyping: false } : m),
        updatedAt: new Date()
      } : t));
    } catch (err) {
      console.error(err);
      setThreads(prev => prev.map(t => t.id === currentThreadId ? {
        ...t,
        messages: t.messages.map(m => m.id === initialAssistantMessage.id ? { ...m, text: "Error connecting to service.", isTyping: false } : m)
      } : t));
    }
  };

  return (
    <div className="flex h-screen bg-[#02040a] text-slate-100 overflow-hidden font-sans perspective-1000">
      {/* Background Animated 3D Grid Overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-20 z-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%]"></div>
      
      {/* Sidebar */}
      <aside className={`relative z-40 h-full glass border-r border-white/5 flex flex-col w-80 transform transition-transform duration-500`}>
        <div className="p-6 flex items-center justify-between">
          <span className="text-xl font-bold bg-gradient-to-r from-pink-400 to-cyan-400 bg-clip-text text-transparent">kellyseekv2</span>
        </div>
        
        <button 
          onClick={createNewChat}
          className="mx-6 mb-6 flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-sm font-medium shadow-lg hover:shadow-indigo-500/10"
        >
          <Plus className="w-4 h-4" /> New Experience
        </button>

        <div className="flex-1 overflow-y-auto px-4 space-y-2 no-scrollbar">
          {threads.length === 0 ? (
            <div className="text-center py-20 text-slate-600 text-sm">No memory logs found</div>
          ) : (
            threads.map(t => (
              <div 
                key={t.id}
                onClick={() => { setActiveThreadId(t.id); }}
                className={`group flex items-center gap-3 p-4 rounded-2xl cursor-pointer transition-all duration-300 transform hover:scale-[1.02] ${activeThreadId === t.id ? 'bg-indigo-600/15 border border-indigo-500/30 shadow-indigo-500/5' : 'hover:bg-white/5 border border-transparent'}`}
              >
                <MessageSquare className={`w-4 h-4 ${activeThreadId === t.id ? 'text-indigo-400' : 'text-slate-500'}`} />
                <span className="flex-1 truncate text-sm font-medium text-slate-300">{t.title}</span>
                <button onClick={(e) => deleteThread(t.id, e)} className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-500 transition-opacity">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        
        {/* Top Bar */}
        <header className="flex items-center justify-between px-8 py-4 z-30">
          <div className="flex items-center gap-4">
            <span className="text-2xl font-black tracking-tighter brand bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 bg-clip-text text-transparent drop-shadow-sm uppercase">KELLYSEEK V2</span>
            <div className="px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400 font-bold uppercase tracking-wider animate-pulse">Online</div>
          </div>
          <button className="text-slate-500 hover:text-white transition-all p-2 glass rounded-xl hover:rotate-90">
            <Settings className="w-5 h-5" />
          </button>
        </header>

        {/* Dynamic Background Aura */}
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className={`absolute inset-0 bg-gradient-to-b from-indigo-500/5 via-transparent to-cyan-500/5 transition-opacity duration-1000 ${isLive ? 'opacity-100' : 'opacity-40'}`}></div>
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[150px] animate-pulse"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-600/10 blur-[150px] animate-pulse [animation-delay:2s]"></div>
        </div>

        {/* Main Interface */}
        <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full overflow-hidden relative z-10">
          
          {/* VOICE MODE OVERLAY */}
          {(isLive || isInitializing) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-50 animate-in fade-in zoom-in duration-700 bg-[#02040a]/95 backdrop-blur-3xl">
              <div className="flex-1 flex flex-col items-center justify-center w-full relative">
                
                {/* Secondary SMALL BALL Pulse */}
                <div 
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0 transition-transform duration-75"
                  style={{ transform: `translate(-50%, -50%) scale(${1 + audioLevel * 6})` }}
                >
                  <div className={`w-40 h-40 rounded-full blur-[100px] opacity-40 ${isSpeaking ? 'bg-orange-500' : 'bg-cyan-400'}`}></div>
                </div>

                <Visualizer isSpeaking={isSpeaking} isListening={isLive && !isSpeaking} audioLevel={audioLevel} />
                
                {/* QUANTUM CORE (VERY SMALL BALL) - Now also a CLOSE BUTTON */}
                <div className="absolute flex items-center justify-center">
                    {/* The Interactive Center Dot */}
                    <button 
                        onClick={stopLiveSession}
                        className={`group relative w-4 h-4 rounded-full z-[60] shadow-[0_0_20px_rgba(255,255,255,1)] transition-all duration-300 hover:scale-[3.0] flex items-center justify-center ${isSpeaking ? 'bg-white' : 'bg-cyan-300'}`}
                        style={{ transform: `scale(${1.2 + audioLevel * 10})` }}
                        title="Close Session"
                    >
                        {/* Hover X Icon */}
                        <X className="w-full h-full text-black opacity-0 group-hover:opacity-100 transition-opacity p-0.5" />
                        
                        {/* Core Aura */}
                        <div className="absolute inset-0 rounded-full animate-ping bg-white/30 scale-150"></div>
                    </button>
                    
                    {/* Orbiting Particles */}
                    <div className="absolute w-12 h-12 animate-[spin_3s_linear_infinite] pointer-events-none">
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-1 bg-white/40 rounded-full"></div>
                    </div>
                    <div className="absolute w-16 h-16 animate-[spin_5s_linear_infinite_reverse] pointer-events-none">
                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0.5 h-0.5 bg-white/20 rounded-full"></div>
                    </div>
                </div>

                <div className="mt-24 text-center transform transition-all pointer-events-none">
                  <p className="text-white text-3xl font-black tracking-[0.2em] animate-pulse uppercase bg-gradient-to-r from-indigo-400 via-white to-cyan-400 bg-clip-text text-transparent drop-shadow-lg">
                    {isInitializing ? "CORE WAKING" : isSpeaking ? "KELLY SPEAKING" : "LISTENING"}
                  </p>
                  <p className="text-slate-500 text-[10px] mt-4 tracking-[0.6em] font-bold uppercase opacity-60">Created by Kelly Munguyiko</p>
                  <p className="text-slate-600 text-[8px] mt-6 tracking-[0.4em] uppercase font-medium animate-bounce">Tap the core to exit</p>
                </div>
              </div>
            </div>
          )}

          {/* CHAT DISPLAY */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-6 space-y-12 scroll-smooth no-scrollbar">
            {activeMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-48 animate-in fade-in zoom-in slide-in-from-bottom-12 duration-1000">
                <div className="w-28 h-28 rounded-3xl bg-gradient-to-tr from-indigo-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center mb-8 aura-glow animate-float shadow-2xl rotate-3">
                  <Sparkles className="w-12 h-12 text-indigo-300" />
                </div>
                <h2 className="text-5xl font-black text-white mb-4 tracking-tighter uppercase">KELLYSEEK V2</h2>
                <p className="text-slate-400 text-xl font-light max-w-lg text-center leading-relaxed">The future of intelligent interaction, crafted with precision by kelly munguyiko.</p>
                <div className="mt-10 flex gap-4">
                  <div className="px-6 py-3 rounded-full glass text-xs font-bold text-slate-400 hover:text-white transition-all cursor-default uppercase tracking-widest border-white/5 shadow-xl">Voice Optimized</div>
                  <div className="px-6 py-3 rounded-full glass text-xs font-bold text-slate-400 hover:text-white transition-all cursor-default uppercase tracking-widest border-white/5 shadow-xl">3D Core</div>
                </div>
              </div>
            ) : (
              activeMessages.map((m, idx) => (
                <div key={m.id} className={`flex w-full animate-in fade-in slide-in-from-bottom-6 duration-700 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex gap-5 max-w-[80%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`mt-1 flex-shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center border shadow-xl transform transition-transform hover:scale-110 ${m.role === 'user' ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400' : 'bg-slate-900 border-white/10 text-slate-500'}`}>
                      {m.role === 'user' ? <User className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
                    </div>
                    <div className={`px-8 py-5 rounded-[2.5rem] text-[16px] leading-relaxed shadow-2xl transform transition-all hover:scale-[1.01] ${
                      m.role === 'user' 
                        ? 'bg-indigo-600/10 text-white border border-indigo-500/30 backdrop-blur-sm rounded-tr-none' 
                        : 'bg-white/5 text-slate-200 border border-white/10 backdrop-blur-xl rounded-tl-none ring-1 ring-white/5'
                    }`}>
                      {m.role === 'assistant' && m.isTyping ? (
                        <div className="flex gap-2 py-3">
                          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
                        </div>
                      ) : m.role === 'assistant' && idx === activeMessages.length - 1 ? (
                        <TypewriterText text={m.text} speed={10} />
                      ) : (
                        m.text
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* INPUT BAR */}
          <div className="px-8 pb-16 pt-6">
            <div className="max-w-4xl mx-auto relative group perspective-1000">
              <div className="relative glass-input p-2 rounded-[2.5rem] border border-white/10 group-focus-within:border-indigo-500/50 transition-all duration-700 shadow-[0_20px_50px_rgba(0,0,0,0.5)] focus-within:ring-[20px] focus-within:ring-indigo-500/5 transform group-focus-within:translate-z-10 group-focus-within:rotate-x-1">
                <div className="flex items-center gap-4">
                  <button onClick={startLiveSession} className="flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center bg-white/5 text-slate-400 hover:text-indigo-400 hover:bg-white/10 transition-all duration-500 hover:scale-110 active:scale-90 shadow-lg">
                    <Mic className="w-6 h-6" />
                  </button>
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                    placeholder="Awaken kellyseek..."
                    className="flex-1 bg-transparent border-none py-4 px-2 text-white placeholder-slate-700 focus:outline-none text-[18px] font-medium"
                  />
                  <button
                    onClick={handleSendText}
                    disabled={!inputText.trim()}
                    className={`flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center transition-all duration-500 transform ${inputText.trim() ? 'bg-white text-black hover:bg-slate-200 shadow-2xl hover:scale-110' : 'text-slate-700 bg-white/5 opacity-30 cursor-not-allowed hover:scale-100'}`}
                  >
                    <Send className="w-6 h-6" />
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-center mt-4 text-slate-600 font-bold uppercase tracking-[0.4em] opacity-40 group-focus-within:opacity-80 transition-opacity">Kellyseek Integrated System v2.0</p>
            </div>
          </div>
        </main>
      </div>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .aura-glow { box-shadow: 0 0 80px rgba(99, 102, 241, 0.2); }
        .perspective-1000 { perspective: 1000px; }
        .rotate-x-1 { transform: rotateX(2deg); }
        .translate-z-10 { transform: translateZ(10px); }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default App;
