import type {
  CompactPlayerContext,
  TurnBrief,
} from '@murder-loop-ai/ai-contracts';
import type {
  GameAsset,
  GameAssetKind,
  GameState,
} from '@murder-loop-ai/shared';

const PRODUCED_ASSET_KIND_BY_OPERATION = new Map<string, GameAssetKind>([
  ['photograph', 'image'],
  ['take_photo', 'image'],
  ['preserve_evidence', 'image'],
  ['record', 'audio'],
]);

export function listPlayerAvailableAssets(
  state: GameState,
): NonNullable<CompactPlayerContext['availableAssets']> {
  return Object.values(state.assets)
    .filter((asset) => (
      asset.ownerId === 'player'
      || asset.accessibleToActorIds.includes('player')
    ))
    .map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      label: asset.label,
      aliases: [...asset.aliases],
      ownerId: asset.ownerId,
      location: asset.location,
      sourceEntityIds: [...asset.sourceEntityIds],
      createdAt: { ...asset.createdAt },
    }))
    .sort((left, right) => (
      right.createdAt.run - left.createdAt.run
      || right.createdAt.minute - left.createdAt.minute
      || left.id.localeCompare(right.id)
    ));
}

export function bindTurnAssets(state: GameState, input: TurnBrief): TurnBrief {
  const brief = structuredClone(input) as TurnBrief;
  const candidateById = new Map(brief.candidateHandles.map((handle) => [handle.id, handle]));
  const producedAssetIdsByAction = new Map<string, string[]>();
  const producedAssetKindById = new Map<string, GameAssetKind>();

  for (const action of brief.orderedActions) {
    const kind = PRODUCED_ASSET_KIND_BY_OPERATION.get(action.operation);
    if (!kind) continue;

    if (action.outputHandleIds.length === 0) {
      action.outputHandleIds.push(assetIdForAction(brief.turnId, action.actionId, kind));
    }
    for (const assetId of action.outputHandleIds) {
      producedAssetKindById.set(assetId, kind);
      if (!candidateById.has(assetId)) {
        const candidate = {
          id: assetId,
          kind,
          producedByActionId: action.actionId,
          dependsOnActionIds: [action.actionId],
        };
        brief.candidateHandles.push(candidate);
        candidateById.set(assetId, candidate);
      }
    }
    producedAssetIdsByAction.set(action.actionId, [...action.outputHandleIds]);
  }

  const availableAssetIds = new Set(Object.keys(state.assets));
  const isSendableAssetId = (assetId: string): boolean => {
    const kind = state.assets[assetId]?.kind
      ?? producedAssetKindById.get(assetId)
      ?? candidateById.get(assetId)?.kind;
    return kind === 'image' || kind === 'audio' || kind === 'document';
  };
  const communicationByActionId = new Map(
    brief.communications.map((communication) => [communication.actionId, communication]),
  );
  for (const action of brief.orderedActions) {
    const communication = communicationByActionId.get(action.actionId);
    if (!communication) continue;

    const attachmentAssetIds = new Set(
      communication.attachmentHandleIds.filter((assetId) => (
        (availableAssetIds.has(assetId) || candidateById.has(assetId))
        && isSendableAssetId(assetId)
      )),
    );

    if (attachmentAssetIds.size === 0) {
      for (const dependencyId of action.dependsOnActionIds) {
        for (const assetId of producedAssetIdsByAction.get(dependencyId) ?? []) {
          if (isSendableAssetId(assetId)) attachmentAssetIds.add(assetId);
        }
      }
    }

    if (attachmentAssetIds.size === 0) {
      const actionSpan = action.originalSpan;
      for (const reference of brief.resolvedReferences) {
        if (
          reference.originalSpan.start < actionSpan.start
          || reference.originalSpan.end > actionSpan.end
        ) continue;
        for (const entityId of reference.entityIds) {
          if (availableAssetIds.has(entityId) && isSendableAssetId(entityId)) {
            attachmentAssetIds.add(entityId);
          }
        }
      }
    }

    action.inputHandleIds = [...new Set([
      ...action.inputHandleIds,
      ...attachmentAssetIds,
    ])];
    communication.attachmentHandleIds = [...attachmentAssetIds];
  }

  return brief;
}

export function createProducedAsset(input: {
  id: string;
  kind: GameAssetKind;
  label: string;
  ownerId: string;
  location: string;
  aliases: string[];
  sourceEntityIds: string[];
  createdAt: GameAsset['createdAt'];
  createdByActionId: string;
  createdByEventId: string;
}): GameAsset {
  return {
    ...input,
    accessibleToActorIds: [input.ownerId],
    flags: {},
  };
}

export function grantAssetAccess(
  asset: GameAsset,
  actorId: string,
): GameAsset {
  return {
    ...asset,
    accessibleToActorIds: [...new Set([...asset.accessibleToActorIds, actorId])],
  };
}

function assetIdForAction(
  turnId: string,
  actionId: string,
  kind: GameAssetKind,
): string {
  const safeTurnId = normalizeIdPart(turnId);
  const safeActionId = normalizeIdPart(actionId);
  return `asset.${kind}.${safeTurnId}.${safeActionId}`;
}

function normalizeIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'generated';
}
