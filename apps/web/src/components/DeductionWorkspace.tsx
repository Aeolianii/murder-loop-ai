import React, { useEffect, useState } from 'react';
import {
  Check,
  GitMerge,
  Link2,
  RotateCcw,
  Scale,
  Sparkles,
  X,
} from 'lucide-react';
import { KNOWLEDGE_DEFINITIONS } from '@murder-loop-ai/game-core/src/knowledge/knowledgeDefinitions';
import {
  evaluateKnowledgeCombination,
  type KnowledgeCombinationResult,
} from '@murder-loop-ai/game-core/src/knowledge/knowledgeInference';
import type { PlayerKnowledge, TruthDerivation } from '@murder-loop-ai/shared';
import { AnimatePresence, motion } from 'motion/react';
import {
  canStartTruthDerivation,
  isConfirmedPositiveKnowledge,
} from '../deductionWorkspace';
import {
  buildClueRelationMap,
  findRelatedDiscoveredClueIds,
} from '../knowledgeRelations';
import type { Clue } from '../types';

export type DeductionWorkspaceMode = 'inference' | 'truth';

interface DeductionWorkspaceProps {
  mode: DeductionWorkspaceMode | null;
  clues: Clue[];
  knowledge: PlayerKnowledge[];
  truth?: TruthDerivation;
  onClose: () => void;
  onSubmitTruth: () => Promise<boolean>;
}

interface CombinationFeedback {
  result: KnowledgeCombinationResult;
  matched: typeof KNOWLEDGE_DEFINITIONS;
}

const CLUE_RELATIONS = buildClueRelationMap(KNOWLEDGE_DEFINITIONS);

function toggleSelection(
  ids: string[],
  id: string,
  maximum = Number.POSITIVE_INFINITY,
) {
  if (ids.includes(id)) return ids.filter((item) => item !== id);
  return ids.length < maximum ? [...ids, id] : ids;
}

function SelectionMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
        selected
          ? 'border-amber-300/50 bg-amber-300/15 text-amber-200'
          : 'border-white/10 bg-black/20 text-transparent'
      }`}
    >
      <Check className="h-3 w-3" />
    </span>
  );
}

function InferenceWorkspace({
  clues,
  knowledge,
}: Pick<DeductionWorkspaceProps, 'clues' | 'knowledge'>) {
  const [selectedClueIds, setSelectedClueIds] = useState<string[]>([]);
  const [selectedKnowledgeIds, setSelectedKnowledgeIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<CombinationFeedback | null>(null);
  const selectableKnowledge = knowledge.filter(isConfirmedPositiveKnowledge);
  const selectedCount = selectedClueIds.length + selectedKnowledgeIds.length;
  const relatedClueIds = findRelatedDiscoveredClueIds({
    selectedClueIds,
    discoveredClueIds: clues.map((clue) => clue.id),
    relations: CLUE_RELATIONS,
  });
  const hasSelectedClue = selectedClueIds.length > 0;

  const clearFeedback = () => setFeedback(null);
  const reset = () => {
    setSelectedClueIds([]);
    setSelectedKnowledgeIds([]);
    setFeedback(null);
  };
  const evaluate = () => {
    const result = evaluateKnowledgeCombination({
      clueIds: selectedClueIds,
      knowledgeIds: selectedKnowledgeIds,
    });
    const matchedIds = new Set(result.matchedKnowledgeIds);
    setFeedback({
      result,
      matched: KNOWLEDGE_DEFINITIONS.filter((item) => matchedIds.has(item.id)),
    });
  };

  return (
    <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h3 className="font-serif text-lg text-zinc-100">原始线索</h3>
              <p className="mt-1 text-xs text-zinc-500">
                点击线索后，已发现的关联线索会自动高亮。
              </p>
            </div>
            <span className="font-mono text-[10px] text-zinc-600">
              已选 {selectedClueIds.length}
            </span>
          </div>
          {clues.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {clues.map((clue) => {
                const selected = selectedClueIds.includes(clue.id);
                const related = relatedClueIds.has(clue.id);
                const relationState = selected
                  ? 'selected'
                  : related
                    ? 'related'
                    : hasSelectedClue
                      ? 'dimmed'
                      : 'idle';
                return (
                  <button
                    key={clue.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setSelectedClueIds((ids) => toggleSelection(ids, clue.id));
                      clearFeedback();
                    }}
                    data-relation-state={relationState}
                    className={`flex gap-3 rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-amber-300/35 bg-amber-300/8'
                        : related
                          ? 'border-cyan-300/45 bg-cyan-300/[0.08] shadow-[0_0_24px_rgba(103,232,249,0.08)]'
                          : hasSelectedClue
                            ? 'border-white/5 bg-white/[0.015] opacity-45 hover:opacity-80'
                            : 'border-white/7 bg-white/[0.025] hover:border-white/15'
                    }`}
                  >
                    <SelectionMark selected={selected} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm text-zinc-200">
                        <span className="min-w-0 truncate">{clue.name}</span>
                        {related && (
                          <span className="shrink-0 rounded-full border border-cyan-300/25 px-1.5 py-0.5 font-mono text-[9px] text-cyan-200/75">
                            关联
                          </span>
                        )}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-zinc-500">
                        {clue.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-600">
              还没有能够参与推理的线索。
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h3 className="font-serif text-lg text-zinc-100">已确认结论</h3>
              <p className="mt-1 text-xs text-zinc-500">
                深层推理可以继续使用已经成立的结论。
              </p>
            </div>
            <span className="font-mono text-[10px] text-zinc-600">
              已选 {selectedKnowledgeIds.length}
            </span>
          </div>
          {selectableKnowledge.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {selectableKnowledge.map((item) => {
                const selected = selectedKnowledgeIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setSelectedKnowledgeIds((ids) =>
                        toggleSelection(ids, item.id),
                      );
                      clearFeedback();
                    }}
                    className={`flex gap-3 rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-cyan-300/35 bg-cyan-300/8'
                        : 'border-white/7 bg-white/[0.025] hover:border-white/15'
                    }`}
                  >
                    <SelectionMark selected={selected} />
                    <span className="min-w-0">
                      <span className="block text-sm text-zinc-200">{item.label}</span>
                      <span className="mt-1 block font-mono text-[10px] text-zinc-600">
                        L{item.stage ?? 0} · 真相 +{item.truthLayerContribution}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-600">
              当前还没有已确认结论；先尝试组合原始线索。
            </div>
          )}
        </section>
      </div>

      <aside className="flex min-h-[18rem] flex-col rounded-2xl border border-white/8 bg-black/25 p-4 lg:min-h-0">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-amber-300/70" />
          <h3 className="font-mono text-xs uppercase tracking-widest text-zinc-400">
            组合台
          </h3>
          <span className="ml-auto font-mono text-[10px] text-zinc-600">
            {selectedCount} 项依据
          </span>
        </div>

        <div className="mt-4 flex-1">
          {!feedback && (
            <div className="rounded-xl border border-dashed border-white/8 p-4 text-sm leading-relaxed text-zinc-500">
              选中线索或既有结论后进行组合。系统只检查固定规则，不会根据叙述猜测真相。
            </div>
          )}

          {feedback?.result.status === 'confirmed' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/5 p-4">
                <div className="flex items-center gap-2 text-emerald-200">
                  <Sparkles className="h-4 w-4" />
                  <span className="font-serif">推理成立</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-emerald-100/55">
                  这组信息能够直接支撑以下命题。
                </p>
              </div>
              {feedback.matched.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-amber-200/12 bg-amber-300/5 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm leading-relaxed text-zinc-100">{item.label}</p>
                    <span className="shrink-0 font-mono text-[10px] text-amber-300/70">
                      {item.category === 'hypothesis'
                        ? '待验证'
                        : `+${item.truthLayerContribution}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {feedback?.result.status === 'incomplete' && (
            <div className="rounded-xl border border-amber-300/18 bg-amber-400/5 p-4">
              <p className="font-serif text-amber-100">推理尚未闭合</p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                当前组合与某条规则有关，但还缺至少{' '}
                {feedback.result.closestMissingInputCount ?? 1} 项关键依据。
              </p>
            </div>
          )}

          {feedback?.result.status === 'unrelated' && (
            <div className="rounded-xl border border-zinc-400/12 bg-white/[0.025] p-4">
              <p className="font-serif text-zinc-300">暂时无法形成结论</p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-600">
                这些信息之间没有命中稳定的固定规则。它们可能属于生存资源、证据保全状态，或需要换一组依据。
              </p>
            </div>
          )}

          {(feedback?.result.unusedSelectionIds.length ?? 0) > 0 && (
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
              有 {feedback!.result.unusedSelectionIds.length} 项选择没有参与最接近的推理关系。
            </p>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={selectedCount === 0}
            className="flex items-center justify-center rounded-lg border border-white/8 px-3 py-2 text-zinc-500 transition hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="清空选择"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={evaluate}
            disabled={selectedCount === 0}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-amber-300/25 bg-amber-300/10 px-4 py-2.5 font-serif text-sm text-amber-100 transition hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <GitMerge className="h-4 w-4" />
            组合推理
          </button>
        </div>
      </aside>
    </div>
  );
}

