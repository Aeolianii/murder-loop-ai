import React from 'react';
import { BookOpen, Compass, Eye, Feather, LockKeyhole, Volume2 } from 'lucide-react';
import { motion } from 'motion/react';
import type { PlayMode } from '../types';

interface StartMenuProps {
  audioEnabled: boolean;
  onEnableAudio: () => void;
  onStart: (mode: PlayMode) => void;
  onOpenEndings: () => void;
}

export function StartMenu({
  audioEnabled,
  onEnableAudio,
  onStart,
  onOpenEndings,
}: StartMenuProps) {
  return (
    <motion.div
      className="fixed inset-0 z-[80] overflow-y-auto bg-[#050507] text-zinc-100"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(120,113,108,0.12),transparent_34%),linear-gradient(to_bottom,#050507_0%,#08080a_58%,#030304_100%)]" />
      <main className="relative mx-auto flex min-h-[100svh] w-full max-w-5xl flex-col justify-center px-4 py-[max(2rem,env(safe-area-inset-top))] md:px-8">
        <div className="mb-8 text-center md:mb-12">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.025] text-zinc-500">
            <Eye className="h-5 w-5" />
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.42em] text-zinc-600">
            青荷公寓 · 23:47
          </p>
          <h1 className="mt-4 font-serif text-3xl tracking-[0.18em] text-zinc-100 md:text-5xl">
            雨夜回环
          </h1>
          <p className="mx-auto mt-4 max-w-lg font-serif text-sm leading-7 text-zinc-500 md:text-base">
            每一次醒来，都带回一块尚未拼合的真相。
          </p>
          <button
            type="button"
            aria-pressed={audioEnabled}
            disabled={audioEnabled}
            onClick={onEnableAudio}
            className="mx-auto mt-6 flex items-center gap-2 rounded-full border border-cyan-200/15 bg-cyan-200/[0.035] px-4 py-2 font-mono text-[11px] tracking-[0.16em] text-cyan-100/55 transition hover:border-cyan-200/30 hover:bg-cyan-200/[0.07] hover:text-cyan-100/80 disabled:cursor-default disabled:border-emerald-200/10 disabled:bg-emerald-200/[0.025] disabled:text-emerald-100/45"
          >
            <Volume2 className="h-3.5 w-3.5" />
            {audioEnabled ? '雨声已开启' : '开启雨声'}
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-3 md:gap-5">
          <button
            type="button"
            onClick={() => onStart('easy')}
            className="group flex min-h-44 flex-col rounded-2xl border border-amber-200/14 bg-amber-200/[0.035] p-5 text-left transition hover:-translate-y-1 hover:border-amber-200/30 hover:bg-amber-200/[0.065] md:min-h-52 md:p-6"
          >
            <Compass className="h-5 w-5 text-amber-200/65" />
            <span className="mt-7 font-serif text-xl text-zinc-100">简单模式</span>
            <span className="mt-3 text-xs leading-6 text-zinc-500">
              支持自然语言输入，也会根据已确认事实提供推荐行动。
            </span>
            <span className="mt-auto pt-5 font-mono text-[10px] uppercase tracking-widest text-amber-200/45">
              适合初次调查
            </span>
          </button>

          <button
            type="button"
            onClick={() => onStart('hard')}
            className="group flex min-h-44 flex-col rounded-2xl border border-rose-200/12 bg-rose-950/[0.08] p-5 text-left transition hover:-translate-y-1 hover:border-rose-200/25 hover:bg-rose-950/[0.14] md:min-h-52 md:p-6"
          >
            <LockKeyhole className="h-5 w-5 text-rose-200/55" />
            <span className="mt-7 font-serif text-xl text-zinc-100">困难模式</span>
            <span className="mt-3 text-xs leading-6 text-zinc-500">
              完全依靠自然语言行动与自己的判断推进调查。
            </span>
            <span className="mt-auto pt-5 text-[10px] leading-5 text-rose-200/45">
              困难模式无推荐行动，耗时可能较长。
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenEndings}
            className="group flex min-h-44 flex-col rounded-2xl border border-cyan-200/12 bg-cyan-950/[0.06] p-5 text-left transition hover:-translate-y-1 hover:border-cyan-200/25 hover:bg-cyan-950/[0.12] md:min-h-52 md:p-6"
          >
            <BookOpen className="h-5 w-5 text-cyan-200/55" />
            <span className="mt-7 font-serif text-xl text-zinc-100">结局一览</span>
            <span className="mt-3 text-xs leading-6 text-zinc-500">
              查看五种结局的解锁档案，并进入完整剧本复盘。
            </span>
            <span className="mt-auto flex items-center gap-2 pt-5 font-mono text-[10px] uppercase tracking-widest text-cyan-200/40">
              <Feather className="h-3 w-3" />
              档案室
            </span>
          </button>
        </div>
      </main>
    </motion.div>
  );
}
