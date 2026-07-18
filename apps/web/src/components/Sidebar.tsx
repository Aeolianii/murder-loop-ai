import { BookOpen, Brain, Gauge, Smartphone, X } from 'lucide-react';
import { useState } from 'react';
import { getClueAsset } from '../clueAssets';
import { type ClueReadMap, isClueUnread } from '../clueRevealState';
import type { Clue, CoordinationState } from '../types';

interface SidebarProps {
  clues: Clue[];
  coordination?: CoordinationState;
  recap?: string;
  sidebar?: {
    phone: { battery: number; recording: boolean; muted: boolean; newMessages: string[] };
    threat: { level: number; trend: string; label: string };
    timeLabel: string;
    phaseLabel: string;
    moodSignal: string;
    roomStatus: Array<{ item: string; state: string; icon: string }>;
  };
  readClues?: ClueReadMap;
  onClueSelect?: (clue: Clue) => void;
}

const STORY_BG = '你叫沈知夏，和前男友林越分手后，今天刚搬进青荷公寓 503。桌上有一个被拆开一半的纸箱，不是你买的。旧书、药板和写着 503 的数字纸条被塞在里面。你在第一轮中于 23:47 死亡，又带着模糊记忆回到 23:00。';

function slotLabel(slot: 'action' | 'ambient') {
  return slot === 'action' ? '行动回应' : '环境播报';
}

function scoreColor(total: number) {
  if (total < 78) return 'text-rose-300';
  if (total < 88) return 'text-amber-300';
  return 'text-emerald-300';
}

export function NewBadge() {
  return (
    <span className="shrink-0 rounded border border-amber-300/20 bg-amber-300/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
      NEW
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
            <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">TEXT</span>
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
          <span className="rounded bg-rose-500/20 px-1 py-0.5 font-mono text-[10px] text-rose-400">REC</span>
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

export function Sidebar({ clues, coordination, recap, sidebar, readClues = {}, onClueSelect }: SidebarProps) {
  const directorScores = coordination?.directorScores ?? [];
  const [showMemories, setShowMemories] = useState(false);

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
              {sidebar?.moodSignal && (
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                  <span className="text-xs italic text-zinc-500">{sidebar.moodSignal}</span>
                </li>
              )}
            </ul>
          </div>

          {directorScores.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                <Gauge className="h-3.5 w-3.5 text-zinc-600" />
                <h3 className="font-mono text-xs uppercase text-zinc-600">剧情导演</h3>
              </div>
              <div className="grid gap-3">
                {directorScores.slice(-3).map((score, index) => (
                  <div key={`${score.slot}-${score.source}-${index}`} className="rounded-lg border border-white/5 bg-zinc-900/40 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-xs text-zinc-400">{slotLabel(score.slot)}</span>
                      <span className={`font-mono text-sm ${scoreColor(score.total)}`}>{score.total}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-500">
                      <span>节奏 {score.pace}</span>
                      <span>泄露 {score.infoSafety}</span>
                      <span>规则 {score.ruleConsistency}</span>
                      <span>文笔 {score.prose}</span>
                    </div>
                    {score.issues.length > 0 && (
                      <p className="mt-2 text-xs leading-relaxed text-zinc-500">{score.issues[0]}</p>
                    )}
                  </div>
                ))}
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
          ID: S-503 // ENV: HOSTILE // V_0.3.1
        </div>
      </div>
    </aside>
  );
}
