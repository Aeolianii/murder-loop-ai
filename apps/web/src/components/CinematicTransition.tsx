import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';

interface CinematicTransitionProps {
  kind: 'death' | 'survived';
  title: string;
  summary: string;
  method?: string | null;
  onComplete: () => void;
}

function splitSummary(summary: string) {
  const parts = summary
    .split(/(?<=[。！？!?])\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    first: parts[0] || summary,
    second: parts.slice(1, 3).join('') || '电子钟的冷光停在这一秒，房间里只剩下雨声。',
  };
}

export function CinematicTransition({ kind, title, summary, method, onComplete }: CinematicTransitionProps) {
  const [step, setStep] = useState(0);
  const lines = splitSummary(summary);
  const isDeath = kind === 'death';

  useEffect(() => {
    let cancelled = false;
    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const sequence = async () => {
      await wait(350);
      if (cancelled) return;
      setStep(1);
      await wait(2600);
      if (cancelled) return;
      setStep(2);
      await wait(3600);
      if (cancelled) return;
      setStep(3);
      await wait(2600);
      if (cancelled) return;
      setStep(4);
      // 不再自动消失——等玩家点击复活按钮
    };

    void sequence();
    return () => {
      cancelled = true;
    };
  }, [onComplete]);

  return (
    <motion.div
      className={`fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#030303] ${isDeath ? 'text-red-100' : 'text-zinc-100'}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.6, ease: 'easeInOut' }}
    >
      <div className="max-w-3xl px-6 text-center relative pointer-events-none">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.p
              key="ending-title"
              initial={{ opacity: 0, y: 18, filter: 'blur(12px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -18, filter: 'blur(12px)' }}
              transition={{ duration: 1.8, ease: [0.25, 1, 0.5, 1] }}
              className={`font-serif text-2xl md:text-4xl tracking-[0.18em] ${isDeath ? 'text-[#f0d8d8]' : 'text-[#e7f4ea]'}`}
            >
              {title}
            </motion.p>
          )}

          {step === 2 && (
            <motion.p
              key="ending-first"
              initial={{ opacity: 0, y: 14, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -14, filter: 'blur(10px)' }}
              transition={{ duration: 1.8, ease: [0.25, 1, 0.5, 1] }}
              className="font-serif text-xl md:text-2xl tracking-[0.1em] leading-[2]"
            >
              {lines.first}
            </motion.p>
          )}

          {step === 3 && (
            <motion.p
              key="ending-method"
              initial={{ opacity: 0, filter: 'blur(10px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, filter: 'blur(10px)' }}
              transition={{ duration: 1.8, ease: 'easeOut' }}
              className="font-serif text-lg md:text-xl tracking-[0.12em] leading-[2] text-zinc-400"
            >
              {method || lines.second}
            </motion.p>
          )}

          {step === 4 && (
            <motion.div
              key="ending-final"
              initial={{ opacity: 0, scale: 0.9, filter: 'blur(15px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 1.08, filter: 'blur(15px)' }}
              transition={{ duration: 2.2, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-8"
            >
              <p className="font-serif text-[24px] md:text-[34px] tracking-[0.24em] drop-shadow-2xl">
                {isDeath ? '下一轮，把这一秒记住。' : '这一轮，雨声终于远了一点。'}
              </p>
              <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.5, duration: 1 }}
                onClick={(e) => { e.stopPropagation(); onComplete(); }}
                className="pointer-events-auto px-8 py-3 border border-white/10 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-zinc-300 font-serif text-lg tracking-[0.15em]"
              >
                {isDeath ? '再次醒来' : '继续'}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={`absolute inset-0 pointer-events-none ${isDeath ? 'bg-[radial-gradient(ellipse_at_center,_transparent_0%,_rgba(60,0,0,0.45)_52%,_#000000_100%)]' : 'bg-[radial-gradient(ellipse_at_center,_transparent_0%,_rgba(18,50,35,0.28)_52%,_#000000_100%)]'} opacity-90`} />
      <div className="absolute bottom-8 font-mono text-[10px] tracking-[0.28em] text-zinc-700">CLICK TO SKIP</div>
    </motion.div>
  );
}
