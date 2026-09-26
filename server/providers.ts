// The provider catalog: every engine Bloks knows how to talk to, and how
// you sign in to each one.
//
// Almost every major lab now speaks OpenAI's /chat/completions shape, so
// these are data, not code. One generic driver (drivers/openai-compat.ts)
// reads a spec and becomes that provider.
//
// `auth` is the honest part. "oauth" means a real browser sign-in that
// hands back a credential; "key" means paste a key; "cli" means another
// tool already holds the login and we ride along; "none" means it runs on
// this machine and asks for nothing.
import type { ModelCatalog } from "./contracts.ts";

export type AuthKind = "oauth" | "key" | "cli" | "none";

export interface ProviderSpec {
  kind: string;
  name: string;
  url: string;
  auth: AuthKind;
  keyHint: string;
  keyPrefix?: string;
  docsUrl: string;
  models: ModelCatalog;
  prefer?: RegExp[];
  limit?: number;
  freeSlots?: number;
  headers?: Record<string, string>;
  small?: string;
  tools?: boolean;
}

const OPENROUTER: ProviderSpec = {
  kind: "openrouter",
  tools: true,
  name: "OpenRouter",
  url: "https://openrouter.ai/api/v1",
  auth: "oauth",
  keyHint: "Sign in and OpenRouter issues a key you control",
  keyPrefix: "sk-or-",
  docsUrl: "https://openrouter.ai/docs/use-cases/oauth-pkce",
  headers: { "HTTP-Referer": "https://bloks.local", "X-Title": "Bloks" },
  models: {
    default: "google/gemini-2.5-flash",
    options: [
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
      { id: "x-ai/grok-4", label: "Grok 4" },
      { id: "moonshotai/kimi-k2", label: "Kimi K2" },
      { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick" },
      { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
    ],
  },
  prefer: [/^google\//, /^anthropic\//, /^x-ai\//, /^openai\//, /^moonshotai\//, /^meta-llama\//, /^deepseek\//, /^qwen\//, /^mistralai\//],
  limit: 28,
  freeSlots: 12,
  small: "google/gemini-2.5-flash",
};

const ANTHROPIC: ProviderSpec = {
  kind: "anthropic",
  tools: true,
  name: "Anthropic",
  url: "https://api.anthropic.com",
  auth: "key",
  keyHint: "API key from console.anthropic.com",
  keyPrefix: "sk-ant-",
  docsUrl: "https://platform.claude.com/docs/en/api/messages",
  models: {
    default: "claude-opus-5-5",
    options: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  prefer: [/^claude-(sonnet|opus|fable|haiku)/],
  small: "claude-haiku-4-5-20251001",
};

const GEMINI: ProviderSpec = {
  kind: "gemini",
  tools: true,
  name: "Gemini",
  url: "https://generativelanguage.googleapis.com/v1beta/openai",
  auth: "key",
  keyHint: "API key from Google AI Studio",
  docsUrl: "https://ai.google.dev/gemini-api/docs/openai",
  models: {
    default: "gemini-2.5-flash",
    options: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    ],
  },
  prefer: [/^(models\/)?gemini/],
  small: "gemini-2.5-flash-lite",
};

const XAI: ProviderSpec = {
  kind: "grok",
  tools: true,
  name: "Grok",
  url: "https://api.x.ai/v1",
  auth: "key",
  keyHint: "API key from console.x.ai",
  keyPrefix: "xai-",
  docsUrl: "https://docs.x.ai/docs/api-reference",
  models: {
    default: "grok-4",
    options: [
      { id: "grok-4", label: "Grok 4" },
      { id: "grok-4-fast", label: "Grok 4 Fast" },
      { id: "grok-3-mini", label: "Grok 3 Mini" },
    ],
  },
  prefer: [/^grok/],
  small: "grok-3-mini",
};

const MOONSHOT: ProviderSpec = {
  kind: "kimi",
  tools: true,
  name: "Kimi",
  url: "https://api.moonshot.ai/v1",
  auth: "key",
  keyHint: "API key from platform.moonshot.ai",
  keyPrefix: "sk-",
  docsUrl: "https://platform.moonshot.ai/docs/guide/migrating-from-openai-to-kimi",
  models: {
    default: "kimi-k2-turbo-preview",
    options: [
      { id: "kimi-k2-turbo-preview", label: "Kimi K2 Turbo" },
      { id: "kimi-k2-0905-preview", label: "Kimi K2" },
      { id: "moonshot-v1-32k", label: "Moonshot v1 32k" },
    ],
  },
  prefer: [/^kimi/, /^moonshot/],
};

const LLAMA: ProviderSpec = {
  kind: "llama",
  name: "Llama",
  url: "https://api.llama.com/compat/v1",
  auth: "key",
  keyHint: "API key from llama.developer.meta.com",
  keyPrefix: "LLM|",
  docsUrl: "https://llama.developer.meta.com/docs/features/compatibility/",
  models: {
    default: "Llama-4-Maverick-17B-128E-Instruct-FP8",
    options: [
      { id: "Llama-4-Maverick-17B-128E-Instruct-FP8", label: "Llama 4 Maverick" },
      { id: "Llama-4-Scout-17B-16E-Instruct-FP8", label: "Llama 4 Scout" },
    ],
  },
  prefer: [/llama/i],
};
