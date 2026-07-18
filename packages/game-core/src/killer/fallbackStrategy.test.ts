import assert from 'node:assert/strict';
import { createInitialGameState } from '../state/createInitialState';
import { chooseFallbackKillerStrategy } from './fallbackStrategy';

function testPackagePhotoDoesNotForceFramingPressure() {
  const state = createInitialGameState();
  state.killerPhase = 'soft_pressure';
  state.threat = 35;
  state.clues.push({
    id: 'package_photo',
    title: 'Package photo',
    detail: 'The package label and contents were photographed.',
    source: 'player_discovered',
    weight: 8,
    discoveredAt: { run: state.run, minute: state.minute },
    isPersistent: true,
  });

  const strategy = chooseFallbackKillerStrategy(state);

  assert.notEqual(strategy.type, 'framing_pressure');
}

testPackagePhotoDoesNotForceFramingPressure();
