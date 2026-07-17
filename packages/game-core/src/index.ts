// 现有导出（保持不变）
export * from './state/createInitialState';
export * from './actions/fallbackParser';
export * from './rules/applyPlayerActions';
export * from './killer/knowledge';
export * from './killer/fallbackStrategy';
export * from './killer/applyKillerStrategy';
export * from './narration/fallbackNarration';
export * from './narration/buildNarrationContext';
export * from './memory/loopMemory';
export * from './context/ContextBuilder';
export * from './scoring/scoreRun';
export * from './loop/resolveTurn';
export * from './storyNodes/resolveStoryNode';
export * from './storyNodes/storyNodeTypes';
export * from './npc/fallbackNpc';
export * from './ambient/advanceAmbientTurn';
export * from './world/worldSimulator';
export * from './world/worldInputs';
export * from './world/syncGameWorld';
export * from './machines/gamePhaseMachine';

// Harness 架构新增导出
export { GameEventBus } from './events/EventBus';
export type { EventLogEntry } from './events/EventBus';
export { AgentRegistry } from './events/AgentRegistry';
export type { AgentRegistration, AgentHandler, AgentId } from './events/AgentRegistry';
export type { GameEventType, GameEvent, GameEventPayloads, EventHandler } from './events/eventTypes';
export { enforce, ContractViolationError } from './contracts/ArtifactContract';
export type { ArtifactContract } from './contracts/ArtifactContract';
