import type { TurnEnvelope } from '@murder-loop-ai/ai-contracts';
import type { ShadowRunReport, ShadowSemanticRecord } from '@murder-loop-ai/game-core';

export type ShadowStoredPayload =
  | { kind: 'completed'; report: ShadowRunReport }
  | {
      kind: 'compiler_unavailable';
      envelope: TurnEnvelope;
      semantic: ShadowSemanticRecord;
    };

export interface ShadowReportRecord {
  turnId: string;
  envelope: TurnEnvelope;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  payload?: ShadowStoredPayload;
  error?: string;
}

export type ShadowReportSummary = Omit<ShadowReportRecord, 'payload'>;

export class ShadowReportStore {
  readonly #capacity: number;
  readonly #records = new Map<string, ShadowReportRecord>();

  constructor(capacity = 50) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Shadow report capacity must be a positive integer.');
    }
    this.#capacity = capacity;
  }

  begin(envelope: TurnEnvelope): ShadowReportRecord {
    if (this.#records.has(envelope.turnId)) {
      throw new Error(`Shadow report ${envelope.turnId} already exists.`);
    }
    const record: ShadowReportRecord = {
      turnId: envelope.turnId,
      envelope: structuredClone(envelope),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.#records.set(record.turnId, record);
    this.#evictOverflow();
    return cloneRecord(record);
  }

  complete(turnId: string, payload: ShadowStoredPayload): ShadowReportRecord {
    const current = this.#require(turnId);
    const record: ShadowReportRecord = {
      ...current,
      status: 'completed',
      completedAt: new Date().toISOString(),
      payload: structuredClone(payload),
      error: undefined,
    };
    this.#records.set(turnId, record);
    return cloneRecord(record);
  }

  fail(turnId: string, error: unknown): ShadowReportRecord {
    const current = this.#require(turnId);
    const record: ShadowReportRecord = {
      ...current,
      status: 'failed',
      completedAt: new Date().toISOString(),
      payload: undefined,
      error: error instanceof Error ? error.message : String(error),
    };
    this.#records.set(turnId, record);
    return cloneRecord(record);
  }

  get(turnId: string): ShadowReportRecord | undefined {
    const record = this.#records.get(turnId);
    return record ? cloneRecord(record) : undefined;
  }

  list(): ShadowReportSummary[] {
    return [...this.#records.values()]
      .reverse()
      .map((record) => {
        const { payload: _payload, ...summary } = cloneRecord(record);
        return summary;
      });
  }

  #require(turnId: string): ShadowReportRecord {
    const record = this.#records.get(turnId);
    if (!record) throw new Error(`Shadow report ${turnId} does not exist.`);
    return record;
  }

  #evictOverflow(): void {
    while (this.#records.size > this.#capacity) {
      const oldest = this.#records.keys().next().value as string | undefined;
      if (!oldest) return;
      this.#records.delete(oldest);
    }
  }
}

export const shadowReportStore = new ShadowReportStore();

function cloneRecord(record: ShadowReportRecord): ShadowReportRecord {
  return structuredClone(record) as ShadowReportRecord;
}
