import assert from "node:assert/strict";
import test from "node:test";
import { anthropicDriver } from "../server/drivers/anthropic.ts";
import { specFor } from "../server/providers.ts";
import { createAgentOSRuntime } from "@bro-s-start-it/agent-os";

test("Anthropic driver executes through Agent OS and settles the reservation", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-only";

  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    const encoder = new TextEncoder();
    const chunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ANTHROPIC_OK"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };

  try {
    const spec = specFor("anthropic");
    assert.ok(spec, "Anthropic provider spec must exist");

    const driver = anthropicDriver(spec);
    const instance = await driver.create({
      instanceId: "anthropic",
      displayName: "Anthropic",
      environment: {},
      enabled: true,
      config: {},
    });

    const runtime = createAgentOSRuntime({ invocationBudgetUsd: 5 });
    const guarded = runtime.guard(instance.adapter);
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const unsubscribe = guarded.onEvent((event) => events.push(event as typeof events[number]));

    const completed = new Promise<void>((resolve) => {
      const off = guarded.onEvent((event) => {
        if (event.type === "turn.completed") {
          off();
          resolve();
        }
      });
    });

    const result = await guarded.agentOS.reserveAndSend({
      threadId: "anthropic-smoke",
      taskId: "anthropic-smoke",
      projectId: "blocks-smoke",
      model: "claude-sonnet-5",
      text: "Say exactly ANTHROPIC_OK",
      transcript: [],
    });

    await completed;
    unsubscribe();

    assert.equal(result.turnId.length > 0, true);
    assert.equal(requestUrl, "https://api.anthropic.com/v1/messages");

    const headers = requestInit?.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "sk-ant-test-only");
    assert.equal(headers["anthropic-version"], "2023-06-01");

    const body = JSON.parse(String(requestInit?.body));
    assert.equal(body.model, "claude-sonnet-5");
    assert.equal(body.stream, true);
    assert.equal(body.messages[0].content, "Say exactly ANTHROPIC_OK");
    assert.ok(body.max_tokens > 0 && body.max_tokens <= 16384);

    assert.equal(
      events.some((event) => event.type === "content.delta" && event.delta === "ANTHROPIC_OK"),
      true,
    );
    assert.equal(events.some((event) => event.type === "turn.completed"), true);

    const ledger = runtime.controller.getLedger();
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].provider, "anthropic");
    assert.equal(ledger[0].model, "claude-sonnet-5");
    assert.equal(ledger[0].result, "ok");
    assert.ok((ledger[0].actualCostUsd ?? 0) > 0);

    await instance.dispose();
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
});
