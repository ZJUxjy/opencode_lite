export interface DagTask {
  id: string
  title: string
  dependsOn: string[]
}

export class TaskDagPlanner {
  parseOrFallback(raw: string): DagTask[] {
    const match = raw.match(/\[[\s\S]*\]/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as Array<{ id?: string; title?: string; dependsOn?: string[] }>
        const tasks = parsed
          .filter((t) => t.id && t.title)
          .map((t) => ({
            id: String(t.id),
            title: String(t.title),
            dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.map(String) : [],
          }))
        if (tasks.length > 0) return tasks
      } catch {
        // fallthrough to fallback
      }
    }

    return [
      { id: "task-1", title: "Implement core solution", dependsOn: [] },
      { id: "task-2", title: "Integrate and verify", dependsOn: ["task-1"] },
    ]
  }

  topologicalOrder(tasks: DagTask[]): DagTask[] {
    const map = new Map<string, DagTask>()
    for (const task of tasks) {
      if (map.has(task.id)) {
        throw new Error(`Duplicate task id in DAG: ${task.id}`)
      }
      map.set(task.id, task)
    }

    const visited = new Set<string>()
    const visiting = new Set<string>()
    const ordered: DagTask[] = []

    const visit = (id: string) => {
      if (visited.has(id)) return
      if (visiting.has(id)) {
        throw new Error(`Cyclic dependency detected at task: ${id}`)
      }

      visiting.add(id)
      const node = map.get(id)
      if (!node) {
        visiting.delete(id)
        visited.add(id)
        return
      }
      node.dependsOn.forEach(visit)
      visiting.delete(id)
      visited.add(id)
      ordered.push(node)
    }

    tasks.forEach((t) => visit(t.id))
    return ordered
  }

  executionLayers(tasks: DagTask[]): DagTask[][] {
    const map = new Map<string, DagTask>()
    const indegree = new Map<string, number>()
    const outgoing = new Map<string, string[]>()

    for (const task of tasks) {
      if (map.has(task.id)) {
        throw new Error(`Duplicate task id in DAG: ${task.id}`)
      }
      map.set(task.id, task)
      indegree.set(task.id, 0)
      outgoing.set(task.id, [])
    }

    for (const task of tasks) {
      for (const dep of task.dependsOn) {
        if (!map.has(dep)) {
          throw new Error(`Missing dependency '${dep}' for task '${task.id}'`)
        }
        indegree.set(task.id, (indegree.get(task.id) || 0) + 1)
        outgoing.get(dep)?.push(task.id)
      }
    }

    const layers: DagTask[][] = []
    let frontier = tasks.filter((t) => (indegree.get(t.id) || 0) === 0).map((t) => t.id)
    let processed = 0

    while (frontier.length > 0) {
      const currentLayer = frontier.map((id) => map.get(id)).filter((v): v is DagTask => !!v)
      layers.push(currentLayer)
      processed += currentLayer.length

      const next: string[] = []
      for (const id of frontier) {
        const dependents = outgoing.get(id) || []
        for (const dependent of dependents) {
          const nextIn = (indegree.get(dependent) || 0) - 1
          indegree.set(dependent, nextIn)
          if (nextIn === 0) {
            next.push(dependent)
          }
        }
      }

      frontier = next
    }

    if (processed !== tasks.length) {
      throw new Error("Cyclic dependency detected in DAG layers")
    }

    return layers
  }
}
