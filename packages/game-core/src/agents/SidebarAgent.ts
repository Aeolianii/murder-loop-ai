import type { AgentRegistration } from '../events/AgentRegistry';
import type { GameState, StoryLogEntry } from '@murder-loop-ai/shared';

/**
 * 侧边栏状态 Agent。
 * 在每个回合完成后，汇总线索、手机、房间状态变化，
 * 为前端的右侧情报栏提供结构化数据。
 *
 * 订阅 TurnCompleted（优先级 95，在 UIAdapter 之前执行）。
 */
export interface SidebarPayload {
  /** 新发现的线索 */
  newClues: Array<{ id: string; name: string; detail: string }>;
  /** 线索状态变化 */
  clueUpdates: Array<{ id: string; change: string }>;
  /** 手机状态 */
  phone: {
    battery: number;
    recording: boolean;
    muted: boolean;
    newMessages: string[];
  };
  /** 威胁指示器 */
  threat: {
    level: number;          // 0-100
    trend: 'rising' | 'falling' | 'stable';
    label: string;
  };
  /** 时间 */
  timeLabel: string;
  /** 阶段 */
  phaseLabel: string;
  /** 氛围信号 */
  moodSignal: string;
  /** NPC 状态摘要 */
  npcStatus: Array<{ name: string; status: string; risk: 'safe' | 'warning' | 'danger' }>;
  /** 房间状态摘要 */
  roomStatus: Array<{ item: string; state: string; icon: string }>;
}

const PHASE_LABELS: Record<string, string> = {
  intro: '序幕',
  loop_started: '循环开始',
  investigating: '搜证中',
  killer_pressure: '凶手施压',
  police_called: '已报警',
  false_police_arrived: '警察到场',
  pre_2347_countdown: '23:47 倒计时',
  post_2347_escalation: '23:47 后',
  escape_attempt: '逃生',
  confrontation: '对峙',
  death: '死亡',
  survived: '生还',
  ending: '终局',
};

function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60) + 23;
  const m = minute % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function threatLabel(level: number): string {
  if (level >= 80) return '极度危险';
  if (level >= 60) return '高度威胁';
  if (level >= 40) return '压力上升';
  if (level >= 20) return '轻微不安';
  return '相对平静';
}

function roomItemIcon(item: string, state: Record<string, unknown>): string {
  if (item === 'front_door') return state.barricaded ? '🚪🔒' : state.locked ? '🚪' : '🚪⚠️';
  if (item === 'window') return state.opened ? '🪟⚠️' : state.locked ? '🪟🔒' : '🪟';
  if (item === 'phone') return state.recording ? '📱🔴' : state.battery !== undefined && (state.battery as number) < 20 ? '📱🔋' : '📱';
  if (item === 'package') return state.opened ? '📦✅' : state.photographed ? '📦📸' : '📦';
  if (item === 'chair') return state.movedToDoor ? '🪑🚪' : '🪑';
  return '📌';
}

function buildNpcStatus(state: GameState): SidebarPayload['npcStatus'] {
  const result: SidebarPayload['npcStatus'] = [];

  // 林越
  const linRisk = ['endangered', 'injured', 'dead'].includes(state.linYuePhase)
    ? 'danger' as const
    : ['worried', 'calling_player', 'calling_police', 'coming_to_apartment'].includes(state.linYuePhase)
      ? 'warning' as const
      : 'safe' as const;
  result.push({ name: '林越', status: state.linYuePhase, risk: linRisk });

  // 陈怀民
  const chenRisk = ['violence', 'forced_entry', 'evidence_erasure'].includes(state.killerPhase)
    ? 'danger' as const
    : ['soft_pressure', 'deception', 'framing'].includes(state.killerPhase)
      ? 'warning' as const
      : 'safe' as const;
  result.push({ name: '陈怀民', status: state.killerPhase, risk: chenRisk });

  // 警察
  const policeRisk = state.policePhase === 'misled' ? 'danger' as const
    : ['real_police_en_route', 'arrived'].includes(state.policePhase) ? 'safe' as const
    : 'warning' as const;
  if (state.policePhase !== 'not_contacted') {
    result.push({ name: '警方', status: state.policePhase, risk: policeRisk });
  }

  return result;
}

function buildRoomStatus(state: GameState): SidebarPayload['roomStatus'] {
  if (!state.room) return [];
  return Object.entries(state.room).map(([key, obj]) => ({
    item: obj.name ?? key,
    state: Object.entries(obj.state ?? {}).filter(([, v]) => v === true).map(([k]) => k).join(', ') || '正常',
    icon: roomItemIcon(key, obj.state ?? {}),
  }));
}

export const SidebarAgent: AgentRegistration = {
  id: 'sidebar',
  subscriptions: [{ event: 'TurnCompleted', priority: 95, role: 'observer' }],
  contract: {
    version: '1.0.0',
    input: null as never,
    output: null as never,
    validate: false,
  },
  handler: async () => ({}),
  fallback: async (input: unknown) => {
    const payload = input as { finalState: GameState; moodSignal?: string };
    const state = payload.finalState;

    const sidebar: SidebarPayload = {
      newClues: [],
      clueUpdates: [],
      phone: {
        battery: (state.room?.phone?.state?.battery as number) ?? 100,
        recording: (state.room?.phone?.state?.recording as boolean) ?? false,
        muted: (state.room?.phone?.state?.muted as boolean) ?? false,
        newMessages: [],
      },
      threat: {
        level: state.threat,
        trend: state.threat > 60 ? 'rising' : state.threat < 30 ? 'falling' : 'stable',
        label: threatLabel(state.threat),
      },
      timeLabel: formatMinute(state.minute),
      phaseLabel: PHASE_LABELS[state.phase] ?? state.phase,
      moodSignal: payload.moodSignal ?? '',
      npcStatus: buildNpcStatus(state),
      roomStatus: buildRoomStatus(state),
    };

    return sidebar;
  },
  mode: 'fallback',
};
