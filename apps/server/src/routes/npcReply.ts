import type { FastifyInstance } from 'fastify';
import { NpcReplySchema } from '@murder-loop-ai/ai-contracts';
import { buildNpcVisibleContext, fallbackNpcReply } from '@murder-loop-ai/game-core';
import type { GameState, NpcReply } from '@murder-loop-ai/shared';
import { completeRoleJson } from '../ai/openaiClient';

export async function npcReplyRoute(app: FastifyInstance) {
  app.post('/api/npc-reply', async (request) => {
    const body = request.body as { speaker?: NpcReply['speaker']; input?: string; state: GameState };
    const speaker = body.speaker || 'linyue';
    const input = body.input || '';
    const fallback = fallbackNpcReply(speaker, input, body.state);
    const visibleContext = buildNpcVisibleContext(body.state, speaker, input);

    const ai = await completeRoleJson(
      'npc',
      [
        '你是《23:47》的 NPC 对话 AI。你的台词要像真实通话/短信，不像任务说明。',
        '你只能扮演指定 speaker，说出这个角色在当前信息下会说的话。不能上帝视角，不能知道玩家没说出的事实。',
        'NPC 只能说话、建议或表达风险，不能直接改变 GameState，不能替玩家执行行动。',
        '林越：焦急但克制，不能鲁莽上楼；只围绕 visibleContext 已知事实说话。',
        '林越只收到包裹照片时，可以建议保存照片、查看寄件信息、先别拆包裹；不能提开门、门缝、门外有人、报警、真警察或假警察。',
        '只有 visibleContext.canReference.doorActivity 为 true 时，林越才可以讨论门外/楼道/别开门。',
        '只有 visibleContext.canReference.policeReport 或 fakePoliceSuspicion 为 true 时，林越才可以讨论报警、真警察或假警察。',
        '陈怀民：试探、克制、会装作房东处理琐事，绝不自曝犯罪事实；他会绕着“快递/登记/漏水/电表”施压。',
        '警方接线员：专业、流程化，要求地址、门窗状态、是否有伤、是否能保持通话；不承诺瞬间到场。',
        'text 要自然、有潜台词，80-220 中文字符。intent/riskWarning/suggestedExternalAction 用短句。',
        '只输出 JSON：{"speaker":"linyue|police_dispatch|chen_huaimin","text":"...","intent":"...","riskWarning":"...","suggestedExternalAction":"..."}。',
      ].join('\n'),
      { speaker, input, visibleContext },
      { temperature: 0.62 },
    ).catch(() => null);

    const parsed = NpcReplySchema.safeParse(ai);
    return parsed.success ? parsed.data : fallback;
  });
}
