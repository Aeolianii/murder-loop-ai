import { useEffect, useRef, useCallback } from 'react';
import type { ActionAudioCue } from '@murder-loop-ai/shared';
import { audio } from './engine';
import { actionSfxMap, killerSfxMap, ambientByPhase, getHeartbeatByThreat } from './mappings';

interface GameAudioParams {
  phase: string /* GamePhase */;
  threat: number;
  killerType?: string | null;
  actionIntents?: string[];
  actionAudioCue?: ActionAudioCue | null;
  isCinematic?: boolean;
  newClueAdded?: boolean;
  turnCompleted?: boolean;
}

export function useGameAudio(params: GameAudioParams) {
  const {
    phase, threat, killerType, actionIntents, actionAudioCue,
    isCinematic, newClueAdded, turnCompleted,
  } = params;

  const prevPhase = useRef(phase);
  const threatLevelRef = useRef<'low' | 'mid' | 'high'>(
    threat >= 70 ? 'high' : threat >= 45 ? 'mid' : 'low',
  );

  const killerTypeRef = useRef(killerType);
  killerTypeRef.current = killerType;

  // player action sfx → gap → environmental response sfx (sequenced)
  useEffect(() => {
    if (!actionIntents?.length) return;

    let totalActionTime = 0;
    if (actionAudioCue) {
      audio.playSfx(actionAudioCue.soundId);
      totalActionTime = 600;
    } else {
      const actionSfxNames: string[] = [];
      for (const intent of actionIntents) {
        const sfxList = actionSfxMap[intent];
        if (!sfxList?.length) continue;
        for (const name of sfxList) actionSfxNames.push(name);
      }

      if (actionSfxNames.length > 0) {
        actionSfxNames.forEach((name, i) => {
          setTimeout(() => audio.playSfx(name), i * 80);
        });
        totalActionTime = actionSfxNames.length * 600 + (actionSfxNames.length - 1) * 80;
      }
    }

    const kt = killerTypeRef.current;
    if (kt) {
      const killerSfxList = killerSfxMap[kt];
      if (killerSfxList?.length) {
        setTimeout(() => {
          killerSfxList.forEach((name, i) => {
            setTimeout(() => audio.playSfx(name), i * 150);
          });
        }, totalActionTime + 10);
      }
    }
  }, [actionIntents, actionAudioCue]);

  // killer-only trigger (no player action, e.g. passive killer event)
  useEffect(() => {
    if (actionIntents?.length) return; // handled above with sequencing
    if (!killerType) return;
    const sfxList = killerSfxMap[killerType];
    if (!sfxList?.length) return;
    sfxList.forEach((name, i) => {
      setTimeout(() => audio.playSfx(name), i * 150);
    });
  }, [killerType, actionIntents]);

  // ambient on phase change
  useEffect(() => {
    if (prevPhase.current === phase) return;
    prevPhase.current = phase;
    const ambientName = ambientByPhase[phase as keyof typeof ambientByPhase];
    if (ambientName) {
      audio.playAmbient(ambientName);
    }
  }, [phase]);

  // heartbeat by threat
  useEffect(() => {
    const newLevel = threat >= 70 ? 'high' : threat >= 45 ? 'mid' : 'low';
    if (newLevel !== threatLevelRef.current) {
      threatLevelRef.current = newLevel;
      const hb = getHeartbeatByThreat(threat);
      if (hb) audio.playAmbient(hb);
    }
  }, [threat]);

  // new clue ding
  useEffect(() => {
    if (newClueAdded) audio.playSfx('clue_new');
  }, [newClueAdded]);

  // lower sfx during cinematics
  useEffect(() => {
    if (isCinematic) {
      audio.setSfxVolume(0.2);
    } else {
      audio.setSfxVolume(0.8);
    }
  }, [isCinematic]);

  // threat-up ping on turn end
  useEffect(() => {
    if (turnCompleted && threat >= 50) {
      audio.playSfx('threat_up');
    }
  }, [turnCompleted, threat]);
}

export function useAmbientBgm(active: boolean) {
  useEffect(() => {
    if (active) {
      audio.startBgm();
    } else {
      audio.stopBgm();
    }
    return () => audio.stopBgm();
  }, [active]);
}

export function usePlaySfx() {
  return useCallback((name: string) => audio.playSfx(name), []);
}