function TruthWorkspace({
  knowledge,
  truth,
  onClose,
  onSubmitTruth,
}: Pick<
  DeductionWorkspaceProps,
  'knowledge' | 'truth' | 'onClose' | 'onSubmitTruth'
>) {
  const conclusions = knowledge.filter(isConfirmedPositiveKnowledge);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const canStart = canStartTruthDerivation(knowledge);

  if (!canStart) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-md rounded-2xl border border-dashed border-white/10 p-8 text-center">
          <Scale className="mx-auto h-8 w-8 text-zinc-700" />
          <h3 className="mt-4 font-serif text-xl text-zinc-300">真相尚不足以结案</h3>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600">
            至少需要一条正向结论。先在线索之间建立一个能够成立的判断。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-serif text-lg text-zinc-100">
            推导全部 {conclusions.length} 条结论
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            本次结案会使用你目前掌握的全部正向结论，不需要取舍。
          </p>
        </div>
        <span className="rounded-full border border-white/8 px-3 py-1 font-mono text-xs text-zinc-400">
          全部 {conclusions.length} 条结论
        </span>
      </div>
      <div className="mt-5 grid min-h-0 flex-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
        {conclusions.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.045] p-4 text-left"
            >
              <SelectionMark selected />
              <span className="min-w-0">
                <span className="block text-sm leading-relaxed text-zinc-200">
                  {item.label}
                </span>
                <span className="mt-2 block font-mono text-[10px] text-zinc-600">
                  L{item.stage ?? 0} · 真相 +{item.truthLayerContribution}
                </span>
              </span>
            </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.025] p-4 text-xs leading-relaxed text-zinc-500">
        当前真相层为 {truth?.stage ?? 'L0'} · {truth?.truthLayer ?? 0}/100。
        最终评分还会结合证据强度、外部留存、生还情况与循环代价。
      </div>
      <button
        type="button"
        disabled={submitting}
        onClick={async () => {
          setSubmitting(true);
          setSubmissionError(null);
          const accepted = await onSubmitTruth();
          if (accepted) {
            onClose();
            return;
          }
          setSubmissionError('真相推导未通过校验，请继续调查后再试。');
          setSubmitting(false);
        }}
        className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-5 py-3 font-serif text-amber-100 transition hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <Scale className="h-4 w-4" />
        {submitting ? '正在推导真相…' : '推导全部结论'}
      </button>
      {submissionError && (
        <p className="mt-3 text-center text-xs text-rose-300/75">
          {submissionError}
        </p>
      )}
    </div>
  );
}

export function DeductionWorkspace({
  mode,
  clues,
  knowledge,
  truth,
  onClose,
  onSubmitTruth,
}: DeductionWorkspaceProps) {
  useEffect(() => {
    if (!mode) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, onClose]);

  const title = mode === 'truth' ? '真相推导' : '结论推理';
  const subtitle = mode === 'truth'
    ? '使用当前全部已确认结论推导真相与结局'
    : '把客观线索与既有结论组合成可追溯的命题';

  return (
    <AnimatePresence>
      {mode && (
        <motion.div
          key={mode}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-0 backdrop-blur-md md:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.985 }}
            className="flex h-full w-full max-w-6xl flex-col overflow-hidden border-white/8 bg-[#0b0b0e] shadow-2xl md:h-[min(50rem,92vh)] md:rounded-2xl md:border"
          >
            <header className="flex items-start gap-4 border-b border-white/7 px-5 py-4 md:px-7 md:py-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-300/15 bg-amber-300/5 text-amber-200/70">
                {mode === 'truth'
                  ? <Scale className="h-5 w-5" />
                  : <GitMerge className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <h2 className="font-serif text-xl tracking-wide text-zinc-100">
                  {title}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  {subtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={`关闭${title}`}
                className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/7 text-zinc-600 transition hover:bg-white/5 hover:text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col p-4 md:p-6">
              {mode === 'inference' ? (
                <InferenceWorkspace clues={clues} knowledge={knowledge} />
              ) : (
                <TruthWorkspace
                  knowledge={knowledge}
                  truth={truth}
                  onClose={onClose}
                  onSubmitTruth={onSubmitTruth}
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
