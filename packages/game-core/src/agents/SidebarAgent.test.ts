import assert from 'node:assert/strict';
import type { ActionPlan } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { applyPlayerActions } from '../rules/applyPlayerActions';
import { SidebarAgent, type SidebarPayload } from './SidebarAgent';

async function testFalsePolicePhaseDoesNotSpoilIdentity() {
  const state = createInitialGameState();
  state.phase = 'false_police_arrived';
  state.policePhase = 'dispatch_pending';

  const sidebar = await SidebarAgent.fallback({ finalState: state }) as SidebarPayload;

  assert.equal(sidebar.phaseLabel, '警察到场');
  assert.ok(!sidebar.phaseLabel.includes('假警察'));
}

async function testChargingTurnKeepsSidebarBatteryAligned() {
  const state = createInitialGameState();
  state.phoneBattery = 10;
  state.phoneFunctional = true;
  state.room.phone.state.battery = 10;

  const plan: ActionPlan = {
    id: 'plan-charge-phone',
    raw: 'charge the phone',
    summary: 'charge the phone',
    confidence: 1,
    warnings: [],
    actions: [{
      id: 'action-charge-phone',
      raw: 'charge the phone',
      intent: 'use_item',
      target: 'phone_charger' as any,
      method: 'use phone charger',
      confidence: 1,
      timeCost: 1,
      noise: 0,
      risk: 'low',
      itemId: 'phone_charger',
    } as any],
  };

  const result = applyPlayerActions(state, plan);
  const sidebar = await SidebarAgent.fallback({ finalState: result.state }) as SidebarPayload;

  assert.equal(result.state.phoneBattery, 40);
  assert.equal(result.state.room.phone.state.battery, result.state.phoneBattery);
  assert.equal(sidebar.phone.battery, result.state.phoneBattery);
}

await testFalsePolicePhaseDoesNotSpoilIdentity();
await testChargingTurnKeepsSidebarBatteryAligned();
