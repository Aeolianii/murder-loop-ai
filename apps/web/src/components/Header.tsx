import { Clock, House, MapPin } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { VolumeControl } from './VolumeControl';

interface HeaderProps {
  time: string;
  location: string;
  onRestart?: () => void;
}

export function Header({ time, location, onRestart }: HeaderProps) {
  const [confirming, setConfirming] = useState(false);

  const handleRestartClick = () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setConfirming(false);
    onRestart?.();
  };

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/5 bg-black/40 px-4 py-3 pr-16 backdrop-blur-md md:px-6 md:py-4 lg:pr-6">
      <div className="flex min-w-0 items-center gap-4 md:gap-6">
        <div className="flex items-center gap-2 font-mono text-base tracking-wider text-zinc-300 md:text-lg">
          <Clock className="w-4 h-4 text-zinc-500" />
          <motion.span
            key={time}
            initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
          >
            {time}
          </motion.span>
        </div>
        <div className="hidden h-4 w-px bg-white/10 sm:block" />
        <div className="hidden min-w-0 items-center gap-2 truncate font-sans text-sm text-zinc-400 sm:flex">
          <MapPin className="w-3.5 h-3.5" />
          {location}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        <VolumeControl />
        {onRestart && (
          <button
            type="button"
            onClick={handleRestartClick}
            className={`flex h-9 w-9 items-center justify-center rounded text-xs font-medium transition-colors md:h-auto md:w-auto md:gap-1.5 md:px-3 md:py-1.5 ${
              confirming
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-white/10'
            }`}
            title={confirming ? '再次点击返回主界面' : '返回主界面'}
            aria-label={confirming ? '确认返回主界面' : '返回主界面'}
          >
            <House className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{confirming ? '确认返回？' : '主界面'}</span>
          </button>
        )}
      </div>
    </header>
  );
}
