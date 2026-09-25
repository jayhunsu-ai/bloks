// Agent OS runtime bridge.
//
// Keeps Agent OS from importing the Blocks server internals directly. Blocks
// owns provider construction and lifecycle; this module exposes only the
// narrow registry lookup surface required by the Agent OS adapter.

import { BUILT_IN_DRIVERS } from "./drivers/builtIn.ts";
import { instanceConfigs, loadConfig } from "./config.ts";
import { ProviderRegistry } from "./harness/registry.ts";

export interface AgentOSBlocksProvider {
  readonly instanceId: string;
  readonly driverKind: string;
  readonly adapter: {
    readonly provider: string;
    readonly capabilities: {
      sessionModelSwitch: "in-session" | "unsupported";
      replaysNatively?: boolean;
    };
    sendTurn(input: {
      threadId: string;
      text: string;
      model?: string;
      effort?: "low" | "medium" | "high";
      resumeCursor?: unknown;
      transcript?: Array<{ role: "user" | "assistant"; text: string }>;
      system?: string;
      cwd?: string;
      extraDirs?: string[];
      env?: Record<string, string>;
    }): Promise<{ turnId: string }>;
    interruptTurn(threadId: string, turnId?: string): Promise<void>;
    respondToRequest(
      threadId: string,
      requestId: string,
      decision: { behavior: "allow" | "deny" | "answer"; message?: string },
    ): Promise<void>;
    hasSession(threadId: string): boolean;
    stopAll(): Promise<void>;
    onEvent(listener: (event: unknown) => void): () => void;
  };
}

let registryPromise: Promise<ProviderRegistry> | undefined;

async function registry(): Promise<ProviderRegistry> {
  registryPromise ??= (async () => {
    const cfg = loadConfig();
    const value = new ProviderRegistry(BUILT_IN_DRIVERS);
    await value.load(instanceConfigs(cfg));
    return value;
  })();
  return registryPromise;
}

/** Resolve an already-configured live Blocks provider instance. */
export async function getAgentOSProvider(instanceId: string): Promise<AgentOSBlocksProvider> {
  const instance = (await registry()).get(instanceId);
  if (!instance) {
    throw new Error(`Blocks provider instance "${instanceId}" is unavailable.`);
  }
  return instance as AgentOSBlocksProvider;
}

/** Dispose the bridge-owned registry during host shutdown. */
export async function disposeAgentOSProviders(): Promise<void> {
  if (!registryPromise) return;
  const value = await registryPromise;
  registryPromise = undefined;
  await value.disposeAll();
}
