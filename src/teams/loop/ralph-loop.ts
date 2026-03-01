import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

export interface RalphTaskQueue {
  pending: string[]
  inProgress: string[]
  completed: string[]
}

export interface RalphLoopConfig {
  taskFilePath: string
  progressFilePath: string
  maxIterations: number
  cooldownMs: number
}

export interface RalphLoopSummary {
  processed: number
  completed: string[]
  failed: string[]
}

export class RalphLoopManager {
  loadQueue(taskFilePath: string): RalphTaskQueue {
    const abs = resolve(taskFilePath)
    if (!existsSync(abs)) {
      return { pending: [], inProgress: [], completed: [] }
    }
    try {
      const content = readFileSync(abs, "utf8")
      return this.parseQueue(content)
    } catch {
      return { pending: [], inProgress: [], completed: [] }
    }
  }

  saveQueue(taskFilePath: string, queue: RalphTaskQueue): void {
    const abs = resolve(taskFilePath)
    mkdirSync(dirname(abs), { recursive: true })
    const lines: string[] = [
      "# Task Queue",
      "",
      "## Pending",
      ...queue.pending.map((t) => `- [ ] ${t}`),
      "",
      "## In Progress",
      ...queue.inProgress.map((t) => `- [~] ${t}`),
      "",
      "## Completed",
      ...queue.completed.map((t) => `- [x] ${t}`),
      "",
    ]
    writeFileSync(abs, lines.join("\n"), "utf8")
  }

  dequeuePending(queue: RalphTaskQueue): string | null {
    if (queue.pending.length === 0) return null
    const task = queue.pending.shift() || null
    if (task) {
      queue.inProgress.push(task)
    }
    return task
  }

  markCompleted(queue: RalphTaskQueue, task: string): void {
    queue.inProgress = queue.inProgress.filter((t) => t !== task)
    if (!queue.completed.includes(task)) {
      queue.completed.push(task)
    }
  }

  markFailed(queue: RalphTaskQueue, task: string): void {
    queue.inProgress = queue.inProgress.filter((t) => t !== task)
    if (!queue.pending.includes(task)) {
      queue.pending.unshift(task)
    }
  }

  appendProgress(progressFilePath: string, line: string): void {
    const abs = resolve(progressFilePath)
    mkdirSync(dirname(abs), { recursive: true })
    appendFileSync(abs, `${line}\n`, "utf8")
  }

  private parseQueue(content: string): RalphTaskQueue {
    const queue: RalphTaskQueue = { pending: [], inProgress: [], completed: [] }
    const lines = content.split(/\r?\n/)
    let section: "pending" | "inProgress" | "completed" | null = null

    for (const raw of lines) {
      const line = raw.trim()
      if (/^##\s+pending/i.test(line)) {
        section = "pending"
        continue
      }
      if (/^##\s+in progress/i.test(line)) {
        section = "inProgress"
        continue
      }
      if (/^##\s+completed/i.test(line)) {
        section = "completed"
        continue
      }

      const unchecked = line.match(/^- \[\s\]\s+(.+)$/)
      const doing = line.match(/^- \[~\]\s+(.+)$/)
      const done = line.match(/^- \[x\]\s+(.+)$/i)
      if (unchecked) queue.pending.push(unchecked[1].trim())
      if (doing) queue.inProgress.push(doing[1].trim())
      if (done) queue.completed.push(done[1].trim())
    }

    if (section === null) {
      // Fallback: support plain line tasks
      for (const raw of lines) {
        const task = raw.trim()
        if (task && !task.startsWith("#")) {
          queue.pending.push(task.replace(/^-+\s*/, ""))
        }
      }
    }

    return queue
  }
}
