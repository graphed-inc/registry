import { Agent } from "@mastra/core/agent";
import type { AgentRunContext } from "./context";
import { createAgentModel } from "./model";
import { buildInstructions } from "./prompt";
import { createAdsTools } from "./tools";

export function createAdsAgent(ctx: AgentRunContext) {
  return new Agent({
    id: "google-ads-agent",
    name: "Google Ads Agent",
    instructions: buildInstructions(ctx.client),
    model: createAgentModel(),
    tools: createAdsTools(ctx),
    defaultOptions: {
      maxSteps: 24,
    },
  });
}
