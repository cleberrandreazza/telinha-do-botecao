import { useEffect, useRef } from 'react';

interface CrtEmptyStateProps {
  onOpenSidebar: () => void;
}

export default function CrtEmptyState({ onOpenSidebar }: CrtEmptyStateProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── Green-tinted CRT Static Noise ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = 160;
    const height = 120;
    canvas.width = width;
    canvas.height = height;
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;
    let animId: number;

    const render = () => {
      for (let i = 0; i < data.length; i += 4) {
        const rand = Math.random();
        const baseVal = rand * 255;
        if (rand > 0.88) {
          // Bright green sparks
          data[i] = 16;
          data[i + 1] = 222;
          data[i + 2] = 163;
          data[i + 3] = 240;
        } else if (rand > 0.5) {
          // Mid green tones
          data[i] = baseVal * 0.06;
          data[i + 1] = baseVal * 0.75;
          data[i + 2] = baseVal * 0.5;
          data[i + 3] = 220;
        } else {
          // Dark green base
          data[i] = baseVal * 0.02;
          data[i + 1] = baseVal * 0.45;
          data[i + 2] = baseVal * 0.25;
          data[i + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);

      // Random horizontal green interference lines
      if (Math.random() < 0.08) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
        ctx.fillRect(0, Math.random() * height, width, 1 + Math.random() * 3);
      }
      animId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="w-full h-full rounded-2xl md:rounded-3xl overflow-hidden border border-[#272a37] bg-[#0c0e13] shadow-2xl relative flex flex-col items-center justify-center p-6 select-none z-10">
      {/* CRT scanlines full-screen overlay */}
      <div className="absolute inset-0 crt-scanlines pointer-events-none opacity-20 z-10" />
      {/* Ambient glow */}
      <div className="absolute w-80 h-80 rounded-full bg-primary/5 blur-3xl pointer-events-none" />

      <div className="relative z-20 flex flex-col items-center text-center max-w-md w-full gap-5">

        {/* ── Retro CRT TV ── */}
        <div className="relative flex flex-col items-center select-none group/tv transition-transform duration-300">

          {/* Antennas */}
          <div className="relative z-10 flex items-end justify-center w-full h-9 mb-[-3px] pointer-events-none">
            <svg className="w-40 h-9 overflow-visible" fill="none" viewBox="0 0 160 36" xmlns="http://www.w3.org/2000/svg">
              {/* Left antenna */}
              <line x1="76" y1="34" x2="44" y2="6" stroke="#10b981" strokeWidth="2.5" strokeLinecap="square" />
              <line x1="44" y1="6" x2="40" y2="2" stroke="#10b981" strokeWidth="2.5" strokeLinecap="square" />
              <circle cx="40" cy="3" r="3" fill="#34d399" />

              {/* Right antenna */}
              <line x1="84" y1="34" x2="116" y2="6" stroke="#10b981" strokeWidth="2.5" strokeLinecap="square" />
              <line x1="116" y1="6" x2="120" y2="2" stroke="#10b981" strokeWidth="2.5" strokeLinecap="square" />
              <circle cx="120" cy="3" r="3" fill="#34d399" />

              {/* Center mount bar */}
              <rect x="70" y="29" width="20" height="7" rx="2.5" fill="#1e293b" stroke="#064e3b" strokeWidth="1" />
              <circle cx="80" cy="32.5" r="1.8" fill="#4edea3" />
            </svg>
          </div>

          {/* TV Body */}
          <div
            className="relative w-56 sm:w-64 h-40 sm:h-44 rounded-2xl bg-[#111827] p-2.5 shadow-2xl border-4 border-[#1f2937] flex items-stretch gap-2.5 ring-2 ring-[#059669]/40"
          >
            {/* Top highlight */}
            <div className="absolute inset-x-0 top-0 h-1.5 bg-white/[0.08] rounded-t-xl pointer-events-none" />
            {/* Bottom shadow */}
            <div className="absolute inset-x-0 bottom-0 h-2 bg-black/50 rounded-b-xl pointer-events-none" />

            {/* ── Screen area ── */}
            <div className="relative flex-1 rounded-xl overflow-hidden bg-[#064e3b] border-4 border-[#0f172a] shadow-[inset_0_0_14px_rgba(0,0,0,0.95)] flex items-center justify-center">
              {/* Green static canvas */}
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-cover"
              />
              {/* Scanlines */}
              <div className="absolute inset-0 crt-scanlines pointer-events-none opacity-50" />
              {/* Glare / shine */}
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.07] to-transparent pointer-events-none" />
              {/* CRT radial curvature / vignette */}
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.85)_100%)] pointer-events-none" />
            </div>

            {/* ── Side panel with knobs ── */}
            <div className="w-12 sm:w-14 rounded-xl bg-[#0f172a] border-2 border-[#1e293b] p-1.5 flex flex-col justify-between items-center shadow-inner relative">
              {/* Knobs */}
              <div className="flex flex-col items-center gap-2.5 pt-1 w-full">
                {/* Big channel knob */}
                <div className="relative w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#1e293b] border-2 border-[#10b981]/50 shadow-md flex items-center justify-center cursor-pointer transition-transform">
                  <div className="w-1 h-3 bg-[#34d399] rounded-full -translate-y-1.5" />
                  <div className="w-2 h-2 rounded-full bg-[#0f172a]" />
                </div>
                {/* Small volume knob */}
                <div className="relative w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#1e293b] border-2 border-[#10b981]/40 shadow-md flex items-center justify-center cursor-pointer transition-transform">
                  <div className="w-1 h-2.5 bg-[#34d399] rounded-full -translate-y-1" />
                  <div className="w-1.5 h-1.5 rounded-full bg-[#0f172a]" />
                </div>
              </div>

              {/* Speaker grille */}
              <div className="w-full flex flex-col items-center gap-1 px-1">
                <div className="w-full h-0.5 bg-[#334155] rounded-full" />
                <div className="w-full h-0.5 bg-[#334155] rounded-full" />
                <div className="w-full h-0.5 bg-[#334155] rounded-full" />
                <div className="w-full h-0.5 bg-[#334155] rounded-full" />
              </div>

              {/* PWR indicator */}
              <div className="flex items-center gap-1 pb-0.5">
                <div className="w-2 h-2 rounded-full bg-[#10b981] shadow-[0_0_6px_#10b981,0_0_12px_#10b981] animate-pulse" />
                <span className="font-label-mono text-[8px] font-bold text-[#6ee7b7] uppercase tracking-tighter">
                  PWR
                </span>
              </div>
            </div>
          </div>

          {/* TV Feet */}
          <div className="w-48 sm:w-56 h-3 flex items-center justify-between px-8 -mt-[1px]">
            <div className="w-5 h-2.5 bg-[#0b0f19] rounded-b-sm border-t border-[#1e293b]" />
            <div className="w-5 h-2.5 bg-[#0b0f19] rounded-b-sm border-t border-[#1e293b]" />
          </div>
        </div>

        {/* ── Text ── */}
        <div className="flex flex-col gap-1.5 items-center mt-1">
          <h3 className="font-headline-md text-[17px] sm:text-[19px] text-on-surface font-semibold tracking-tight">
            Voce nao esta assistindo nenhuma transmissao
          </h3>
          <p className="font-body-md text-[13px] text-on-surface-variant max-w-sm">
            Abra o menu lateral e confira quem esta transmitindo
          </p>
        </div>

        {/* ── Open Sidebar Button ── */}
        <button
          onClick={onOpenSidebar}
          className="px-5 py-2.5 rounded-xl bg-primary-container hover:bg-secondary-container text-on-primary-container font-label-lg text-label-lg font-semibold shadow-lg shadow-primary-container/20 hover:shadow-primary-container/30 transition-all flex items-center gap-2 cursor-pointer active:scale-95"
        >
          <span className="material-symbols-outlined text-[19px]">dock_to_right</span>
          <span>Abrir menu lateral</span>
        </button>
      </div>
    </div>
  );
}
