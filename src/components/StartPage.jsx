import { Network, ArrowRight } from 'lucide-react';

export default function StartPage({ onContinue }) {
  return (
    <div className="relative min-h-screen w-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center overflow-hidden select-none">
      {/* Ambient Radial Lighting */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] bg-indigo-600/15 rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[320px] h-[320px] bg-purple-600/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Decorative Grid Pattern */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(#818cf8 1.5px, transparent 1.5px)',
          backgroundSize: '32px 32px'
        }}
      />

      {/* Central Content */}
      <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-md">
        {/* Brand Icon Badge */}
        <div className="mb-6 p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl shadow-indigo-950/60 backdrop-blur-sm group hover:border-indigo-500/40 transition-all duration-300">
          <Network className="w-12 h-12 text-indigo-400 group-hover:scale-110 transition-transform duration-300" />
        </div>

        {/* Website Name */}
        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-white via-slate-100 to-indigo-300 mb-10 drop-shadow-sm">
          NoteGraph
        </h1>

        {/* Continue Button */}
        <button
          id="continue-button"
          onClick={onContinue}
          className="inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-xl text-base font-semibold text-white bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition-all duration-200 cursor-pointer shadow-lg shadow-indigo-600/30 hover:shadow-indigo-500/50 border border-indigo-400/30 group"
        >
          <span>Continue</span>
          <ArrowRight className="w-4 h-4 text-indigo-200 group-hover:translate-x-1 transition-transform duration-200" />
        </button>
      </div>
    </div>
  );
}
