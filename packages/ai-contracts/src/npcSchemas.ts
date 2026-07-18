import { z } from 'zod';

export const NPC_ACTION_VALUES = ['move','wait','observe','communicate','use_object','investigate','pick_up','hide','report'] as const;

export const AtomicTaskSchema = z.object({
  action: z.enum(NPC_ACTION_VALUES), target: z.string().min(1), reason: z.string().min(1),
  priority: z.number().int().min(1).max(10), precondition: z.string().optional(),
});

export const IntentOutputSchema = z.object({
  intent: z.string().min(1).max(80), attentionWeights: z.record(z.string(), z.number().min(0).max(1)),
  urgency: z.number().int().min(1).max(10), reasoning: z.string().min(1).max(500), affectedFacts: z.array(z.string()).max(8).optional(),
});

export const TaskPlanSchema = z.object({
  intent: z.string(), tasks: z.array(AtomicTaskSchema).min(1).max(6),
  destination: z.string().optional(), newStatus: z.string().optional(), newAction: z.string().optional(),
});
