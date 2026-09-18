import { createOpenAI } from "@ai-sdk/openai";
import { Graphed } from "@graphed-inc/sdk";
import { relevanceModel } from "./config";

export function createAgentModel() {
  const graphed = new Graphed();
  if (!graphed.isConfigured()) {
    throw new Error(
      "Missing GRAPHED_TOKEN. Run through `graphed dev run -- <command>` so Graphed injects the tools OpenRouter proxy.",
    );
  }
  const openai = createOpenAI({
    // Graphed Tools OpenRouter authenticates with GRAPHED_TOKEN. There is
    // no OpenRouter API key — Graphed meters the call on the account.
    apiKey: graphed.token,
    baseURL: graphed.openRouter.baseUrl(),
  });
  // Graphed only proxies OpenRouter chat completions. The default
  // `openai(model)` factory uses the Responses API, which 401s here.
  return openai.chat(relevanceModel());
}
