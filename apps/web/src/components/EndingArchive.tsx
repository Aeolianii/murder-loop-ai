import React, { useEffect, useState } from 'react';
import { ENDING_CATALOG } from '@murder-loop-ai/content';
import {
  BookOpen,
  DoorClosed,
  FileCheck2,
  FileClock,
  LockKeyhole,
  MailQuestion,
  Trophy,
  Unlink2,
  X,
} from 'lucide-react';
import type { PlayerProgress } from '../playerProgress';
import { ScriptBrowser } from './ScriptBrowser';

const ENDING_ICONS = {
  S: FileCheck2,
  A: FileClock,
  B: Unlink2,
  C: MailQuestion,
  D: DoorClosed,
} as const;

interface EndingArchiveProps {
  progress: PlayerProgress;
  onClose: () => void;
}

export function EndingArchive({ progress, onClose }: EndingArchiveProps) {
  const [scriptOpen, setScriptOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !scriptOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, scriptOpen]);

  const unlockedCount = Object.keys(progress.unlockedEndings).length;

  return (
    <>
      <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#060608] text-zinc-200">
        <header className="sticky top-0 z-10 border-b border-white/7 bg-[#060608]/92 px-4 py-4 backdrop-blur-xl md:px-8">
          <div className="mx-auto flex max-w-6xl items-center gap-4">
            <Trophy className="h-5 w-5 text-amber-200/55" />
            <div>
              <h2 className="font-serif text-xl text-zinc-100">结局一览</h2>
              <p className="mt-1 font-mono text-[10px] tracking-widest text-zinc-500">
                已解锁 {unlockedCount} / 5
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭结局一览"
              className="ml-auto flex h-10 w-10 items-center justify-center rounded-full border border-white/8 text-zinc-500 transition hover:text-zinc-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {ENDING_CATALOG.map((ending) => {
              const unlock = progress.unlockedEndings[ending.tier];
              const unlocked = Boolean(unlock);
              const VisualIcon = ENDING_ICONS[ending.tier];
              const visualTitle = ending.title;
              return (
                <article
                  key={ending.tier}
                  data-ending-tier={ending.tier}
                  data-ending-state={unlocked ? 'unlocked' : 'locked'}
                  data-ending-visual={visualTitle}
                  className={`relative min-h-64 overflow-hidden rounded-2xl border p-5 ${
                    unlocked
                      ? 'border-amber-200/18 bg-amber-200/[0.045]'
                      : 'border-white/5 bg-black/25 text-zinc-700 saturate-0'
                  }`}
                >
                  <div
                    className={`flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] ${
                      unlocked ? 'text-amber-100/70' : 'text-zinc-500'
                    }`}
                  >
                    <VisualIcon aria-hidden className="h-4 w-4" />
                    <span>{visualTitle}</span>
                  </div>
                  {unlocked && unlock ? (
                    <>
                      <p className="mt-7 text-xs leading-6 text-zinc-500">
                        {ending.narrative}
                      </p>
                      <div className="mt-5 border-t border-white/7 pt-4 font-mono text-[10px] leading-5 text-zinc-600">
                        <p>最佳评分 {unlock.bestScore}</p>
                        <p>解锁于 {unlock.unlockedAt.slice(0, 10)}</p>
                      </div>
                    </>
                  ) : (
                    <div className="mt-12 flex flex-col items-center text-center">
                      <LockKeyhole className="h-5 w-5 text-zinc-700" />
                      <h3 className="mt-4 font-serif text-base text-zinc-500">
                        封存档案
                      </h3>
                      <p className="mt-2 text-[10px] leading-5 text-zinc-500">
                        继续调查，抵达不同的真相评分。
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setScriptOpen(true)}
            className="mx-auto mt-8 flex w-full max-w-md items-center justify-center gap-3 rounded-xl border border-cyan-200/15 bg-cyan-950/[0.08] px-5 py-3 font-serif text-cyan-50/80 transition hover:border-cyan-200/30 hover:bg-cyan-950/[0.14]"
          >
            <BookOpen className="h-4 w-4" />
            剧本浏览
          </button>
          <p className="mt-3 text-center text-[10px] tracking-wide text-zinc-500">
            包含体验过程中无法从玩家视角直接获得的完整幕后信息
          </p>
        </main>
      </div>
      {scriptOpen && <ScriptBrowser onClose={() => setScriptOpen(false)} />}
    </>
  );
}
