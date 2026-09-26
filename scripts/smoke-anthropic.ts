import { anthropicDriver } from "../server/drivers/anthropic.ts";
import { specFor } from "../server/providers.ts";
import { createAgentOSRuntime } from "@bro-s-start-it/agent-os";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  throw new Error("ANTHROPIC_API_KEY is required for the live smoke test.");
}

const spec = specFor("anthropic");
if (!spec) throw new Error("Anthropic provider spec is missing.");

const driver = anthropicDriver(spec);
const instance = await driver.create({
  instanceId: "anthropic-smoke",
  displayName: "Anthropic smoke",
  environment: { ANTHROPIC_API_KEY: key },
  enabled: true,
  config: {},
});

const runtime = createAgentOSRuntime({ invocationBudgetUsd: 5 });
const guarded = runtime.guard(instance.adapter);

const output: string[] = [];
const completed = new Promise<void>((resolve, reject) => {
  const off = guarded.onEvent((event) => {
    if (event.type === "content.delta" && event.streamKind === "assistant_text") output.push(event.delta);
    if (event.type === "runtime.error") {
      off();
      reject(new Error(event.message));
    }
    if (event.type === "turn.completed") {
      off();
      event.ok ? resolve() : reject(new Error("Anthropic turn failed."));
    }
  });
});

await guarded.agentOS.reserveAndSend({
  threadId: "anthropic-live-smoke",
  taskId: "anthropic-live-smoke",
  projectId: "blocks-anthropic-smoke",
  model: "claude-haiku-4-5-20251001",
  text: "Reply with exactly ANTHROPIC_LIVE_OK.",
  transcript: [],
});

await completed;

const ledger = runtime.controller.getLedger();
const last = ledger.at(-1);
if (!last || last.provider !== "anthropic" || last.result !== "ok") {
  throw new Error("Agent OS did not settle the Anthropic invocation successfully.");
}

console.log("PASS: Agent OS -> Blocks Anthropic driver -> Anthropic API");
console.log("Response:", output.join(""));
console.log("Settled cost USD:", last.actualCostUsd);

await instance.dispose();
