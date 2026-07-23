import { Clock3 } from 'lucide-react';
import React from 'react';
import type { TurnTimingState } from '../types';

interface TurnTimingPanelProps {
  timing?: TurnTimingState;
}

const STAGE_LABELS: Record<string, string> = {
  'semantic-compiler': '语义解析',
  'main-world-model': '主世界模型',
  'player-specialist': '玩家行动裁决',
  'killer-specialist': '凶手行动决策',
  'environment-specialist': '环境事件生成',
  'clue-specialist': '线索判定',
  'recommendation-specialist': '后续行动推荐',
  'rule-commit': '规则校验与提交',
  'confirmed-narration': '行动与环境叙事',
  'audio-cue': '行动音效选择',
  presentation: '侧边栏与音效',
  'legacy-resolution': '回合处理',
  'legacy-parser': '玩家意图解析',
  'legacy-rule': '行动规则结算',
  'legacy-killer': '凶手行动决策',
  'legacy-npc': '角色响应',
  'legacy-narrator': '行动与环境叙事',
  'legacy-director': '剧情调度',
  'legacy-recommender': '后续行动推荐',
};

export function localizeTimingStage(stageId: string) {
  const exact = STAGE_LABELS[stageId];
  if (exact) return exact;
  if (stageId.startsWith('npc-specialist:lin_yue')) return '林越响应';
  if (stageId.startsWith('npc-specialist:police_dispatch')) return '警方响应';
  if (stageId.startsWith('npc-specialist')) return '角色响应';
  return '其他处理环节';
}

export function formatTimingDuration(durationMs: number) {
  const safeDuration = Math.max(0, durationMs);
  if (safeDuration < 1_000) return `${Math.round(safeDuration)} 毫秒`;
  return `${(safeDuration / 1_000).toFixed(2)} 秒`;
}

export function TurnTimingPanel({ timing }: TurnTimingPanelProps) {
  if (!timing || timing.entries.length === 0) return null;

  const maxDuration = Math.max(1, ...timing.entries.map((entry) => entry.durationMs));

  return (
    <details open className="mb-6 rounded-lg border border-cyan-300/10 bg-cyan-950/10">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 marker:hidden">
        <Clock3 className="h-4 w-4 text-cyan-300/70" />
        <span className="font-mono text-xs tracking-widest text-zinc-300">本回合耗时</span>
        <span className="ml-auto font-mono text-xs text-cyan-200">
          {formatTimingDuration(timing.wallClockMs)}
        </span>
      </summary>

      <div className="border-t border-white/5 px-3 pb-3 pt-3">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded bg-black/20 p-2">
            <div className="text-[10px] text-zinc-600">实际等待</div>
            <div className="mt-0.5 font-mono text-xs text-zinc-300">
              {formatTimingDuration(timing.wallClockMs)}
            </div>
          </div>
          <div className="rounded bg-black/20 p-2">
            <div className="text-[10px] text-zinc-600">环节合计</div>
            <div className="mt-0.5 font-mono text-xs text-zinc-300">
              {formatTimingDuration(timing.totalMs)}
            </div>
          </div>
        </div>

        {timing.slowest && (
          <div className="mb-3 rounded border border-amber-300/10 bg-amber-300/5 px-2.5 py-2 text-xs">
            <span className="text-zinc-600">最慢环节：</span>
            <span className="text-amber-100/80">{localizeTimingStage(timing.slowest.stageId)}</span>
            <span className="ml-1.5 font-mono text-amber-200/70">
              {formatTimingDuration(timing.slowest.durationMs)}
            </span>
          </div>
        )}

        <div className="space-y-2.5">
          {timing.entries.map((entry, index) => (
            <div key={`${entry.stageId}-${index}`}>
              <div className="mb-1 flex items-center justify-between gap-3 text-[11px]">
                <span className="truncate text-zinc-500">{localizeTimingStage(entry.stageId)}</span>
                <span className="shrink-0 font-mono text-zinc-400">
                  {formatTimingDuration(entry.durationMs)}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-cyan-300/40"
                  style={{ width: `${Math.max(2, (entry.durationMs / maxDuration) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[10px] leading-relaxed text-zinc-700">
          环节合计会分别计算并行任务，因此可能大于实际等待时间。
        </p>
      </div>
    </details>
  );
}
