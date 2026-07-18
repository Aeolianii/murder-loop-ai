import type { RoomObjectState } from '@murder-loop-ai/shared';

export const initialRoomObjects: Record<string, RoomObjectState> = {
  package: {
    id: 'package',
    name: '标记模糊的包裹',
    location: 'desk',
    visible: true,
    inspected: false,
    state: {
      opened: false,
      photographed: false,
      hiddenAt: null,
      restored: false,
    },
  },
  front_door: {
    id: 'front_door',
    name: '入户门',
    location: 'entry',
    visible: true,
    inspected: false,
    state: {
      locked: false,
      chainLocked: false,
      barricaded: false,
      scratched: false,
      opened: false,
    },
  },
  window: {
    id: 'window',
    name: '窗户',
    location: 'bedroom_wall',
    visible: true,
    inspected: false,
    state: {
      locked: false,
      curtainClosed: false,
      checked: false,
    },
  },
  phone: {
    id: 'phone',
    name: '手机',
    location: 'desk',
    visible: true,
    inspected: false,
    state: {
      muted: false,
      recording: false,
      battery: 61,
    },
  },
  phone_charger: {
    id: 'phone_charger',
    name: '手机充电器',
    location: 'desk',
    visible: true,
    inspected: false,
    state: {
      pluggedIn: false,
    },
  },
  chair: {
    id: 'chair',
    name: '椅子',
    location: 'desk',
    visible: true,
    inspected: false,
    state: {
      movedToDoor: false,
    },
  },
  closet: {
    id: 'closet',
    name: '衣柜',
    location: 'bedroom',
    visible: true,
    inspected: false,
    state: {
      checked: false,
    },
  },
  bed: {
    id: 'bed',
    name: '床和床底',
    location: 'bedroom',
    visible: true,
    inspected: false,
    state: {
      checkedUnder: false,
    },
  },
  bathroom: {
    id: 'bathroom',
    name: '卫生间',
    location: 'inside_room',
    visible: true,
    inspected: false,
    state: {
      doorLocked: false,
      waterTankChecked: false,
    },
  },
};
