import type { ActionPlan, ParsedAction } from '@murder-loop-ai/shared';
import type { DomainTimestamp, PlayerCommand } from './domainEvents';

const parsedActionCoreKeys = new Set([
  'id',
  'raw',
  'intent',
  'target',
  'method',
  'confidence',
  'timeCost',
  'noise',
  'risk',
]);

function commandId(planId: string, actionId: string, index: number) {
  return `cmd-${planId}-${actionId || index}`;
}

function passthroughPayload(action: ParsedAction): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(action as unknown as Record<string, unknown>)) {
    if (parsedActionCoreKeys.has(key)) continue;
    payload[key] = value;
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
}

export function buildPlayerCommandFromParsedAction(
  plan: Pick<ActionPlan, 'id' | 'summary'>,
  action: ParsedAction,
  createdAt: DomainTimestamp,
  index = 0,
): PlayerCommand {
  return {
    id: commandId(plan.id, action.id, index),
    kind: 'command',
    source: 'parser',
    createdAt,
    causationId: plan.id,
    correlationId: plan.id,
    actor: 'player',
    commandType: action.intent,
    raw: action.raw,
    summary: plan.summary,
    actionId: action.id,
    target: action.target,
    method: action.method,
    confidence: action.confidence,
    timeCost: action.timeCost,
    noise: action.noise,
    risk: action.risk,
    payload: passthroughPayload(action),
  };
}

export function buildPlayerCommandsFromActionPlan(
  plan: ActionPlan,
  createdAt: DomainTimestamp,
): PlayerCommand[] {
  return plan.actions.map((action, index) =>
    buildPlayerCommandFromParsedAction(plan, action, createdAt, index)
  );
}
