import type { ActionPlan } from '@murder-loop-ai/shared';
import { applyEventEffects } from './worldSimulator';
import type { CharacterId, EventEffect, WorldEvent, WorldState } from './worldTypes';

export type WorldInputEvent =
  | {
      type: 'player_called_police';
      minute: number;
      facts: string[];
    }
  | {
      type: 'player_photographed_package';
      minute: number;
      facts: string[];
    }
  | {
      type: 'player_sent_photo_to_linyue';
      minute: number;
      facts: string[];
    }
  | {
      type: 'player_lied_to_chen';
      minute: number;
      factId: string;
      confidence: number;
      facts: string[];
    }
  | {
      type: 'player_messaged_chen';
      minute: number;
      facts: string[];
    };

function hasPackagePhoto(world: WorldState) {
  return world.objects.package_photo.flags.exists === true
    || Boolean(world.knowledge.player.facts.package_photo);
}

function mentionsPackagePhoto(text: string) {
  const lower = text.toLowerCase();
  return lower.includes('photo') || lower.includes('picture') || lower.includes('package');
}

function mentionsCloset(text: string) {
  return text.toLowerCase().includes('closet');
}

export function buildWorldInputsFromPlayerPlan(plan: ActionPlan, world: WorldState): WorldInputEvent[] {
  const inputs: WorldInputEvent[] = [];
  let packagePhotoWillExist = hasPackagePhoto(world);

  for (const action of plan.actions) {
    const raw = `${action.raw} ${action.method ?? ''}`;

    if (action.intent === 'call_police') {
      inputs.push({
        type: 'player_called_police',
        minute: world.minute,
        facts: ['player_called_police', 'report_received', 'reported_fake_police'],
      });
      continue;
    }

    if (action.intent === 'preserve_evidence' && action.target === 'package') {
      packagePhotoWillExist = true;
      inputs.push({
        type: 'player_photographed_package',
        minute: world.minute,
        facts: ['player_photographed_package', 'package_photo_exists'],
      });
      continue;
    }

    if (action.intent === 'communicate' && action.target === 'linyue' && packagePhotoWillExist && mentionsPackagePhoto(raw)) {
      inputs.push({
        type: 'player_sent_photo_to_linyue',
        minute: world.minute,
        facts: ['player_sent_photo_to_linyue', 'linyue_has_package_photo'],
      });
      continue;
    }

    if (action.intent === 'deceive' && action.target === 'chen_huaimin') {
      inputs.push({
        type: 'player_lied_to_chen',
        minute: world.minute,
        factId: mentionsCloset(raw) ? 'package_in_closet' : 'player_false_statement',
        confidence: 0.65,
        facts: ['player_lied_to_chen'],
      });
      continue;
    }

    if (action.intent === 'communicate' && action.target === 'chen_huaimin') {
      inputs.push({
        type: 'player_messaged_chen',
        minute: world.minute,
        facts: ['player_messaged_chen'],
      });
    }
  }

  return inputs;
}

function inputEffects(input: WorldInputEvent): EventEffect[] {
  if (input.type === 'player_called_police') {
    return [
      {
        target: 'knowledge',
        targetId: 'real_police',
        op: 'add',
        path: 'facts.report_received',
        value: { confidence: 1, source: 'message', minuteLearned: input.minute },
        reason: 'Player report reaches real police dispatch.',
      },
      {
        target: 'knowledge',
        targetId: 'real_police',
        op: 'add',
        path: 'facts.reported_fake_police',
        value: { confidence: 0.9, source: 'message', minuteLearned: input.minute },
        reason: 'Player reports possible police impersonation.',
      },
      {
        target: 'character',
        targetId: 'real_police',
        op: 'add',
        path: 'goalStack',
        value: 'respond_to_report',
        reason: 'Police should respond after receiving a report.',
      },
    ];
  }

  if (input.type === 'player_photographed_package') {
    return [
      {
        target: 'object',
        targetId: 'package_photo',
        op: 'set',
        path: 'flags.exists',
        value: true,
        reason: 'Player photographed the package.',
      },
      {
        target: 'object',
        targetId: 'package',
        op: 'set',
        path: 'flags.photographed',
        value: true,
        reason: 'The package now has a photo record.',
      },
      {
        target: 'knowledge',
        targetId: 'player',
        op: 'add',
        path: 'facts.package_photo',
        value: { confidence: 1, source: 'seen', minuteLearned: input.minute },
        reason: 'Player directly created the package photo.',
      },
    ];
  }

  if (input.type === 'player_sent_photo_to_linyue') {
    return [
      {
        target: 'object',
        targetId: 'package_photo',
        op: 'set',
        path: 'flags.sharedWithLinYue',
        value: true,
        reason: 'Player sent the package photo to Lin Yue.',
      },
      {
        target: 'knowledge',
        targetId: 'lin_yue',
        op: 'add',
        path: 'facts.package_photo',
        value: { confidence: 1, source: 'message', minuteLearned: input.minute },
        reason: 'Lin Yue receives the package photo from the player.',
      },
      {
        target: 'character',
        targetId: 'lin_yue',
        op: 'add',
        path: 'goalStack',
        value: 'preserve_photo',
        reason: 'Lin Yue should preserve the external evidence after receiving it.',
      },
    ];
  }

  if (input.type === 'player_lied_to_chen') {
    return [
      {
        target: 'knowledge',
        targetId: 'chen_huaimin',
        op: 'add',
        path: `facts.${input.factId}`,
        value: { confidence: input.confidence, source: 'lied_by_other', minuteLearned: input.minute },
        reason: 'Player supplied Chen Huaimin with an unverified claim.',
      },
      {
        target: 'character',
        targetId: 'chen_huaimin',
        op: 'add',
        path: 'goalStack',
        value: input.factId === 'package_in_closet' ? 'investigate_closet' : 'verify_player_claim',
        reason: 'Chen Huaimin may act on a low-confidence player claim.',
      },
    ];
  }

  return [
    {
      target: 'knowledge',
      targetId: 'chen_huaimin',
      op: 'add',
      path: 'facts.player_contacted_chen',
      value: { confidence: 1, source: 'message', minuteLearned: input.minute },
      reason: 'Player message reaches Chen Huaimin.',
    },
    {
      target: 'character',
      targetId: 'chen_huaimin',
      op: 'inc',
      path: 'suspicion',
      value: 10,
      reason: 'Direct contact makes Chen Huaimin more suspicious.',
    },
  ];
}

function inputToWorldEvent(input: WorldInputEvent, sequence: number): WorldEvent {
  return {
    id: `input.${input.type}.${input.minute}.${sequence}`,
    minute: input.minute,
    type: input.type === 'player_called_police' || input.type === 'player_messaged_chen' ? 'message' : 'knowledge',
    actors: ['player'],
    facts: input.facts,
    visibility: 'player',
    effects: inputEffects(input),
    narrationHint: 'This event records a confirmed player-originated world input.',
  };
}

function uniqueCharacters(ids: CharacterId[]) {
  return [...new Set(ids)];
}

export function applyWorldInputs(current: WorldState, inputs: WorldInputEvent[]): WorldState {
  const state = structuredClone(current) as WorldState;
  state.pendingNarration = [];
  state.affectedCharacters = [];

  inputs.forEach((input, index) => {
    const event = inputToWorldEvent(input, index);
    state.events.push(event);
    state.pendingNarration.push(event);
    const affected = applyEventEffects(state, event);
    state.affectedCharacters = uniqueCharacters([...state.affectedCharacters, ...affected]);
  });

  return state;
}
