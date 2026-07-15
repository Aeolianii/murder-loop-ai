import type { FastifyInstance } from 'fastify';
import { KillerStrategySchema } from '@murder-loop-ai/ai-contracts';
import { buildKillerContext, chooseFallbackKillerStrategy } from '@murder-loop-ai/game-core';
import type { GameState } from '@murder-loop-ai/shared';
import { completeRoleJson } from '../ai/openaiClient';
import { unwrapJsonObject } from '../ai/unwrapJsonObject';

export async function killerStrategyRoute(app: FastifyInstance) {
  app.post('/api/killer-strategy', async (request) => {
    const body = request.body as { state: GameState };
    const killerContext = buildKillerContext(body.state);
    const fallback = chooseFallbackKillerStrategy(body.state);

    const ai = await completeRoleJson(
      'killer',
      [
        '你是《23:47》的暗线导演，只负责陈怀民和楼道环境的下一步压力，不写小说正文。',
        '你只能看 visibleState 与 knowledge。玩家没有暴露的位置、证据备份、心理活动、房内细节，你都不知道。不要全知反制。',
        '陈怀民是谨慎的现实罪犯：怕监控、怕录音、怕目击、怕真警察。他优先试探、欺骗、拖延、切断信息，而不是无脑冲门。',
        '节奏像悬疑网文：一小步一小步收紧。低压用短信、轻敲、静默；中压用房东借口、断电、伪回拨；高压才用假警察、窗外路线、备用钥匙。',
        '不要每回合都升级。玩家若已有证据外传、官方核验、门窗防御较强，可以 retreat 或 framing_pressure，让对抗转为嫁祸、拖延、灭证。',
        'visibleToPlayer=true 只代表玩家能感知到短信、敲门、脚步、来电、断电、窗沿声等外部现象；不要暴露凶手内心。',
        'title 像短章节标题，要有画面；rationale 写给调试看，说明为什么这一步在信息边界内合理。',
        '只输出一个裸 JSON 对象，不要 Markdown，不要解释，不要包在 strategy/killerStrategy/result 字段里。',
        '必须包含且只需要这些字段：{"id":"killer-短id","type":"phone_probe|soft_knock|landlord_excuse|fake_police|spare_key_entry|window_route|framing_pressure|power_cut|lure_linyue|fake_neighbor|fake_callback|message_reply|wait_for_fatigue|retreat","title":"短标题","rationale":"为什么陈怀民在有限信息下会这么做","responseHint":"可选，若是短信/对话则写他发来的具体话","visibleToPlayer":true,"risk":"low|medium|high"}',
      ].join('\n'),
      { killerContext, visibleState: killerContext.visibleState },
      { temperature: 0.55 },
    ).catch(() => null);

    const parsed = KillerStrategySchema.safeParse(unwrapJsonObject(ai));
    return parsed.success ? parsed.data : fallback;
  });
}
