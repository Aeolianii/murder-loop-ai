import React, { useEffect, useState } from 'react';
import { FULL_STORY_RECAP } from '@murder-loop-ai/content';
import { BookOpen, Eye, EyeOff, X } from 'lucide-react';

interface ScriptBrowserProps {
  onClose: () => void;
  skipWarning?: boolean;
}

export function ScriptBrowser({
  onClose,
  skipWarning = false,
}: ScriptBrowserProps) {
  const [confirmed, setConfirmed] = useState(skipWarning);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!confirmed) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="script-warning-title"
          className="w-full max-w-lg rounded-2xl border border-rose-200/15 bg-[#0b0b0e] p-6 text-center shadow-2xl md:p-8"
        >
          <EyeOff className="mx-auto h-8 w-8 text-rose-200/55" />
          <h2 id="script-warning-title" className="mt-5 font-serif text-2xl text-zinc-100">
            完整剧透
          </h2>
          <p className="mt-4 text-sm leading-7 text-zinc-500">
            剧本浏览会公开所有人物动机、幕后行动和最终主谋，包括体验过程中无法从玩家视角直接获得的信息。
          </p>
          <div className="mt-7 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-white/8 px-4 py-3 text-sm text-zinc-500 transition hover:text-zinc-300"
            >
              返回档案
            </button>
            <button
              type="button"
              onClick={() => setConfirmed(true)}
              className="flex-1 rounded-xl border border-rose-200/20 bg-rose-200/[0.06] px-4 py-3 font-serif text-sm text-rose-100 transition hover:bg-rose-200/[0.1]"
            >
              继续浏览
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[110] overflow-y-auto bg-[#060608] text-zinc-200">
      <header className="sticky top-0 z-10 border-b border-white/7 bg-[#060608]/92 px-4 py-4 backdrop-blur-xl md:px-8">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          <BookOpen className="h-5 w-5 text-amber-200/55" />
          <div>
            <h2 className="font-serif text-xl text-zinc-100">剧本浏览</h2>
            <p className="mt-1 text-[10px] tracking-widest text-zinc-600">
              从第一次死亡到真相被解开
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭剧本浏览"
            className="ml-auto flex h-10 w-10 items-center justify-center rounded-full border border-white/8 text-zinc-500 transition hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-12">
        <div className="space-y-5">
          {FULL_STORY_RECAP.map((chapter, index) => (
            <article
              key={chapter.id}
              className="relative overflow-hidden rounded-2xl border border-white/7 bg-white/[0.018] p-5 md:p-7"
            >
              <span className="absolute right-5 top-4 font-mono text-4xl text-white/[0.025]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/45">
                {chapter.time}
              </p>
              <h3 className="mt-3 font-serif text-xl text-zinc-100 md:text-2xl">
                {chapter.title}
              </h3>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <section className="rounded-xl border border-cyan-200/8 bg-cyan-950/[0.045] p-4">
                  <div className="flex items-center gap-2 text-cyan-100/55">
                    <Eye className="h-3.5 w-3.5" />
                    <h4 className="font-mono text-[10px] uppercase tracking-widest">
                      玩家视角
                    </h4>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    {chapter.playerView}
                  </p>
                </section>
                <section className="rounded-xl border border-rose-200/8 bg-rose-950/[0.045] p-4">
                  <div className="flex items-center gap-2 text-rose-100/55">
                    <EyeOff className="h-3.5 w-3.5" />
                    <h4 className="font-mono text-[10px] uppercase tracking-widest">
                      幕后真相
                    </h4>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    {chapter.hiddenTruth}
                  </p>
                </section>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
