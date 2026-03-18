// src/components/dialog-model.tsx

import React, { useState, useMemo } from "react"
import { Box, Text, useApp, useInput } from "ink"
import { BUILTIN_PROVIDERS, getBuiltinProvider } from "../providers/registry.js"
import { getStatePersistence } from "../state/index.js"
import type { BuiltinProvider } from "../providers/types.js"

interface DialogModelProps {
  currentProvider: string
  currentModel: string
  onSelect: (provider: string, model: string) => void
  onCancel: () => void
}

interface ModelItem {
  label: string
  value: { provider: string; model: string }
  disabled?: boolean
  group?: string
}

export function DialogModel({ currentProvider, currentModel, onSelect, onCancel }: DialogModelProps) {
  const statePersistence = getStatePersistence()
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Build items list
  const items = useMemo(() => {
    const result: ModelItem[] = []
    const recentModels = statePersistence.getRecentModels()

    // Recent section
    if (recentModels.length > 0) {
      result.push({
        label: "── Recent ──",
        value: { provider: "", model: "" },
        disabled: true,
        group: "header",
      })

      for (const recent of recentModels) {
        const providerInfo = getBuiltinProvider(recent.provider as BuiltinProvider)
        result.push({
          label: `  ${recent.model} (${providerInfo?.name ?? recent.provider})`,
          value: { provider: recent.provider, model: recent.model },
          group: "recent",
        })
      }
    }

    // Provider sections
    for (const providerInfo of BUILTIN_PROVIDERS) {
      result.push({
        label: `── ${providerInfo.name} ──`,
        value: { provider: "", model: "" },
        disabled: true,
        group: "header",
      })

      for (const model of providerInfo.models) {
        const isCurrent = providerInfo.id === currentProvider && model === currentModel
        result.push({
          label: `  ${model}${isCurrent ? " ✓" : ""}`,
          value: { provider: providerInfo.id, model },
          group: providerInfo.id,
        })
      }
    }

    return result
  }, [currentProvider, currentModel, statePersistence])

  // Filter out disabled items for selection
  const selectableItems = items.filter((item) => !item.disabled)

  useInput((input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : selectableItems.length - 1))
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < selectableItems.length - 1 ? prev + 1 : 0))
    }
    if (key.return) {
      const item = selectableItems[selectedIndex]
      if (item && item.value.provider) {
        // Add to recent
        statePersistence.addRecentModel(item.value.provider, item.value.model)
        onSelect(item.value.provider, item.value.model)
      }
    }
  })

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Select Model
        </Text>
      </Box>

      <Box flexDirection="column">
        {items.map((item, index) => {
          const isSelectable = !item.disabled
          const isSelected = isSelectable && selectableItems[selectedIndex]?.value === item.value

          if (item.disabled) {
            return (
              <Box key={`header-${index}`}>
                <Text dimColor>{item.label}</Text>
              </Box>
            )
          }

          return (
            <Box key={`${item.value.provider}-${item.value.model}`}>
              <Text color={isSelected ? "green" : undefined}>
                {isSelected ? "> " : "  "}
                {item.label}
              </Text>
            </Box>
          )
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Up/Down Navigate | Enter Select | Esc Cancel</Text>
      </Box>
    </Box>
  )
}
