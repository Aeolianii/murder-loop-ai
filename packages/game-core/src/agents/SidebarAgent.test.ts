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

async function testHiddenPackageItemsDoNotLeakIntoSidebar() {
  const state = createInitialGameState();

  const sidebar = await SidebarAgent.fallback({ finalState: state }) as SidebarPayload;

  assert(!sidebar.roomStatus.some((item) => /旧书|药板|数字纸条/.test(item.item)));

  state.room.package_old_book.visible = true;
  state.room.package_medicine_blister.visible = true;
  state.room.package_numeric_note.visible = true;
  const openedPackageSidebar = await SidebarAgent.fallback({ finalState: state }) as SidebarPayload;
  assert(
    !openedPackageSidebar.roomStatus.some((item) => /旧书|药板|数字纸条/.test(item.item)),
    'package child targets are action semantics, not standalone room-status rows',
  );
}

await testFalsePolicePhaseDoesNotSpoilIdentity();
await testChargingTurnKeepsSidebarBatteryAligned();
await testHiddenPackageItemsDoNotLeakIntoSidebar();
