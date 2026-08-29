import type { AiEvent, AiProviderAdapter, ChatMessage, ToolDefinition } from "../provider.js";

/**
 * Deterministic test double (Phase 16 locked decision #4 / testing
 * discipline: "never use real provider API keys in automated tests").
 * Scripted via a queue of scenarios consumed one per `chat()` call, so a
 * test can drive a multi-turn conversation (e.g. propose, then react to
 * the tool result) without any network access or real credentials.
 */

export type FakeScenario =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { kind: "error"; message: string };

export class FakeAiProviderAdapter implements AiProviderAdapter {
  provider = "anthropic" as const;
  private scenarios: FakeScenario[];
  public receivedCalls: { messages: ChatMessage[]; tools: ToolDefinition[]; system?: string }[] = [];

  constructor(scenarios: FakeScenario[]) {
    this.scenarios = [...scenarios];
  }

  async validateKey(key: string): Promise<{ valid: boolean; error?: string }> {
    return key === "invalid-test-key" ? { valid: false, error: "Invalid API key" } : { valid: true };
  }

  async *chat(messages: ChatMessage[], tools: ToolDefinition[], system?: string): AsyncIterable<AiEvent> {
    this.receivedCalls.push({ messages, tools, system });
    const scenario = this.scenarios.shift();
    if (!scenario) {
      yield { type: "text_delta", text: "" };
      yield { type: "message_stop" };
      return;
    }
    if (scenario.kind === "error") {
      yield { type: "error", message: scenario.message };
      return;
    }
    if (scenario.kind === "tool_call") {
      yield { type: "tool_call", id: scenario.id, name: scenario.name, arguments: scenario.arguments };
      yield { type: "message_stop" };
      return;
    }
    yield { type: "text_delta", text: scenario.text };
    yield { type: "message_stop" };
  }
}
