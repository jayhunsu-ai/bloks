import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getProviderCostGate, installProviderCostGate, resetProviderCostGate } from "../server/agent-os/cost-gate.ts";

test("the provider cost gate fails closed until installed", () => {
  resetProviderCostGate();
  assert.throws(
    () => getProviderCostGate().authorize({ reservationId: "r1", provider: "claudeAgent", model: "claude-sonnet-5" }),
    /cost gate is not installed/i,
  );
});

test("an installed gate controls authorization and settlement", async () => {
  const calls: string[] = [];
  installProviderCostGate({
    authorize(input) {
      calls.push(`authorize:${input.reservationId}`);
      return { reservationId: input.reservationId, projectId: input.projectId, taskId: input.taskId };
    },
    settle(input) {
      calls.push(`settle:${input.reservationId}:${input.result}`);
    },
    release(input) {
      calls.push(`release:${input.reservationId}`);
    },
  });

  const gate = getProviderCostGate();
  await gate.authorize({ reservationId: "r2", provider: "claudeAgent", model: "claude-sonnet-5", projectId: "p1" });
  await gate.settle({ reservationId: "r2", provider: "claudeAgent", model: "claude-sonnet-5", actualCostUsd: 0.01, result: "ok" });
  assert.deepEqual(calls, ["authorize:r2", "settle:r2:ok"]);
  resetProviderCostGate();
});
