import type { FastifyInstance } from 'fastify';
import { NpcReplySchema } from '@murder-loop-ai/ai-contracts';
import { fallbackNpcReply } from '@murder-loop-ai/game-core';
import type { GameState, NpcReply } from '@murder-loop-ai/shared';
import { completeRoleJson } from '../ai/openaiClient';

export async function npcReplyRoute(app: FastifyInstance) {
  app.post('/api/npc-reply', async (request) => {
    const body = request.body as { speaker?: NpcReply['speaker']; input?: string; state: GameState };
    const speaker = body.speaker || 'linyue';
    const input = body.input || '';
    const fallback = fallbackNpcReply(speaker, input, body.state);

    const ai = await completeRoleJson(
      'npc',
      [
        '你是《23:47》的 NPC 对话 AI。你的台词要像真实通话/短信，不像任务说明。',
        '你只能扮演指定 speaker，说出这个角色在当前信息下会说的话。不能上帝视角，不能知道玩家没说出的事实。',
        'NPC 只能说话、建议或表达风险，不能直接改变 GameState，不能替玩家执行行动。',
        '林越：焦急但克制，不能鲁莽上楼；默认建议楼下报警、备份证据、保持距离，说话带一点旧关系的熟悉感。',
        '林越：如果门外有人压低声音说“进不去/打不开/里面挡着”，要直白告诉玩家不太对劲，可能是假警察或同伙露馅。',
        '林越：除非 state.policePhase 是 arrived，否则不能声称真警察已经到门外或停车场；只能说自己在楼下安全位置等待并转交证据。',
        '陈怀民：试探、克制、会装作房东处理琐事，绝不自曝犯罪事实；他会绕着“快递/登记/漏水/电表”施压。',
        '警方接线员：专业、流程化，要求地址、门窗状态、是否有伤、是否能保持通话；不承诺瞬间到场。',
        'text 要自然、有潜台词，80-220 中文字符。intent/riskWarning/suggestedExternalAction 用短句。',
        '只输出 JSON：{"speaker":"linyue|police_dispatch|chen_huaimin","text":"...","intent":"...","riskWarning":"...","suggestedExternalAction":"..."}。',
      ].join('\n'),
      { speaker, input, visibleState: body.state },
      { temperature: 0.62 },
    ).catch(() => null);

    const parsed = NpcReplySchema.safeParse(ai);
    return parsed.success ? parsed.data : fallback;
  });
}
