// src/providers/registry.ts

import type { BuiltinProvider } from "./types.js"

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
    models: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"],
  },
  {
    id: "gemini",
    name: "Google (Gemini)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    envKey: "GEMINI_API_KEY",
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
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
    name: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-Text-01",
    envKey: "MINIMAX_API_KEY",
    models: ["MiniMax-Text-01"],
  },
  {
    id: "kimi",
    name: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-128k",
    envKey: "KIMI_API_KEY",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
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
