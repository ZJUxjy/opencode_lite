#!/usr/bin/env node
import React, { useState, useCallback } from "react"
import { render, Box, Text, useApp } from "ink"
import TextInput from "ink-text-input"
import SelectInput from "ink-select-input"
import { ProviderConfigService } from "../providers/service.js"
import { BUILTIN_PROVIDERS } from "../providers/registry.js"
import type { BuiltinProvider } from "../providers/types.js"

interface WizardProps {
  onComplete?: () => void
}

type WizardStep = "select-provider" | "enter-api-key" | "enter-base-url" | "enter-model" | "set-default" | "done"

export function ConfigWizard({ onComplete }: WizardProps) {
  const { exit } = useApp()
  const service = new ProviderConfigService()

  const [step, setStep] = useState<WizardStep>("select-provider")
  const [selectedProvider, setSelectedProvider] = useState<string>()
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [model, setModel] = useState("")
  const [setAsDefault, setSetAsDefault] = useState(true)
  const [error, setError] = useState<string>()

  // Build provider selection items
  const providerItems = [
    ...BUILTIN_PROVIDERS.map((p) => ({
      label: p.name,
      value: p.id,
    })),
    { label: "───────────────", value: "separator" },
    { label: "Custom Provider", value: "custom" },
  ]

  const handleProviderSelect = useCallback((item: { value: string }) => {
    if (item.value === "separator") return

    if (item.value === "custom") {
      setSelectedProvider("custom")
      setBaseUrl("")
      setModel("")
      setStep("enter-base-url")
      return
    }

    const providerInfo = BUILTIN_PROVIDERS.find((p) => p.id === item.value)
    if (providerInfo) {
      setSelectedProvider(item.value)
      setBaseUrl(providerInfo.baseUrl)
      setModel(providerInfo.defaultModel)
      setStep("enter-api-key")
    }
  }, [])

  const handleApiKeySubmit = useCallback(() => {
    if (!apiKey.trim()) {
      setError("API Key is required")
      return
    }
    setError(undefined)
    if (selectedProvider === "custom") {
      setStep("enter-model")
    } else {
      setStep("set-default")
    }
  }, [apiKey, selectedProvider])

  const handleBaseUrlSubmit = useCallback(() => {
    if (!baseUrl.trim()) {
      setError("Base URL is required")
      return
    }
    setError(undefined)
    setStep("enter-api-key")
  }, [baseUrl])

  const handleModelSubmit = useCallback(() => {
    if (!model.trim()) {
      setError("Model name is required")
      return
    }
    setError(undefined)
    setStep("set-default")
  }, [model])

  const handleDefaultSelect = useCallback((item: { value: boolean }) => {
    setSetAsDefault(item.value)

    // Save configuration
    const providerId = selectedProvider === "custom" ? `custom:${Date.now()}` : selectedProvider!

    if (selectedProvider && selectedProvider !== "custom") {
      const providerInfo = BUILTIN_PROVIDERS.find((p) => p.id === selectedProvider)!
      service.setProvider(selectedProvider as BuiltinProvider, {
        name: providerInfo.name,
        provider: selectedProvider as BuiltinProvider,
        baseUrl,
        defaultModel: model,
        envKey: providerInfo.envKey,
        apiKey: apiKey,  // Store apiKey directly in config
      })
    } else if (selectedProvider === "custom") {
      service.setProvider(providerId, {
        name: "Custom Provider",
        provider: "custom",
        baseUrl,
        defaultModel: model,
        apiKey: apiKey,  // Store apiKey directly in config
      })
    }

    if (setAsDefault && providerId) {
      service.setDefault(providerId)
    }

    service.save()

    setStep("done")
  }, [selectedProvider, baseUrl, model, setAsDefault, service, apiKey])

  const handleDone = useCallback(() => {
    onComplete?.()
    exit()
  }, [onComplete, exit])

  // Build model selection items
  const modelItems = selectedProvider && selectedProvider !== "custom"
    ? BUILTIN_PROVIDERS.find((p) => p.id === selectedProvider)?.models.map((m) => ({
        label: m,
        value: m,
      })) ?? []
    : []

  // Default selection items
  const defaultItems = [
    { label: "Yes, set as default", value: true },
    { label: "No, keep current default", value: false },
  ]

  // Render based on current step
  switch (step) {
    case "select-provider":
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">🎛️ Configure LLM Provider</Text>
          </Box>
          <Box marginBottom={1}>
            <Text dimColor>Select a provider to configure:</Text>
          </Box>
          <SelectInput
            items={providerItems.filter(i => i.value !== "separator")}
            onSelect={handleProviderSelect}
          />
        </Box>
      )

    case "enter-api-key":
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">🔑 Configure {selectedProvider}</Text>
          </Box>
          <Box marginBottom={1}>
            <Text>API Key: </Text>
            <TextInput
              value={apiKey}
              onChange={setApiKey}
              onSubmit={handleApiKeySubmit}
              placeholder="sk-..."
            />
          </Box>
          {error && (
            <Box>
              <Text color="red">{error}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press Enter to continue</Text>
          </Box>
        </Box>
      )

    case "enter-base-url":
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">🌐 Configure Base URL</Text>
          </Box>
          <Box marginBottom={1}>
            <Text>Base URL: </Text>
            <TextInput
              value={baseUrl}
              onChange={setBaseUrl}
              onSubmit={handleBaseUrlSubmit}
              placeholder="https://api.example.com/v1"
            />
          </Box>
          {error && (
            <Box>
              <Text color="red">{error}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press Enter to continue</Text>
          </Box>
        </Box>
      )

    case "enter-model":
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">🤖 Enter Default Model</Text>
          </Box>
          {modelItems.length > 0 ? (
            <SelectInput
              items={modelItems}
              onSelect={(item: { value: string }) => {
                setModel(item.value)
                setStep("set-default")
              }}
            />
          ) : (
            <Box flexDirection="column">
              <Box marginBottom={1}>
                <Text>Model: </Text>
                <TextInput
                  value={model}
                  onChange={setModel}
                  onSubmit={handleModelSubmit}
                  placeholder="model-name"
                />
              </Box>
              {error && (
                <Box>
                  <Text color="red">{error}</Text>
                </Box>
              )}
              <Box marginTop={1}>
                <Text dimColor>Press Enter to continue</Text>
              </Box>
            </Box>
          )}
        </Box>
      )

    case "set-default":
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">⭐ Set as Default?</Text>
          </Box>
          <SelectInput items={defaultItems} onSelect={handleDefaultSelect} />
        </Box>
      )

    case "done":
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="green">✓ Configuration Complete!</Text>
          </Box>
          <Box>
            <Text>Provider: {selectedProvider}</Text>
          </Box>
          <Box>
            <Text>Model: {model}</Text>
          </Box>
          <Box>
            <Text>Base URL: {baseUrl}</Text>
          </Box>
          {setAsDefault && (
            <Box>
              <Text color="yellow">★ Set as default provider</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press any key to exit</Text>
          </Box>
        </Box>
      )
  }
}

/**
 * Run the config wizard
 */
export async function runConfigWizard(): Promise<void> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <ConfigWizard
        onComplete={() => {
          unmount()
          resolve()
        }}
      />
    )
  })
}
