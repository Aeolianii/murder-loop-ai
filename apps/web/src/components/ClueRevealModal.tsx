import { FileText, Search } from 'lucide-react';
import React, { useEffect, useRef } from 'react';
import { getClueAsset } from '../clueAssets';
import type { Clue } from '../types';

interface ClueRevealModalProps {
  clue: Clue | null;
  open: boolean;
  onClose: () => void;
}

function localizedClueSource(source: string): string {
  if (/[\u3400-\u9fff]/.test(source) && !/[A-Za-z]/.test(source)) return source;
  const labels: Record<string, string> = {
    ai: '实时推演',
    dynamic: '实时推演',
    rule: '现场检查',
    authored: '剧情记录',
    observation: '现场观察',
  };
  return labels[source.toLowerCase()] ?? '现场记录';
}

export function ClueRevealModal({ clue, open, onClose }: ClueRevealModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const asset = clue ? getClueAsset(clue.id) : null;

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || !clue) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/65 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-[3px] animate-[clueFade_160ms_ease-out] md:items-center md:px-3 md:py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`发现线索：${clue.name}`}
        tabIndex={-1}
        className="relative max-h-[calc(100svh-1rem)] w-full overflow-hidden rounded-t-2xl border border-white/10 bg-black shadow-2xl outline-none animate-[clueRise_180ms_ease-out] md:w-[min(92vw,1180px)] md:max-h-[88vh] md:rounded-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="关闭线索预览"
          onClick={onClose}
          className="absolute right-4 top-3.5 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/55 text-xl leading-none text-zinc-200 transition-colors hover:border-white/35 hover:bg-zinc-900/80 focus:outline focus:outline-1 focus:outline-white/60 md:right-3 md:top-3 md:h-9 md:w-9"
        >
          ×
        </button>

        {asset ? (
          <figure
            data-mobile-layout="stacked"
            className="relative flex max-h-[calc(100svh-1rem)] flex-col bg-[#070709] md:block md:h-[min(88vh,760px)] md:min-h-[420px]"
          >
            <header
              data-clue-section="header"
              className="relative z-10 shrink-0 border-b border-white/7 bg-[#09090b] px-4 py-4 pr-16 md:pointer-events-none md:absolute md:left-6 md:top-6 md:max-w-[50%] md:border-0 md:bg-transparent md:p-0"
            >
              <p className="truncate font-mono text-[10px] tracking-[0.18em] text-zinc-500 md:text-xs md:text-zinc-300/70">
                发现新线索
              </p>
              <h2 className="mt-1.5 line-clamp-2 font-serif text-lg leading-snug text-zinc-100 md:mt-2 md:truncate md:text-xl md:text-zinc-100/80">
                {clue.name}
              </h2>
            </header>

            <div
              data-clue-section="media"
              className="relative h-[38svh] min-h-[210px] max-h-[340px] shrink-0 overflow-hidden bg-black md:absolute md:inset-0 md:h-auto md:min-h-0 md:max-h-none"
            >
              <img
                src={asset.imageUrl}
                alt={clue.name}
                className="h-full w-full object-contain md:object-cover"
                draggable={false}
              />
              <div className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(to_bottom,rgba(0,0,0,.38)_0%,transparent_18%,transparent_58%,rgba(0,0,0,.68)_100%)] md:block" />
            </div>

            <figcaption
              data-clue-section="description"
              className="relative z-10 shrink-0 border-t border-white/7 bg-[#09090b] px-4 py-4 md:pointer-events-none md:absolute md:inset-x-0 md:bottom-8 md:flex md:justify-center md:border-0 md:bg-transparent md:px-6 md:py-0"
            >
              <div className="flex max-w-full items-start gap-2 rounded-xl bg-white/[0.035] px-3 py-2.5 text-left text-zinc-200/85 md:max-w-[82%] md:items-center md:gap-3 md:rounded-full md:bg-black/30 md:px-4 md:py-2 md:backdrop-blur-[1px]">
                <Search className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300/65 md:mt-0 md:h-5 md:w-5" />
                <p className="line-clamp-3 font-serif text-sm leading-relaxed tracking-wide md:truncate md:text-lg">{clue.description}</p>
              </div>
            </figcaption>
          </figure>
        ) : (
          <section className="max-h-[calc(100svh-1rem)] overflow-y-auto bg-[#09090b] pb-6 pl-5 pr-16 pt-5 md:min-h-[320px] md:px-10 md:py-9">
            <div className="mb-6 flex items-center gap-3 text-zinc-500">
              <FileText className="h-5 w-5" />
              <p className="font-mono text-xs uppercase tracking-widest">动态线索</p>
            </div>
            <h2 className="mb-4 font-serif text-2xl text-zinc-100">{clue.name}</h2>
            <p className="max-w-3xl whitespace-pre-wrap font-serif text-lg leading-relaxed text-zinc-300">
              {clue.description}
            </p>
            {clue.source && (
              <p className="mt-8 font-mono text-[11px] uppercase tracking-widest text-zinc-600">
                来源：{localizedClueSource(clue.source)}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
