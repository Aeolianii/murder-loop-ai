import { useLayoutEffect, useRef, useState } from 'react';
import { Loader2, BrainCircuit } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface InputAreaProps {
  onActionSubmit: (action: string) => void;
  onConfirmAction: () => void;
  onCancelAction: () => void;
  isParsing: boolean;
  confirmationText: string | null;
}

export function InputArea({ onActionSubmit, onConfirmAction, onCancelAction, isParsing, confirmationText }: InputAreaProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = input ? `${Math.min(textarea.scrollHeight, 88)}px` : '44px';
    textarea.scrollTop = textarea.scrollHeight;
  }, [input]);

  const submitCurrentInput = () => {
    if (!input.trim() || isParsing || confirmationText) return;
    onActionSubmit(input.trim());
    setInput('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitCurrentInput();
  };

  // Keyboard shortcut hint logic could go here
  
  return (
    <div className="relative z-10 shrink-0 bg-gradient-to-t from-[#08080a] via-[#08080a] to-transparent px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3 md:px-12 md:pb-10 md:pt-20">
      <div className="max-w-2xl mx-auto">
        <AnimatePresence mode="wait">
          {confirmationText ? (
            <motion.div
              key="confirmation"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="relative flex flex-col items-start justify-between gap-4 border-l border-indigo-900/40 py-2 pl-4 sm:flex-row sm:items-end sm:gap-6 md:pl-5"
            >
              <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-gradient-to-b from-transparent via-indigo-500/30 to-transparent"></div>
              <div className="mt-1 flex flex-1 gap-3 text-sm md:gap-4">
                <BrainCircuit className="w-5 h-5 text-indigo-500/60 shrink-0 mt-1" />
                <div>
                  <div className="text-zinc-600 font-mono text-[10px] mb-2 uppercase tracking-[0.2em]">系统解析 // System Parsing</div>
                  <div className="text-[#c9c9c9] font-serif text-base tracking-wide leading-relaxed">{confirmationText}</div>
                </div>
              </div>
              <div className="mb-1 flex shrink-0 items-center gap-4 self-end md:gap-5">
                <button 
                  onClick={onCancelAction}
                  className="font-mono text-xs text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-widest relative group"
                >
                  <span className="opacity-0 group-hover:opacity-100 absolute -left-3 transition-opacity">‹</span> 
                  重新选择 
                  <span className="text-[10px] text-zinc-600 ml-1">ESC</span>
                </button>
                <button 
                  onClick={onConfirmAction}
                  className="font-mono text-xs text-indigo-400 hover:text-indigo-300 transition-colors uppercase tracking-widest relative group"
                >
                  执行抉择 
                  <span className="text-[10px] text-indigo-500/50 ml-1">ENT</span>
                  <span className="opacity-0 group-hover:opacity-100 absolute -right-3 transition-opacity">›</span>
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.form
              key="input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onSubmit={handleSubmit}
              className="relative group w-full"
            >
              <div className="relative flex items-end justify-between border-l-2 border-transparent bg-gradient-to-r from-zinc-900/40 via-transparent to-transparent py-2 pl-4 transition-all duration-700 group-focus-within:border-zinc-500/30 md:py-3 md:pl-6">
                
                {/* Subtle prompt marker */}
                <div className="absolute left-[-2px] top-1/2 -translate-y-1/2 w-[2px] h-0 bg-zinc-300 transition-all duration-700 group-focus-within:h-3/4"></div>

                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="写下你的抉择..."
                  rows={1}
                  disabled={isParsing}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  className="max-h-24 flex-1 resize-none overflow-y-auto border-none bg-transparent py-2 font-serif text-xl leading-[1.35] tracking-wide text-[#e2e2e2] outline-none transition-all duration-500 placeholder:font-serif placeholder:text-zinc-700/60 md:max-h-28 md:py-3 md:text-3xl"
                  style={{ minHeight: '44px' }}
                />
                
                <div className="flex shrink-0 items-center pl-2 opacity-100 transition-opacity duration-500 md:pl-4">
                  <button
                    type="submit"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      submitCurrentInput();
                    }}
                    onClick={(event) => event.preventDefault()}
                    disabled={!input.trim() || isParsing}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-800/50 text-zinc-500 transition-all duration-500 hover:border-zinc-600 hover:bg-zinc-800/30 hover:text-zinc-200 disabled:opacity-30 disabled:hover:border-zinc-800/50 disabled:hover:bg-transparent disabled:hover:text-zinc-500 md:h-12 md:w-12"
                  >
                    {isParsing ? <Loader2 className="w-5 h-5 animate-spin" /> : <span className="font-serif text-lg tracking-widest ml-1">写</span>}
                  </button>
                </div>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
