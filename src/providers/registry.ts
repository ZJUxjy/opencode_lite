// src/providers/registry.ts

import type { BuiltinProvider, ProviderProtocol } from "./types.js"

/**
 * Built-in provider information
 */
export interface BuiltinProviderInfo {
  id: BuiltinProvider
  name: string
  baseUrl: string
  defaultModel: string
  envKey: string
  models: string[]
}

/**
 * Registry of all built-in providers
 */
export const BUILTIN_PROVIDERS: BuiltinProviderInfo[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-6",
    envKey: "ANTHROPIC_API_KEY",
    models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    envKey: "OPENAI_API_KEY",
    models: ["gpt-5", "gpt-4", "o1", "o3-mini"],
  },
  {
    id: "gemini",
    name: "Google (Gemini)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    envKey: "GEMINI_API_KEY",
    models: ["gemini-3.0", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    envKey: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "minimax",
    name: "MiniMax-code-plan",
    baseUrl: "https://api.minimaxi.com/anthropic/v1",
    defaultModel: "MiniMax-M2.5",
    envKey: "MINIMAX_API_KEY",
    models: ["MiniMax-M2.5"],
  },
  {
    id: "kimi",
    name: "Kimi (Moonshot)-code-plan",
    baseUrl: "https://api.kimi.com/coding/v1",
    defaultModel: "kimi-k2.5",
    envKey: "KIMI_API_KEY",
    models: ["kimi-k2.5"],
  },
]

/**
 * Get provider info by ID
 */
export function getBuiltinProvider(id: BuiltinProvider): BuiltinProviderInfo | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === id)
}

/**
 * Check if a string is a valid builtin provider
 */
export function isBuiltinProvider(id: string): id is BuiltinProvider {
  return BUILTIN_PROVIDERS.some((p) => p.id === id)
}

/**
 * Protocol mapping for each provider
 * Most Chinese providers use Anthropic-compatible API
 */
export const PROTOCOL_MAP: Record<BuiltinProvider, ProviderProtocol> = {
  anthropic: "anthropic",
  openai: "openai",
  gemini: "google",
  deepseek: "anthropic",
  minimax: "anthropic",
  kimi: "anthropic",
}

/**
 * Get the protocol for a provider
 */
export function getProviderProtocol(id: BuiltinProvider): ProviderProtocol {
  return PROTOCOL_MAP[id] ?? "anthropic"
}
