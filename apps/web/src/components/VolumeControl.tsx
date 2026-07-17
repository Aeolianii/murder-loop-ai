import { useState, useEffect } from 'react';
import { Volume2, VolumeX, Music, Zap } from 'lucide-react';
import { audio } from '../audio/engine';

export function VolumeControl() {
  const [muted, setMuted] = useState(() => audio.isMuted());
  const [bgmVolume, setBgmVolume] = useState(() => {
    const stored = localStorage.getItem('murder-loop-bgm-volume');
    return stored ? parseFloat(stored) : audio.getBgmVolume();
  });
  const [sfxVolume, setSfxVolume] = useState(() => {
    const stored = localStorage.getItem('murder-loop-sfx-volume');
    return stored ? parseFloat(stored) : audio.getSfxVolume();
  });

  useEffect(() => {
    localStorage.setItem('murder-loop-bgm-volume', String(bgmVolume));
  }, [bgmVolume]);

  useEffect(() => {
    localStorage.setItem('murder-loop-sfx-volume', String(sfxVolume));
  }, [sfxVolume]);

  const toggleMute = () => {
    if (muted) {
      audio.unmute();
      audio.setBgmVolume(bgmVolume);
      audio.setSfxVolume(sfxVolume);
      setMuted(false);
    } else {
      audio.mute();
      setMuted(true);
    }
  };

  const handleBgmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setBgmVolume(v);
    audio.setBgmVolume(v);
    if (muted) {
      setMuted(false);
      audio.unmute();
    }
  };

  const handleSfxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setSfxVolume(v);
    audio.setSfxVolume(v);
    if (muted) {
      setMuted(false);
      audio.unmute();
    }
  };

  return (
    <div className="flex items-center gap-2 md:gap-3">
      <button
        onClick={toggleMute}
        className="text-zinc-500 hover:text-zinc-300 transition-colors"
        title={muted ? '取消静音' : '静音'}
      >
        {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>

      <div className="hidden items-center gap-1.5 sm:flex" title="背景音乐">
        <Music className="w-3 h-3 text-zinc-500" />
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={muted ? 0 : bgmVolume}
          onChange={handleBgmChange}
          className="w-14 h-1 accent-amber-400/60"
        />
      </div>

      <div className="hidden items-center gap-1.5 sm:flex" title="互动音效">
        <Zap className="w-3 h-3 text-zinc-500" />
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={muted ? 0 : sfxVolume}
          onChange={handleSfxChange}
          className="w-14 h-1 accent-zinc-400"
        />
      </div>
    </div>
  );
}
