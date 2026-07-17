import { FileText, Search } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { getClueAsset } from '../clueAssets';
import type { Clue } from '../types';

interface ClueRevealModalProps {
  clue: Clue | null;
  open: boolean;
  onClose: () => void;
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
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 px-3 py-[max(1rem,env(safe-area-inset-top))] backdrop-blur-[3px] animate-[clueFade_160ms_ease-out] md:py-6"
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
        className="relative max-h-[calc(100svh-2rem)] w-full overflow-hidden rounded-lg border border-white/10 bg-black shadow-2xl outline-none animate-[clueRise_180ms_ease-out] md:w-[min(92vw,1180px)] md:max-h-[88vh]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="关闭线索预览"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-xl leading-none text-zinc-200 transition-colors hover:border-white/35 hover:bg-zinc-900/80 focus:outline focus:outline-1 focus:outline-white/60 md:h-9 md:w-9"
        >
          x
        </button>

        {asset ? (
          <figure className="relative flex h-[calc(100svh-2rem)] max-h-[760px] min-h-0 items-center justify-center bg-black md:h-[min(88vh,760px)] md:min-h-[420px]">
            <img
              src={asset.imageUrl}
              alt={clue.name}
              className="h-full w-full object-contain md:object-cover"
              draggable={false}
            />

            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,.38)_0%,transparent_18%,transparent_58%,rgba(0,0,0,.68)_100%)]" />

            <div className="pointer-events-none absolute left-4 top-4 max-w-[68%] md:left-6 md:top-6 md:max-w-[50%]">
              <p className="truncate font-mono text-xs tracking-widest text-zinc-300/70">发现新线索</p>
              <h2 className="mt-2 truncate font-serif text-lg text-zinc-100/80 md:text-xl">{clue.name}</h2>
            </div>

            <figcaption className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4 md:bottom-8 md:px-6">
              <div className="flex max-w-full items-start gap-2 rounded-lg bg-black/30 px-3 py-2 text-left text-zinc-200/85 backdrop-blur-[1px] md:max-w-[82%] md:items-center md:gap-3 md:rounded-full md:px-4">
                <Search className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300/65 md:mt-0 md:h-5 md:w-5" />
                <p className="line-clamp-3 font-serif text-sm leading-relaxed tracking-wide md:truncate md:text-lg">{clue.description}</p>
              </div>
            </figcaption>
          </figure>
        ) : (
          <section className="max-h-[calc(100svh-2rem)] overflow-y-auto bg-[#09090b] px-5 py-6 md:min-h-[320px] md:px-10 md:py-9">
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
                SOURCE: {clue.source}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
