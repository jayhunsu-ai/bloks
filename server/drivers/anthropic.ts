import type { AnyProviderDriver, DriverCreateInput, ModelCatalog, ProviderInstance, ProviderSnapshot, SendTurnInput, RuntimeEvent } from "../contracts.ts";
import type { ProviderSpec } from "../providers.ts";
import { newEventId, newId } from "../contracts.ts";

interface AnthropicConfig { url?: string }

const DEFAULT_MODELS: ModelCatalog = {
  default: "claude-sonnet-5",
  options: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-fable-5", label: "Claude Fable 5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
};

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export function anthropicDriver(spec: ProviderSpec): AnyProviderDriver {
  return {
    driverKind: spec.kind,
    metadata: { displayName: spec.name, supportsMultipleInstances: true },
    models: spec.models,
    decodeConfig(raw: unknown): AnthropicConfig {
      if (raw === undefined || raw === null) return {};
      if (typeof raw !== "object") throw new Error("Anthropic config must be an object");
      const url = (raw as { url?: unknown }).url;
      if (url !== undefined && (typeof url !== "string" || url.length > 400)) throw new Error("Anthropic url must be a string");
      return { ...(typeof url === "string" ? { url } : {}) };
    },
    defaultConfig: () => ({}),
    async create(input: DriverCreateInput<AnthropicConfig>): Promise<ProviderInstance> {
      const apiKey = input.environment.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
      const baseUrl = (input.config.url ?? spec.url).replace(/\/$/, "");
      const catalog = DEFAULT_MODELS;
      const listeners = new Set<(event: RuntimeEvent) => void>();
      const active = new Map<string, { abort: AbortController; turnId: string }>();

      const emit = (event: Omit<RuntimeEvent, "eventId" | "createdAt" | "provider">) => {
        const full = { ...event, eventId: newEventId(), createdAt: new Date().toISOString(), provider: spec.kind, providerInstanceId: input.instanceId } as RuntimeEvent;
        for (const listener of listeners) listener(full);
      };

      const request = async (turn: SendTurnInput, signal: AbortSignal) => {
        const model = turn.model || catalog.default;
        const messages = (turn.transcript ?? []).map((m) => ({ role: m.role, content: m.text }));
        messages.push({ role: "user", content: turn.text });
        const price = PRICING[model];
        const estimatedInputTokens = Math.ceil(JSON.stringify(messages).length / 4) + Math.ceil((turn.system?.length ?? 0) / 4);
        const invocationCapUsd = Number(process.env.AGENT_OS_INVOCATION_CAP_USD ?? 5);
        if (price && estimatedInputTokens * price.input / 1_000_000 >= invocationCapUsd) {
          throw new Error("Agent OS denied Anthropic call: estimated input alone reaches the invocation budget.");
        }
        const outputBudget = price
          ? Math.max(1, Math.floor((invocationCapUsd - (estimatedInputTokens / 1_000_000) * price.input) * 1_000_000 / price.output))
          : 16_384;
        const body: Record<string, unknown> = {
          model,
          max_tokens: Math.min(16_384, outputBudget),
          messages,
          stream: true,
          ...(turn.system ? { system: turn.system } : {}),
        };
        if (/^(claude-(sonnet-5|opus-5|fable-5))$/.test(model) && turn.effort) {
          body.output_config = { effort: turn.effort };
        }

        const res = await fetch(baseUrl + "/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey ?? "", "anthropic-version": "2023-06-01" },
          body: JSON.stringify(body),
          signal,
        });
        if (!res.ok) {
          const responseText = await res.text().catch(() => "");
          throw new Error("Anthropic HTTP " + res.status + (responseText ? ": " + responseText.slice(0, 300) : ""));
        }
        if (!res.body) throw new Error("Anthropic returned an empty response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";
        let inputTokens = 0;
        let outputTokens = 0;
        let stopReason: string | null = null;

        const consume = (raw: string) => {
          let eventName = "";
          let data = "";
          for (const line of raw.split(/\r?\n/)) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) return;
          let payload: any;
          try { payload = JSON.parse(data); } catch { return; }
          if (eventName === "message_start") {
            inputTokens = Number(payload.message?.usage?.input_tokens ?? 0);
          } else if (eventName === "content_block_delta") {
            const delta = payload.delta;
            const currentTurnId = active.get(turn.threadId)?.turnId ?? "";
            if (delta?.type === "text_delta" && delta.text) {
              text += delta.text;
              emit({ type: "content.delta", streamKind: "assistant_text", delta: delta.text, threadId: turn.threadId, turnId: currentTurnId });
            } else if (delta?.type === "thinking_delta" && delta.thinking) {
              emit({ type: "content.delta", streamKind: "reasoning_text", delta: delta.thinking, threadId: turn.threadId, turnId: currentTurnId });
            }
          } else if (eventName === "message_delta") {
            outputTokens = Number(payload.usage?.output_tokens ?? outputTokens);
            stopReason = payload.delta?.stop_reason ?? stopReason;
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            consume(chunk);
          }
        }
        if (buffer.trim()) consume(buffer);

        const price = PRICING[model];
        const cost = price ? (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output : null;
        return { text, inputTokens, outputTokens, stopReason, cost };
      };

      const sendTurn = async (turn: SendTurnInput) => {
        if (!apiKey) throw new Error("Anthropic is not connected. Set ANTHROPIC_API_KEY or connect an Anthropic API key.");
        const turnId = newId();
        const abort = new AbortController();
        active.set(turn.threadId, { abort, turnId });
        emit({ type: "turn.started", threadId: turn.threadId, turnId });
        emit({ type: "session.started", threadId: turn.threadId, turnId, sessionId: null, model: turn.model ?? catalog.default });

        void (async () => {
          try {
            const result = await request(turn, abort.signal);
            if (result.text.trim()) emit({ type: "item.completed", itemType: "assistant_text", text: result.text, threadId: turn.threadId, turnId });
            if (result.inputTokens || result.outputTokens) emit({ type: "thread.token-usage.updated", input: result.inputTokens, output: result.outputTokens, threadId: turn.threadId, turnId });
            emit({ type: "turn.completed", ok: true, stopReason: result.stopReason, cost: result.cost, threadId: turn.threadId, turnId });
          } catch (error) {
            const aborted = error instanceof Error && error.name === "AbortError";
            if (!aborted) emit({ type: "runtime.error", message: error instanceof Error ? error.message : String(error), threadId: turn.threadId, turnId });
            emit({ type: "turn.completed", ok: false, stopReason: aborted ? "interrupted" : "error", cost: null, threadId: turn.threadId, turnId });
          } finally {
            active.delete(turn.threadId);
          }
        })();
        return { turnId };
      };

      const snapshot = async (): Promise<ProviderSnapshot> => {
        if (!apiKey) return { state: "unavailable", reason: "Anthropic is not connected. Set ANTHROPIC_API_KEY or connect an API key.", authenticated: false };
        return { state: "available", authenticated: true, version: null };
      };

      return {
        instanceId: input.instanceId,
        driverKind: spec.kind,
        displayName: input.displayName ?? spec.name,
        enabled: input.enabled,
        models: catalog,
        snapshot,
        adapter: {
          provider: spec.kind,
          capabilities: { sessionModelSwitch: "in-session", replaysNatively: true },
          sendTurn,
          interruptTurn: async (threadId) => active.get(threadId)?.abort.abort(),
          respondToRequest: async () => { throw new Error("Anthropic API driver has no pending native permission request."); },
          hasSession: (threadId) => active.has(threadId),
          stopAll: async () => { for (const value of active.values()) value.abort.abort(); },
          onEvent: (listener: (event: RuntimeEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
        },
        generateText: async (prompt: string) => {
          if (!apiKey) throw new Error("Anthropic is not connected.");
          const res = await fetch(baseUrl + "/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: spec.small ?? catalog.default, max_tokens: 2048, messages: [{ role: "user", content: prompt }] }),
            signal: AbortSignal.timeout(120_000),
          });
          if (!res.ok) throw new Error("Anthropic HTTP " + res.status);
          const json: any = await res.json();
          return (json.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        },
        dispose: async () => { for (const value of active.values()) value.abort.abort(); listeners.clear(); },
      };
    },
  };
}
