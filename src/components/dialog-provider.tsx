// src/components/dialog-provider.tsx

import React, { useState, useMemo, useCallback } from "react"
import { Box, Text, useInput } from "ink"
import TextInput from "ink-text-input"
import { BUILTIN_PROVIDERS, getBuiltinProvider } from "../providers/registry.js"
import { ProviderConfigService } from "../providers/service.js"
import type { BuiltinProvider } from "../providers/types.js"

interface DialogProviderProps {
  onSelect: (provider: string) => void
  onCancel: () => void
}

type Step = "select" | "configure"

interface ProviderItem {
  label: string
  value: string
  configured: boolean
  disabled?: boolean
}

export function DialogProvider({ onSelect, onCancel }: DialogProviderProps) {
  const providerService = new ProviderConfigService()

  const [step, setStep] = useState<Step>("select")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [selectedProvider, setSelectedProvider] = useState<string>("")

  // Configuration state
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [modelIndex, setModelIndex] = useState(0)
  const [configStep, setConfigStep] = useState<"apikey" | "baseurl" | "model">("apikey")
  const [error, setError] = useState<string>()

  // Build provider items
  const items = useMemo(() => {
    const configured: ProviderItem[] = []
    const available: ProviderItem[] = []

    for (const providerInfo of BUILTIN_PROVIDERS) {
      const config = providerService.getProvider(providerInfo.id)
      // Check if provider has apiKey configured
      const hasApiKey = providerService.isConfigured(providerInfo.id)
      const item: ProviderItem = {
        label: `${providerInfo.name} [${providerInfo.id}]${hasApiKey ? " (configured)" : ""}`,
        value: providerInfo.id,
        configured: hasApiKey,
      }

      if (hasApiKey) {
        configured.push(item)
      } else {
        available.push(item)
      }
    }

    return [...configured, ...available]
  }, [providerService])

  const handleProviderSelect = useCallback((providerId: string) => {
    const config = providerService.getProvider(providerId)
    const providerInfo = getBuiltinProvider(providerId as BuiltinProvider)

    // Pre-fill with existing config or defaults
    setSelectedProvider(providerId)
    setBaseUrl(config?.baseUrl ?? providerInfo?.baseUrl ?? "")

    // Pre-fill existing API key (if any)
    setApiKey(config?.apiKey ?? "")

    // Set model index based on existing config or default
    if (config && providerInfo) {
      const modelIdx = providerInfo.models.indexOf(config.defaultModel)
      setModelIndex(modelIdx >= 0 ? modelIdx : 0)
    } else {
      setModelIndex(0)
    }

    // Always enter configure step (allows reconfiguration)
    setStep("configure")
  }, [providerService])

  const handleConfigComplete = useCallback(() => {
    if (!apiKey.trim()) {
      setError("API Key is required")
      return
    }

    const providerInfo = getBuiltinProvider(selectedProvider as BuiltinProvider)
    const selectedModel = providerInfo?.models[modelIndex] ?? ""

    // Save to provider config (including apiKey)
    providerService.setProvider(selectedProvider, {
      name: providerInfo?.name ?? selectedProvider,
      provider: selectedProvider as BuiltinProvider,
      baseUrl,
      defaultModel: selectedModel,
      apiKey: apiKey,  // Store apiKey directly in config
    })
    providerService.setDefault(selectedProvider)
    providerService.save()

    onSelect(selectedProvider)
  }, [apiKey, baseUrl, modelIndex, selectedProvider, providerService, onSelect])

  // Keyboard handling for select step
  useInput((input, key) => {
    if (step !== "select") return

    if (key.escape) {
      onCancel()
      return
    }
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1))
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0))
    }
    if (key.return) {
      handleProviderSelect(items[selectedIndex].value)
    }
  })

  // Keyboard handling for model selection in configure step
  useInput((input, key) => {
    if (step !== "configure" || configStep !== "model") return

    const providerInfo = getBuiltinProvider(selectedProvider as BuiltinProvider)
    if (!providerInfo) return

    if (key.escape) {
      setStep("select")
      setConfigStep("apikey")
      setError(undefined)
    }
    if (key.upArrow) {
      setModelIndex((prev) => (prev > 0 ? prev - 1 : providerInfo.models.length - 1))
    }
    if (key.downArrow) {
      setModelIndex((prev) => (prev < providerInfo.models.length - 1 ? prev + 1 : 0))
    }
    if (key.return) {
      handleConfigComplete()
    }
  })

  // Render based on step
  if (step === "configure") {
    const providerInfo = getBuiltinProvider(selectedProvider as BuiltinProvider)

    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Configure {providerInfo?.name}
          </Text>
        </Box>

        {configStep === "apikey" && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text>API Key: </Text>
              <TextInput
                value={apiKey}
                onChange={setApiKey}
                onSubmit={() => setConfigStep("baseurl")}
                mask="*"
              />
            </Box>
            {error && <Text color="red">{error}</Text>}
            <Text dimColor>Press Enter to continue</Text>
          </Box>
        )}

        {configStep === "baseurl" && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text>Base URL: </Text>
              <TextInput
                value={baseUrl}
                onChange={setBaseUrl}
                onSubmit={() => setConfigStep("model")}
              />
            </Box>
            <Text dimColor>Press Enter to continue (use default or enter custom)</Text>
          </Box>
        )}

        {configStep === "model" && (
          <Box flexDirection="column">
            <Text>Select Default Model:</Text>
            {providerInfo?.models.map((model, index) => (
              <Box key={model}>
                <Text color={index === modelIndex ? "green" : undefined}>
                  {index === modelIndex ? "> " : "  "}
                  {model}
                </Text>
              </Box>
            )) || <Text dimColor>No models available</Text>}

            <Box marginTop={1}>
              <Text dimColor>Up/Down Select | Enter Save | Esc Cancel</Text>
            </Box>
          </Box>
        )}
      </Box>
    )
  }

  // Select step
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Select Provider
        </Text>
      </Box>

      <Box flexDirection="column">
        {items.map((item, index) => (
          <Box key={item.value}>
            <Text color={index === selectedIndex ? "green" : undefined}>
              {index === selectedIndex ? "> " : "  "}
              {item.configured ? "[x] " : "[ ] "}
              {item.label}
            </Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Up/Down Navigate | Enter Select | Esc Cancel</Text>
      </Box>
    </Box>
  )
}
