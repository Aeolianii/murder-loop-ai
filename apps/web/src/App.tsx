/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import type { ActionAudioCue } from '@murder-loop-ai/shared';
import { Header } from './components/Header';
import { StoryPanel } from './components/StoryPanel';
import { InputArea } from './components/InputArea';
import { Sidebar } from './components/Sidebar';
import { ClueRevealModal } from './components/ClueRevealModal';
import {
  DeductionWorkspace,
  type DeductionWorkspaceMode,
} from './components/DeductionWorkspace';
import { CinematicIntro } from './components/CinematicIntro';
import { CinematicTransition } from './components/CinematicTransition';
import { RainPlayer } from './components/RainPlayer';
import { VolumeControl } from './components/VolumeControl';
import { useGameAudio } from './audio/hooks';
import { audio } from './audio/engine';
import { Clue, GameState, type RecommendedAction } from './types';
import { Menu, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { getClueAsset } from './clueAssets';
import { ClueReadMap, findFirstNewClue, markClueRead } from './clueRevealState';
import { useGameStore } from './store/gameStore';
import { buildTruthSubmission } from './deductionWorkspace';

interface EndingCinematicPayload {
  key: string;
  kind: 'death' | 'survived';
  title: string;
  summary: string;
  method?: string | null;
}

function shouldShowIntroCinematic(state: GameState) {
  return state.phase === 'intro' && !state.ending;
}

export default function App() {
  const state = useGameStore(store => store.frontendState);
  const submitAction = useGameStore(store => store.submitAction);
  const submitRecommendedAction = useGameStore(store => store.submitRecommendedAction);
  const rewind = useGameStore(store => store.rewind);
  const reset = useGameStore(store => store.reset);
  const setFrontendState = useGameStore(store => store.setFrontendState);
  const [showCinematic, setShowCinematic] = useState(() => shouldShowIntroCinematic(useGameStore.getState().frontendState));
  const [endingCinematic, setEndingCinematic] = useState<EndingCinematicPayload | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [deductionWorkspaceMode, setDeductionWorkspaceMode] =
    useState<DeductionWorkspaceMode | null>(null);
  const [activeClueId, setActiveClueId] = useState<string | null>(null);
  const [readClues, setReadClues] = useState<ClueReadMap>({});

  // Audio: track last turn's action intents and killer type
  const lastActionIntents = useRef<string[]>([]);
  const lastActionAudioCue = useRef<ActionAudioCue | null>(null);
  const lastKillerType = useRef<string | null>(null);
  const lastTurnCompleted = useRef(false);

  const threatLevel = state.sidebar?.threat?.level ?? 0;
  useGameAudio({
    phase: state.phase,
    threat: threatLevel,
    killerType: lastKillerType.current,
    actionIntents: lastActionIntents.current,
    actionAudioCue: lastActionAudioCue.current,
    isCinematic: showCinematic || Boolean(endingCinematic),
    newClueAdded: Boolean(activeClueId),
    turnCompleted: lastTurnCompleted.current,
  });

  useEffect(() => {
    void audio.init();
  }, []);

  const handleActionSubmit = async (actionText: string, recommendation?: RecommendedAction) => {
    const previousState = state;
    const previousClues = state.clues;

    const result = recommendation
      ? await submitRecommendedAction(recommendation)
      : await submitAction(actionText);
    if (!result) return null;

    const resultClues = result.clues ?? previousClues;
    const newClue = findFirstNewClue(previousClues, resultClues);

    // Audio triggers from turn data
    lastActionIntents.current = result.turn?.plan?.actions?.map(a => a.intent) ?? [];
    lastActionAudioCue.current = result.audioCue ?? null;
    lastKillerType.current = result.turn?.killerStrategy?.type ?? null;
    lastTurnCompleted.current = true;
    setTimeout(() => { lastTurnCompleted.current = false; }, 300);

    if (newClue && getClueAsset(newClue.id)) {
      setActiveClueId(newClue.id);
    }

    if (result.deductionEnding) {
      const breakdown = result.deductionEnding.breakdown;
      setEndingCinematic({
        key: `deduction-${result.deductionEnding.tier}-${Date.now()}`,
        kind: 'survived',
        title: `${result.deductionEnding.tier} 级结局`,
        summary: result.deductionEnding.narrative,
        method: `真相 ${breakdown.truthLayer} · 证据 ${breakdown.evidenceStrength} · 外传 ${breakdown.externalReach} · 生还 ${breakdown.survivors}`,
      });
    } else if (result.ending && result.ending !== previousState.ending) {
      setEndingCinematic({
        key: `${result.ending}-${Date.now()}`,
        kind: result.phase === 'survived' ? 'survived' : 'death',
        title: result.deathTitle || (result.phase === 'survived' ? '你活了下来' : '23:47'),
        summary: result.deathSummary || '这一轮结束了。房间里的每一个细节都会回到下一次醒来。',
        method: result.deathMethod,
      });
    } else if (result.phase === 'death' && previousState.phase !== 'death') {
      setEndingCinematic({
        key: `death-generic-${Date.now()}`,
        kind: 'death',
        title: result.deathTitle || '最后一秒',
        summary: result.deathSummary || '黑暗来得很快，但这一次你会把这一秒记住，带去下一轮。',
        method: result.deathMethod,
      });
    }
    return result;
  };

  const handleTruthSubmission = async (selectedKnowledgeIds: string[]) => {
    const submission = buildTruthSubmission(
      state.knowledge ?? [],
      selectedKnowledgeIds,
    );
    const result = await handleActionSubmit(submission.text);
    const accepted = result?.deduction?.passed === true
      && Boolean(result.deductionEnding);
    return accepted;
  };

  const openDeductionWorkspace = (mode: DeductionWorkspaceMode) => {
    setMobileMenuOpen(false);
    setDeductionWorkspaceMode(mode);
  };

  const handleConfirmAction = () => {
    setFrontendState({ ...state, actionConfirmation: null });
  };

  const handleCancelAction = () => {
    setFrontendState({ ...state, actionConfirmation: null });
  };

  const handleLoopRestart = async () => {
    const result = await rewind();
    if (!result) return false;

    setEndingCinematic(null);
    setShowCinematic(false);
    setMobileMenuOpen(false);
    setDeductionWorkspaceMode(null);
    setActiveClueId(null);
    return true;
  };

  const handleRestart = () => {
    reset();
    setShowCinematic(true);
    setEndingCinematic(null);
    setMobileMenuOpen(false);
    setDeductionWorkspaceMode(null);
    setActiveClueId(null);
    setReadClues({});
  };

  const handleClueSelect = (clue: Clue) => {
    setActiveClueId(clue.id);
  };

  const handleClueModalClose = () => {
    if (activeClueId) {
      setReadClues(prev => markClueRead(prev, activeClueId));
    }
    setActiveClueId(null);
  };

  const activeClue = activeClueId ? state.clues.find(clue => clue.id === activeClueId) ?? null : null;

  return (
    <>
      <RainPlayer />

      <AnimatePresence>
        {showCinematic && (
          <CinematicIntro key="cinematic" recap={state.recap} onComplete={() => setShowCinematic(false)} />
        )}
        {endingCinematic && (
          <CinematicTransition
            key={endingCinematic.key}
            kind={endingCinematic.kind}
            title={endingCinematic.title}
            summary={endingCinematic.summary}
            method={endingCinematic.method}
            onComplete={async () => {
              if (endingCinematic.kind === 'death') {
                await handleLoopRestart();
                return;
              }
              setEndingCinematic(null);
              setShowCinematic(false);
            }}
          />
        )}
      </AnimatePresence>

      <ClueRevealModal
        clue={activeClue}
        open={Boolean(activeClue)}
        onClose={handleClueModalClose}
      />

      <DeductionWorkspace
        mode={deductionWorkspaceMode}
        clues={state.clues}
        knowledge={state.knowledge ?? []}
        truth={state.truth}
        onClose={() => setDeductionWorkspaceMode(null)}
        onSubmitTruth={handleTruthSubmission}
      />

      <div className="relative flex h-[100svh] flex-col overflow-hidden bg-[#08080a] text-zinc-200 lg:h-screen">
      <Header
        time={state.time}
        location={state.location}
        onRestart={handleRestart}
      />

      {/* Mobile Sidebar Toggle */}
      <div className="absolute right-3 top-3 z-50 lg:hidden">
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-black/55 text-zinc-300 backdrop-blur transition-colors hover:text-white"
          aria-label={mobileMenuOpen ? '关闭情报面板' : '打开情报面板'}
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Main Content Area */}
        <main className="relative flex min-w-0 flex-1 flex-col bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-zinc-900/10 via-[#08080a] to-[#08080a] lg:border-r lg:border-white/5">
          <StoryPanel
            log={state.storyLog}
            onRecommendedAction={(action) => { void handleActionSubmit(action.label, action); }}
            recommendationsDisabled={state.isParsing || Boolean(state.ending)}
          />

          <div className="relative">
            {/* Soft gradient fade for text going behind input */}
            <div className="absolute -top-12 left-0 right-0 h-12 bg-gradient-to-t from-[#0c0c0e] to-transparent pointer-events-none" />
            {state.phase === 'death' || (state.ending && state.phase !== 'loop_started') ? (
              <div className="z-10 shrink-0 bg-gradient-to-t from-[#08080a] to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-8 md:px-12 md:pb-10 md:pt-20">
                <div className="max-w-2xl mx-auto text-center flex flex-col items-center gap-3">
                  <p className="text-red-400/80 font-serif text-lg tracking-wide">
                    {state.phase === 'death' ? '你死了。' : '这一轮结束了。'}
                  </p>
                  <button
                    onClick={() => { void handleLoopRestart(); }}
                    className="px-6 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 hover:bg-red-500/20 transition-colors font-serif text-base"
                  >
                    重启循环（保留记忆与线索）
                  </button>
                  <p className="text-zinc-600 text-xs mt-1">上一次循环中发现的线索会被保留。</p>
                </div>
              </div>
            ) : (
              <InputArea
                onActionSubmit={handleActionSubmit}
                onConfirmAction={handleConfirmAction}
                onCancelAction={handleCancelAction}
                isParsing={state.isParsing}
                confirmationText={state.actionConfirmation}
              />
            )}
          </div>
        </main>

        {/* Desktop Sidebar */}
        <div className="hidden lg:block shrink-0 relative z-30">
          <Sidebar clues={state.clues} knowledge={state.knowledge} truth={state.truth} sidebar={state.sidebar} recap={state.recap} turnTiming={state.coordination?.turnTiming} onClueSelect={handleClueSelect} onOpenInference={() => openDeductionWorkspace('inference')} onOpenTruth={() => openDeductionWorkspace('truth')} readClues={readClues} />
        </div>

        {/* Mobile Sidebar Frame */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              className="absolute inset-x-0 bottom-0 top-0 z-40 bg-[#08080a] shadow-2xl lg:hidden"
            >
               <Sidebar clues={state.clues} knowledge={state.knowledge} truth={state.truth} sidebar={state.sidebar} recap={state.recap} turnTiming={state.coordination?.turnTiming} onClueSelect={handleClueSelect} onOpenInference={() => openDeductionWorkspace('inference')} onOpenTruth={() => openDeductionWorkspace('truth')} readClues={readClues} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
    </>
  );
}
