
import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isSpeaking: boolean;
  isListening: boolean;
  audioLevel?: number;
}

const Visualizer: React.FC<VisualizerProps> = ({ isSpeaking, isListening, audioLevel = 0 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<any[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;

    // Initialize particles for 3D effect
    if (particlesRef.current.length === 0) {
      for (let i = 0; i < 60; i++) { // More particles for "fast" feel
        particlesRef.current.push({
          x: Math.random() * 800,
          y: Math.random() * 800,
          size: Math.random() * 1.5 + 0.5,
          speedX: (Math.random() - 0.5) * 3,
          speedY: (Math.random() - 0.5) * 3,
          life: Math.random() * 100,
          color: i % 2 === 0 ? 'rgba(99, 102, 241, 0.4)' : 'rgba(34, 211, 238, 0.4)'
        });
      }
    }

    const blobConfigs = [
      { r: 120, speed: 0.015, phase: 0, drift: 30 },   
      { r: 140, speed: 0.01, phase: 2.1, drift: 40 }, 
      { r: 110, speed: 0.02, phase: 4.5, drift: 25 }, 
      { r: 130, speed: 0.012, phase: 1.2, drift: 35 }, 
      { r: 100, speed: 0.008, phase: 3.3, drift: 20 }, 
      { r: 90, speed: 0.025, phase: 5.7, drift: 25 },   
    ];

    const render = () => {
      // Fast animation speed
      time += isSpeaking ? 0.03 : 0.015;
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      const stateIntensity = isSpeaking ? 2.5 : (isListening ? 1.8 : 1.0);
      const audioPulse = audioLevel * 500; // More sensitive to level
      const breathe = Math.sin(time * 2) * 10;

      // Update Particles - Flowing into the core
      particlesRef.current.forEach(p => {
        p.x += p.speedX * stateIntensity;
        p.y += p.speedY * stateIntensity;
        p.life -= 0.5;
        
        // Gravity pull to center
        const dx = centerX - p.x;
        const dy = centerY - p.y;
        p.speedX += dx * 0.0001 * stateIntensity;
        p.speedY += dy * 0.0001 * stateIntensity;

        if (p.life <= 0 || p.x < 0 || p.x > 800 || p.y < 0 || p.y > 800) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 300 + Math.random() * 100;
          p.x = centerX + Math.cos(angle) * dist;
          p.y = centerY + Math.sin(angle) * dist;
          p.life = Math.random() * 100;
        }
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });

      let colors: string[] = [];
      let auraColor = '99, 102, 241';
      if (isSpeaking) {
        auraColor = '255, 120, 0';
        colors = ['rgba(255, 180, 0, 0.95)', 'rgba(255, 80, 0, 0.9)', 'rgba(255, 20, 100, 0.85)', 'rgba(255, 240, 50, 0.8)'];
      } else if (isListening) {
        auraColor = '0, 255, 238';
        colors = ['rgba(0, 255, 220, 0.95)', 'rgba(0, 240, 255, 0.9)', 'rgba(80, 180, 255, 0.85)', 'rgba(0, 130, 255, 0.8)'];
      } else {
        colors = ['rgba(130, 0, 255, 0.8)', 'rgba(0, 100, 255, 0.7)', 'rgba(255, 0, 200, 0.6)'];
      }

      // 1. Snappy Aura
      const auraRadius = (260 + breathe + audioPulse) * stateIntensity;
      const auraGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, auraRadius);
      auraGradient.addColorStop(0, `rgba(${auraColor}, ${isSpeaking || isListening ? 0.4 : 0.15})`);
      auraGradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = auraGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, auraRadius, 0, Math.PI * 2);
      ctx.fill();

      // 2. 3D BALL CORE Blobs
      ctx.globalCompositeOperation = 'screen';
      blobConfigs.forEach((config, i) => {
        const speedMult = isSpeaking ? 10 : (isListening ? 6 : 4);
        const rotationX = time * config.speed * speedMult + config.phase;
        const xOffset = Math.cos(rotationX) * config.drift * (0.5 + audioLevel * 2);
        const yOffset = Math.sin(rotationX * 0.9) * config.drift * (0.5 + audioLevel * 2);
        
        const x = centerX + xOffset;
        const y = centerY + yOffset;

        // Snappier radius reaction
        const currentRadius = (config.r + Math.sin(time * 5 + i) * 12 + audioPulse * 1.5) * (isListening || isSpeaking ? 1.1 : 0.85);

        const gradient = ctx.createRadialGradient(x, y, currentRadius * 0.05, x, y, currentRadius);
        gradient.addColorStop(0, colors[i % colors.length]);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, currentRadius, 0, Math.PI * 2);
        ctx.fill();
      });

      // 3. Fast Rotating Ring
      if (isSpeaking || isListening) {
        ctx.globalCompositeOperation = 'source-over';
        const ringRadius = (180 + audioPulse * 0.6) * stateIntensity;
        ctx.beginPath();
        ctx.strokeStyle = isSpeaking ? `rgba(255, 220, 100, ${0.3 + audioLevel})` : `rgba(100, 255, 255, ${0.3 + audioLevel})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([20, 40]);
        ctx.lineDashOffset = -time * 100;
        ctx.ellipse(centerX, centerY, ringRadius, ringRadius * 0.8, Math.PI / 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 4. THE SMALL BALL (Super Core)
      const coreSize = (30 + audioPulse * 0.4) * stateIntensity;
      const coreGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreSize);
      coreGradient.addColorStop(0, '#fff');
      coreGradient.addColorStop(0.3, isSpeaking ? '#ffcc00' : '#00ffff');
      coreGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = coreGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, coreSize, 0, Math.PI * 2);
      ctx.fill();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isSpeaking, isListening, audioLevel]);

  return (
    <div className={`relative flex items-center justify-center transition-all duration-300 ease-out transform ${
        (isSpeaking || isListening) ? 'scale-115' : 'scale-90'
      }`}>
      {/* Small Ball Glow Shadow */}
      <div className={`absolute inset-[-60px] rounded-full blur-[90px] transition-all duration-500 ${
        isSpeaking ? 'bg-orange-600/40' : (isListening ? 'bg-cyan-600/40' : 'bg-indigo-900/20')
      }`}></div>
      
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={800}
        height={800}
        style={{ 
          filter: 'blur(25px) contrast(160%) brightness(1.4)',
          mixBlendMode: 'screen'
        }}
        className="w-full h-full"
      />

      {/* Glossy Ball Effect */}
      <div className="absolute inset-4 rounded-full bg-gradient-to-tr from-white/20 via-transparent to-black/40 pointer-events-none border border-white/20 shadow-[inset_0_0_50px_rgba(255,255,255,0.2)] backdrop-blur-[1px]"></div>
    </div>
  );
};

export default Visualizer;
