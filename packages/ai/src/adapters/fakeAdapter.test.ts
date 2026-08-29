import { describe, expect, it } from "vitest";
import { FakeAiProviderAdapter } from "./fakeAdapter.js";

describe("FakeAiProviderAdapter — provider adapter contract", () => {
  it("never requires a real API key -- validateKey works entirely offline", async () => {
    const adapter = new FakeAiProviderAdapter([]);
    expect(await adapter.validateKey("anything")).toEqual({ valid: true });
    expect(await adapter.validateKey("invalid-test-key")).toMatchObject({ valid: false });
  });

  it("plays back scripted scenarios in order, one per chat() call", async () => {
    const adapter = new FakeAiProviderAdapter([{ kind: "text", text: "first" }, { kind: "text", text: "second" }]);
    const events1 = [];
    for await (const e of adapter.chat([], [])) events1.push(e);
    expect(events1).toEqual([{ type: "text_delta", text: "first" }, { type: "message_stop" }]);

    const events2 = [];
    for await (const e of adapter.chat([], [])) events2.push(e);
    expect(events2).toEqual([{ type: "text_delta", text: "second" }, { type: "message_stop" }]);
  });

  it("records every call it receives, so a test can assert what the orchestrator actually sent", async () => {
    const adapter = new FakeAiProviderAdapter([{ kind: "text", text: "hi" }]);
    for await (const _ of adapter.chat([{ role: "user", content: "hello" }], [{ name: "t1", description: "d", inputSchema: {} }])) {
      /* drain */
    }
    expect(adapter.receivedCalls).toHaveLength(1);
    expect(adapter.receivedCalls[0]!.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("yields a tool_call event exactly as scripted", async () => {
    const adapter = new FakeAiProviderAdapter([{ kind: "tool_call", id: "call-1", name: "getSafeToSpend", arguments: {} }]);
    const events = [];
    for await (const e of adapter.chat([], [])) events.push(e);
    expect(events[0]).toEqual({ type: "tool_call", id: "call-1", name: "getSafeToSpend", arguments: {} });
  });
});
