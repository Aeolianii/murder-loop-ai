import { BookOpen, Brain, Smartphone, X } from 'lucide-react';
import React, { useState } from 'react';
import type { PlayerKnowledge, TruthDerivation } from '@murder-loop-ai/shared';
import { getClueAsset } from '../clueAssets';
import { type ClueReadMap, isClueUnread } from '../clueRevealState';
import type { Clue, TurnTimingState } from '../types';
import { TurnTimingPanel } from './TurnTimingPanel';

interface SidebarProps {
  clues: Clue[];
  knowledge?: PlayerKnowledge[];
  truth?: TruthDerivation;
  recap?: string;
  sidebar?: {
    phone: { battery: number; recording: boolean; muted: boolean; newMessages: string[] };
    threat: { level: number; trend: string; label: string };
    timeLabel: string;
    phaseLabel: string;
    roomStatus: Array<{ item: string; state: string; icon: string }>;
  };
  readClues?: ClueReadMap;
  onClueSelect?: (clue: Clue) => void;
  turnTiming?: TurnTimingState;
}

const STORY_BG = '你叫沈知夏，今天刚搬进青荷公寓 503。傍晚，房东陈怀民把钥匙交给你；维修工林越来检查过煤气管道。现在你在 23:00 醒来，后脑钝痛，桌上有一个被拆开一半的陌生纸箱。你只记得潮湿纸箱的霉味和一句压低的“东西呢？”。第一轮中，你在 23:47 死亡，又带着模糊记忆回到这里。';

export function NewBadge() {
  return (
    <span className="shrink-0 rounded border border-amber-300/20 bg-amber-300/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
      新
    </span>
  );
}

interface ClueItemProps {
  clue: Clue;
  unread: boolean;
  onSelect?: (clue: Clue) => void;
}

export function ClueItem({ clue, unread, onSelect }: ClueItemProps) {
  const hasImage = Boolean(getClueAsset(clue.id));

  return (
    <button
      type="button"
      onClick={() => onSelect?.(clue)}
      className={`w-full rounded-lg border p-3 text-left transition-colors focus:outline focus:outline-1 focus:outline-white/40 ${
        unread
          ? 'border-amber-200/20 bg-zinc-900/70 shadow-[inset_2px_0_0_rgba(251,191,36,.35)]'
          : 'border-white/5 bg-zinc-900/50'
      } hover:border-white/15 hover:bg-zinc-900/80`}
    >
      <div className="mb-1 flex items-start justify-between gap-3">
        <span className="font-sans text-sm text-zinc-200">{clue.name}</span>
        <span className="flex shrink-0 items-center gap-1">
          {!hasImage && (
            <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">文本</span>
          )}
          {unread && <NewBadge />}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-zinc-500">{clue.description}</p>
    </button>
  );
}

interface InventoryItemProps {
  sidebar?: SidebarProps['sidebar'];
}

export function InventoryItem({ sidebar }: InventoryItemProps) {
  return (
    <div className="rounded-lg border border-dashed border-white/5 bg-zinc-900/30 p-3">
      <div className="mb-1 flex items-center gap-2 font-sans text-sm text-zinc-400">
        <Smartphone className="h-3.5 w-3.5" />
        手机
        {sidebar?.phone.recording && (
          <span className="rounded bg-rose-500/20 px-1 py-0.5 font-mono text-[10px] text-rose-400">录音</span>
        )}
      </div>
      <p className="font-sans text-xs text-zinc-500">
        电量 {sidebar?.phone.battery ?? 60}%
        {sidebar?.phone.recording ? ' · 录音中' : ''}
        {sidebar?.phone.muted ? ' · 已静音' : ''}
        {(sidebar?.phone.newMessages?.length ?? 0) > 0 ? ` · ${sidebar!.phone.newMessages.length} 条新消息` : ''}
      </p>
    </div>
  );
}

