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
    const fallback = chooseFallbackKillerStrategy(killerContext);

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
        '短信策略硬规则：选择 phone_probe、message_reply、framing_pressure 时，responseHint 必填，且必须包含玩家能看到的具体短信原文（用中文引号）。不能只写“收到一条消息”。',
        '避免复读：检查 killerContext.visibleState.recentKillerActions/observableEvents，上一条短信问过什么，这一条必须换问法或升级压力。',
        '施压触发不只来自未回复短信：玩家拒绝开门/反锁门、核实身份、录音拍照、外传证据、拖延交出包裹，都可以让陈怀民升级为 framing_pressure。',
        'framing_pressure 话术边界：用“拿错别人东西/偷拿/房东登记/限时放回门口”施压；禁止主动说“毒品/违禁品/走私/贩毒”等定性词，除非剧情事件明确写入陈怀民可用这种话术。',
        '只输出一个裸 JSON 对象，不要 Markdown，不要解释，不要包在 strategy/killerStrategy/result 字段里。',
        '必须包含且只需要这些字段：{"id":"killer-短id","type":"phone_probe|soft_knock|landlord_excuse|fake_police|spare_key_entry|window_route|framing_pressure|power_cut|lure_linyue|fake_neighbor|fake_callback|message_reply|wait_for_fatigue|retreat","title":"短标题","rationale":"为什么陈怀民在有限信息下会这么做","responseHint":"短信/对话/威胁的具体可见原文；非短信策略可省略","visibleToPlayer":true,"risk":"low|medium|high"}',
      ].join('\n'),
      { killerContext, visibleState: killerContext.visibleState },
      { temperature: 0.55 },
    ).catch(() => null);

    const parsed = KillerStrategySchema.safeParse(unwrapJsonObject(ai));
    return parsed.success ? parsed.data : fallback;
  });
}
