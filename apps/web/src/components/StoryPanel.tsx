import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { StoryNode } from '../types';

interface StoryPanelProps {
  log: StoryNode[];
}

export function StoryPanel({ log }: StoryPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [log]);

  return (
    <div 
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-3 scroll-smooth md:px-12 md:py-8"
    >
      <div className="mx-auto max-w-2xl space-y-3 pb-5 md:space-y-8 md:pb-12">
        <AnimatePresence initial={false}>
          {log.map((node, index) => (
            <motion.div
              key={node.id}
              initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1], delay: index === log.length - 1 ? 0.1 : 0 }}
              className={`flex flex-col gap-1 ${
                node.type === 'player_input' ? 'items-end' : 'items-start'
              }`}
            >
              {node.type === 'narrative' && (
                <div className="w-full">
                  {node.timestamp && (
                    <div className="mb-2 font-mono text-[10px] tracking-widest text-zinc-600 md:mb-3 md:text-xs">— {node.timestamp}</div>
                  )}
                  <p className="whitespace-pre-wrap font-serif text-[17px] leading-[1.75] tracking-wide text-[#d6d6d6] md:text-[22px] md:leading-[2]">
                    {node.content}
                  </p>
                </div>
              )}
              
              {node.type === 'player_input' && (
                <div className="mr-1 max-w-[90%] rounded-lg border border-white/10 bg-zinc-900/90 px-4 py-2.5 font-sans text-sm text-zinc-200 shadow-lg md:mr-2 md:max-w-[82%] md:px-5 md:py-3 md:text-base">
                  <div className="font-mono text-[10px] text-zinc-500 tracking-[0.18em] uppercase mb-1">你发出</div>
                  <div className="leading-relaxed whitespace-pre-wrap">“{node.content}”</div>
                </div>
              )}

              {node.type === 'action_result' && (
                <div className="pl-4 border-l border-zinc-700/50 mt-2 space-y-3">
                  <p className="font-mono text-xs leading-relaxed text-zinc-400 md:text-sm">{node.content}</p>
                  {node.recommendedActions && node.recommendedActions.length > 0 && (
                    <div className="space-y-2 border-t border-zinc-800/80 pt-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">下一步建议</div>
                      <div className="space-y-2">
                        {node.recommendedActions.map((action) => (
                          <div key={action.id} className="rounded border border-zinc-800 bg-zinc-950/50 px-3 py-2">
                            <div className="text-xs leading-relaxed text-zinc-300 md:text-sm">{action.label}</div>
                            <div className="mt-1 text-[11px] leading-relaxed text-zinc-500 md:text-xs">{action.rationale}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {node.type === 'system' && (
                <div className="my-1.5 w-full text-center md:my-4">
                  <span className="font-mono text-xs text-zinc-600 tracking-[0.2em] uppercase">
                    [ {node.content} ]
                  </span>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
