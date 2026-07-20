import { GameState } from '../types';

export const INITIAL_STATE: GameState = {
  gameSessionId: '',
  stateVersion: 0,
  time: '23:00',
  location: '青荷公寓 503室',
  phase: 'intro',
  isParsing: false,
  isParsingAction: false,
  actionConfirmation: null,
  coordination: { warnings: [] },
  ending: null,
  deathTitle: null,
  deathSummary: null,
  deathMethod: null,
  clues: [
    {
      id: 'wrong_package',
      name: '标记模糊的包裹',
      description: '写着模糊的 "5-03"，里面是一本被掏空的旧书。',
      status: 'new',
    }
  ],
  storyLog: [
    {
      id: 'msg-0',
      type: 'system',
      content: '你睁开眼，雨声又一次落在窗外。',
    },
    {
      id: 'msg-1',
      type: 'narrative',
      content: '你猛地睁开眼，从地板上撑起身。冷汗浸透睡衣，后脑勺一阵阵发钝，像是刚撞过墙角或门框。窗外的雨把铝合金窗敲得细碎，手机屏幕停在 23:00。',
      timestamp: '23:00',
    },
    {
      id: 'msg-2',
      type: 'narrative',
      content: '记忆像断片的监控画面往回跳：傍晚时，房东陈怀民把 503 的钥匙交到你手里；晚些时候，维修工林越拎着工具箱来查煤气管道，提醒你这栋楼夜里水压不稳。',
      timestamp: '23:00',
    },
    {
      id: 'msg-3',
      type: 'narrative',
      content: '再往后的记忆只剩一股潮湿纸箱的霉味。你环顾四周，行李箱还堆在门边，桌上却多了一个被拆开一半的陌生包裹，旧书和药板露在纸箱里。黑暗里似乎有人压低声音问过：“东西呢？”它也许是林越检查煤气时漏在这里的，也许该先拍张照片问问他。',
      timestamp: '23:00',
    }
  ]
};
