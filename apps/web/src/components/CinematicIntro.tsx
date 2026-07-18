import { motion, AnimatePresence } from 'motion/react';
import { useCallback, useState } from 'react';

interface CinematicIntroProps {
  onComplete: () => void;
  recap?: string;
}

const TOTAL_STEPS = 4;

export function CinematicIntro({ onComplete }: CinematicIntroProps) {
  const [step, setStep] = useState(1);

  const advance = useCallback(() => {
    setStep(prev => {
      const next = prev + 1;
      if (next > TOTAL_STEPS) { onComplete(); return prev; }
      return next;
    });
  }, [onComplete]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#030303] cursor-pointer"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 2, ease: 'easeInOut' }}
      onClick={advance}
    >
      <div className="max-w-2xl px-6 text-center relative select-none">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.p key="s1" initial={{ opacity: 0, y: 12, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -12, filter: 'blur(8px)' }} transition={{ duration: 1.5, ease: [0.25, 1, 0.5, 1] }}
              className="text-[#d6d6d6] font-serif text-2xl md:text-3xl tracking-[0.16em]">
              23 点 47 分，你死了。
            </motion.p>
          )}
          {step === 2 && (
            <motion.p key="s2" initial={{ opacity: 0, y: 12, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -12, filter: 'blur(8px)' }} transition={{ duration: 1.5, ease: [0.25, 1, 0.5, 1] }}
              className="text-[#b2b2b2] font-serif text-xl md:text-2xl tracking-[0.12em] leading-[2]">
              伴随着令人窒息的剧痛，<br />与潮湿纸箱发霉的味道。
            </motion.p>
          )}
          {step === 3 && (
            <motion.p key="s3" initial={{ opacity: 0, filter: 'blur(8px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, filter: 'blur(8px)' }} transition={{ duration: 1.5, ease: "easeOut" }}
              className="text-zinc-600 font-serif text-2xl tracking-[0.3em]">……</motion.p>
          )}
          {step === 4 && (
            <motion.div key="s4" initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }} transition={{ duration: 2, ease: [0.22, 1, 0.36, 1] }}>
              <p className="text-[#f4f4f4] font-serif text-[28px] md:text-[36px] tracking-[0.25em] drop-shadow-2xl">再一次，醒来。</p>
              <p className="text-zinc-500 text-sm mt-8 tracking-[0.2em] animate-pulse">点击开始</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {step < TOTAL_STEPS && <div className="absolute bottom-12 text-zinc-700 text-xs tracking-[0.2em] animate-pulse">点击继续</div>}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_#000000_100%)] opacity-80 pointer-events-none"></div>
    </motion.div>
  );
}
