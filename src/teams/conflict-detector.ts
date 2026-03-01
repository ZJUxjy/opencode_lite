export interface ConflictReport {
  hasConflict: boolean
  files: string[]
  reason?: string
}

export interface FileEdit {
  file: string
  content: string
}

export interface MergeDecision {
  file: string
  keptFrom: number
  replaced: number[]
  reason: string
}

export interface AutoMergeResult {
  mergedOutput: string
  conflicts: string[]
  decisions: MergeDecision[]
}

export class ConflictDetector {
  detect(changedFileGroups: string[][]): ConflictReport {
    const seen = new Set<string>()
    const conflicts = new Set<string>()

    for (const files of changedFileGroups) {
      for (const file of files) {
        if (seen.has(file)) {
          conflicts.add(file)
        } else {
          seen.add(file)
        }
      }
    }

    return {
      hasConflict: conflicts.size > 0,
      files: Array.from(conflicts),
      reason: conflicts.size > 0 ? "Overlapping file modifications detected" : undefined,
    }
  }

  extractChangedFiles(output: string): string[] {
    const files: string[] = []
    const regex = /FILE:\s*([^\n]+)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(output)) !== null) {
      files.push(match[1].trim())
    }
    return files
  }

  extractFileEdits(output: string): FileEdit[] {
    const edits: FileEdit[] = []
    const regex = /FILE:\s*([^\n]+)\n?/g
    const matches = Array.from(output.matchAll(regex))

    if (matches.length === 0) {
      return edits
    }

    for (let i = 0; i < matches.length; i++) {
      const current = matches[i]
      const next = matches[i + 1]
      const file = (current[1] || "").trim()
      const start = (current.index || 0) + current[0].length
      const end = next?.index ?? output.length
      const content = output.slice(start, end).trim()
      edits.push({ file, content })
    }

    return edits
  }

  autoMergeByFile(workerOutputs: string[]): AutoMergeResult {
    const byFile = new Map<string, Array<{ workerIndex: number; content: string }>>()
    const decisions: MergeDecision[] = []

    workerOutputs.forEach((output, workerIndex) => {
      const edits = this.extractFileEdits(output)
      for (const edit of edits) {
        if (!byFile.has(edit.file)) {
          byFile.set(edit.file, [])
        }
        byFile.get(edit.file)?.push({ workerIndex, content: edit.content })
      }
    })

    const mergedChunks: string[] = []
    const conflicts: string[] = []

    for (const [file, candidates] of byFile.entries()) {
      if (candidates.length === 0) continue

      let winner = candidates[0]
      for (let i = 1; i < candidates.length; i++) {
        const candidate = candidates[i]
        // Deterministic heuristic: prefer longer non-empty content.
        if (candidate.content.length > winner.content.length) {
          winner = candidate
        }
      }

      if (candidates.length > 1) {
        conflicts.push(file)
        decisions.push({
          file,
          keptFrom: winner.workerIndex,
          replaced: candidates
            .filter((c) => c.workerIndex !== winner.workerIndex)
            .map((c) => c.workerIndex),
          reason: "Kept longest edit content",
        })
      }

      mergedChunks.push(`FILE: ${file}\n${winner.content}`.trim())
    }

    return {
      mergedOutput: mergedChunks.join("\n\n"),
      conflicts,
      decisions,
    }
  }
}
