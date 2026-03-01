export class SharedBlackboard {
  private state = new Map<string, unknown>()
  private watchers = new Map<string, Set<(value: unknown) => void>>()

  set(key: string, value: unknown): void {
    this.state.set(key, value)
    this.notify(key, value)
  }

  get<T>(key: string): T | undefined {
    return this.state.get(key) as T | undefined
  }

  watch(key: string, callback: (value: unknown) => void): () => void {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, new Set())
    }

    this.watchers.get(key)?.add(callback)
    return () => {
      this.watchers.get(key)?.delete(callback)
    }
  }

  exportSnapshot(): Map<string, unknown> {
    return new Map(this.state)
  }

  importSnapshot(snapshot: Map<string, unknown>): void {
    this.state = new Map(snapshot)
  }

  private notify(key: string, value: unknown): void {
    this.watchers.get(key)?.forEach((cb) => cb(value))
  }
}
