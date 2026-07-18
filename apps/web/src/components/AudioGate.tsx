import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { audio } from '../audio/engine';

interface AudioGateProps {
  onUnlock: () => void;
}

export function AudioGate({ onUnlock }: AudioGateProps) {
  const [show, setShow] = useState(true);

  const handleUnlock = async () => {
    audio.unlock();
    await audio.init(); // Load manifest and audio files (must complete before startBgm)
    setTimeout(() => {
      setShow(false);
      onUnlock();
    }, 300);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-[#030303]"
          exit={{ opacity: 0 }}
          transition={{ duration: 1.5 }}
        >
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 1.2 }}
            onClick={handleUnlock}
            className="px-10 py-4 border border-white/10 rounded text-zinc-300 font-serif text-lg tracking-[0.16em] hover:border-white/30 hover:text-white transition-colors"
          >
            进入 503
          </motion.button>
          <p className="mt-6 text-zinc-600 text-xs tracking-widest">
            建议佩戴耳机获得完整体验
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
