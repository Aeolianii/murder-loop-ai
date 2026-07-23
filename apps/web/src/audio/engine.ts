import { Howl, Howler } from 'howler';

let masterVolume = 0.85;
let sfxVolume = 0.8;
let bgmVolume = 0.65;
let muted = false;
let rainLevel: 'muffled' | 'normal' | 'loud' = 'normal';
let initialized = false;
let initPromise: Promise<void> | null = null;

// Pool: sound ID → Howl instances (one per file variant)
const soundPool = new Map<string, Howl[]>();
// BGM instance
let bgmInstance: Howl | null = null;

const REPO_BASE = '/audio/repository';

interface AudioManifest {
  bgm?: string;
  sounds: Record<string, string[]>;
  endings?: Record<string, string>;
}

function sfxEffectiveVolume(): number {
  return sfxVolume * masterVolume;
}

function rainLevelMultiplier(): number {
  switch (rainLevel) {
    case 'muffled': return 0.5;
    case 'normal':  return 0.85;
    case 'loud':    return 1.0;
  }
}

function bgmEffectiveVolume(): number {
  return bgmVolume * masterVolume * rainLevelMultiplier();
}

async function loadManifest() {
  try {
    const resp = await fetch(`${REPO_BASE}/manifest.json`);
    if (!resp.ok) throw new Error(`manifest request failed: ${resp.status}`);
    const manifest = await resp.json() as AudioManifest;

    for (const [soundId, files] of Object.entries(manifest.sounds ?? {})) {
      if (!files || files.length === 0) continue;

      const howls = files.map(file => {
        const src = `${REPO_BASE}/${encodeURIComponent(file)}`;
        return new Howl({
          src: [src],
          volume: sfxEffectiveVolume(),
          preload: true,
        });
      });
      soundPool.set(soundId, howls);
    }

    if (manifest.bgm) {
      const bgmSrc = `${REPO_BASE}/${encodeURIComponent(manifest.bgm)}`;
      bgmInstance = new Howl({
        src: [bgmSrc],
        volume: bgmEffectiveVolume(),
        loop: true,
        preload: true,
      });
    }

    initialized = true;
  } catch (err) {
    console.warn('[audio] Failed to load manifest, audio disabled:', err);
  }
}

async function init() {
  if (initialized) return;
  if (!initPromise) {
    initPromise = loadManifest().finally(() => {
      initPromise = null;
    });
  }
  await initPromise;
}

function pickHowl(name: string): Howl | null {
  const pool = soundPool.get(name);
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function applyAllSfxVolume() {
  const v = sfxEffectiveVolume();
  for (const howls of soundPool.values()) {
    for (const h of howls) h.volume(v);
  }
}

function applyBgmVolume() {
  if (bgmInstance) bgmInstance.volume(bgmEffectiveVolume());
}

export const audio = {
  async init() {
    await init();
  },

  playSfx(name: string) {
    if (muted) return;
    const h = pickHowl(name);
    if (h) h.play();
  },

  playAmbient(name: string) {
    if (muted) return;
    const h = pickHowl(name);
    if (h) {
      // Ambients play once, not looped (looping handled by game logic)
      h.loop(false);
      h.play();
    }
  },

  // ---- BGM ----
  startBgm() {
    if (muted || !bgmInstance) return;
    if (!bgmInstance.playing()) {
      bgmInstance.volume(0);
      bgmInstance.play();
      bgmInstance.fade(0, bgmEffectiveVolume(), 3000);
    }
  },

  stopBgm() {
    if (!bgmInstance) return;
    bgmInstance.fade(bgmInstance.volume() as number, 0, 2000);
    setTimeout(() => bgmInstance?.stop(), 2000);
  },

  setRainLevel(level: 'muffled' | 'normal' | 'loud') {
    if (rainLevel === level) return;
    rainLevel = level;
    if (!muted && bgmInstance?.playing()) {
      bgmInstance.fade(bgmInstance.volume() as number, bgmEffectiveVolume(), 1500);
    }
  },

  // ---- Volume ----
  setMasterVolume(v: number) {
    masterVolume = v;
    if (muted) return;
    applyAllSfxVolume();
    applyBgmVolume();
  },

  setSfxVolume(v: number) {
    sfxVolume = v;
    if (muted) return;
    applyAllSfxVolume();
  },

  setBgmVolume(v: number) {
    bgmVolume = v;
    if (muted) return;
    applyBgmVolume();
  },

  getMasterVolume() { return masterVolume; },
  getSfxVolume() { return sfxVolume; },
  getBgmVolume() { return bgmVolume; },

  mute() {
    muted = true;
    for (const howls of soundPool.values()) {
      for (const h of howls) h.volume(0);
    }
    if (bgmInstance) bgmInstance.volume(0);
  },

  unmute() {
    muted = false;
    applyAllSfxVolume();
    applyBgmVolume();
  },

  isMuted() { return muted; },

  unlock() {
    // Create AudioContext early while user gesture is active, so Howler
    // instances created later by init() inherit a running context.
    if (!Howler.ctx) {
      (Howler as any).ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (Howler.ctx.state === 'suspended') {
      Howler.ctx.resume();
    }
    // Play a silent buffer to fully unlock the context on iOS/Safari
    const ctx = Howler.ctx as AudioContext;
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  },

  destroy() {
    for (const howls of soundPool.values()) {
      for (const h of howls) h.unload();
    }
    soundPool.clear();
    if (bgmInstance) bgmInstance.unload();
    bgmInstance = null;
    initialized = false;
    initPromise = null;
  },
};
