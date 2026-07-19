import type { AgentRegistration } from '../events/AgentRegistry';
import type { RecommendationRequest } from '../recommendations/recommendationTypes';
import { recommenderContract } from '../contracts/recommender.contract';

export const RecommenderAgent: AgentRegistration = {
  id: 'recommender',
  subscriptions: [{ event: 'RecommendationsRequested', priority: 70, role: 'primary' }],
  contract: recommenderContract,
  handler: async () => {
    throw new Error('AI handler not injected — use server adapter via createHarness()');
  },
  fallback: async (input: unknown) => {
    const request = input as RecommendationRequest;
    return request.fallbackActions;
  },
  mode: 'fallback',
};
