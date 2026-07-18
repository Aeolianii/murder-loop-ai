import { useEffect, useRef } from 'react';
import { audio } from '../audio/engine';

const SRC = '/audio/repository/背景雨声/0_sleepy_times_rain_loop.wav';

export function RainPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = new Audio(SRC);
    el.loop = true;
    el.volume = audio.getBgmVolume();
    audioRef.current = el;

    // Start playing
    el.play().catch(() => {});

    // Poll: auto-resume if paused, sync volume & mute from engine
    const timer = setInterval(() => {
      if (el.paused) {
        el.play().catch(() => {});
      }
      const targetVol = audio.isMuted() ? 0 : audio.getBgmVolume();
      if (Math.abs(el.volume - targetVol) > 0.005) {
        el.volume = targetVol;
      }
    }, 500);

    return () => {
      clearInterval(timer);
      el.pause();
      el.src = '';
      el.remove();
    };
  }, []);

  return null; // invisible
}