export function Sidebar({
  clues,
  knowledge = [],
  truth,
  recap,
  sidebar,
  readClues = {},
  onClueSelect,
  turnTiming,
}: SidebarProps) {
  const [showMemories, setShowMemories] = useState(true);

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-white/5 bg-[#0a0a0c] lg:h-[calc(100vh-65px)] lg:w-80">
      <div className="flex-1 p-4 pt-4 md:p-6 lg:pt-6">
        <button
          type="button"
          onClick={() => setShowMemories(!showMemories)}
          className="mb-6 flex w-full items-center gap-2 rounded-lg border border-white/5 bg-zinc-900/40 px-3 py-2 text-left transition-colors hover:bg-zinc-900/60"
        >
          <BookOpen className="h-4 w-4 text-zinc-500" />
          <span className="font-mono text-xs uppercase tracking-widest text-zinc-400">前情 & 回忆</span>
          <span className="ml-auto text-xs text-zinc-600">{showMemories ? '收起' : '展开'}</span>
        </button>

        {showMemories && (
          <div className="mb-6 space-y-4 rounded-lg border border-white/5 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-xs uppercase text-zinc-500">故事背景</h3>
              <button type="button" onClick={() => setShowMemories(false)} className="text-zinc-600 hover:text-zinc-400">
                <X className="h-3 w-3" />
              </button>
            </div>
            <p className="font-sans text-xs leading-relaxed text-zinc-400">{STORY_BG}</p>
            {recap && recap !== STORY_BG && (
              <>
                <div className="border-t border-white/5" />
                <h3 className="font-mono text-xs uppercase text-zinc-500">前情提要</h3>
                {recap.split('\n').map((line, i) => (
                  <p key={`${line}-${i}`} className="font-sans text-xs leading-relaxed text-zinc-400">{line}</p>
                ))}
              </>
            )}
          </div>
        )}

        <TurnTimingPanel timing={turnTiming} />

        <div className="mb-6 flex items-center gap-2">
          <Brain className="h-4 w-4 text-zinc-500" />
          <h2 className="font-mono text-sm uppercase tracking-widest text-zinc-400">已知情报</h2>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="border-b border-white/5 pb-2 font-mono text-xs uppercase text-zinc-600">自身状态</h3>
            <ul className="space-y-2 font-sans text-sm text-zinc-400">
              <li className="flex items-center gap-2">
                <div className={`h-1.5 w-1.5 rounded-full ${(sidebar?.threat?.level ?? 0) >= 60 ? 'bg-rose-500' : (sidebar?.threat?.level ?? 0) >= 40 ? 'bg-amber-500' : 'bg-zinc-500'}`} />
                {sidebar?.threat?.label ?? '相对平静'}
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
                {sidebar?.phaseLabel ?? '循环开始'}
              </li>
            </ul>
          </div>

          {knowledge.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <h3 className="font-mono text-xs uppercase text-zinc-600">推理结论</h3>
                {truth && (
                  <span className="font-mono text-[10px] text-amber-300/80">
                    真相 {truth.stage} · {truth.truthLayer}/100
                  </span>
                )}
              </div>
              <div className="grid gap-2">
                {knowledge.map((item) => {
                  const isHypothesis = item.category === 'hypothesis';
                  const directKnowledgeCount = item.sourceKnowledgeIds?.length ?? 0;
                  return (
                    <div
                      key={item.id}
                      className={`rounded-lg border p-3 ${
                        isHypothesis
                          ? 'border-violet-300/10 bg-violet-950/10'
                          : 'border-amber-200/10 bg-amber-950/10'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-sans text-sm text-zinc-200">{item.label}</span>
                        <span className={`shrink-0 font-mono text-[10px] ${
                          isHypothesis ? 'text-violet-300/70' : 'text-amber-300/70'
                        }`}>
                          {isHypothesis ? '待验证' : `+${item.truthLayerContribution}`}
                        </span>
                      </div>
                      <p className="mt-1 font-sans text-[11px] leading-relaxed text-zinc-500">
                        {directKnowledgeCount > 0
                          ? `${directKnowledgeCount} 条前置结论 · ${item.sourceClueIds.length} 条底层线索`
                          : `${item.sourceClueIds.length} 条线索共同支持`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="border-b border-white/5 pb-2 font-mono text-xs uppercase text-zinc-600">线索 & 物品</h3>
            <div className="grid gap-3">
              {clues.map((clue) => (
                <ClueItem
                  key={clue.id}
                  clue={clue}
                  unread={isClueUnread(clue, readClues)}
                  onSelect={onClueSelect}
                />
              ))}
              <InventoryItem sidebar={sidebar} />
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-white/5 bg-black/20 p-4 text-center">
        <div className="break-all font-mono text-[10px] tracking-widest text-zinc-700">
          会话：503 // 环境：危险 // 版本：0.3.1
        </div>
      </div>
    </aside>
  );
}
