/**
 * DeadlineTimer - 带有暂停/恢复功能的计时器
 *
 * 用于追踪 subagent 执行时间，支持宽限期恢复
 */

export interface DeadlineTimerConfig {
  timeoutMs: number
  onTimeout?: () => void
}

export class DeadlineTimer {
  private timeoutMs: number
  private startTime: number = 0
  private paused: boolean = false
  private elapsedBeforePause: number = 0
  private timeoutId?: NodeJS.Timeout
  private onTimeout?: () => void

  constructor(config: DeadlineTimerConfig) {
    this.timeoutMs = config.timeoutMs
    this.onTimeout = config.onTimeout
  }

  start(): void {
    this.startTime = Date.now()
    this.elapsedBeforePause = 0
    this.paused = false
    this.scheduleTimeout()
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    this.elapsedBeforePause = Date.now() - this.startTime
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = undefined
    }
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.startTime = Date.now() - this.elapsedBeforePause
    this.scheduleTimeout()
  }

  private scheduleTimeout(): void {
    const remaining = this.getRemainingMs()
    if (remaining <= 0) {
      this.onTimeout?.()
      return
    }
    this.timeoutId = setTimeout(() => {
      this.onTimeout?.()
    }, remaining)
  }

  getRemainingMs(): number {
    if (this.paused) {
      return this.timeoutMs - this.elapsedBeforePause
    }
    return Math.max(0, this.timeoutMs - (Date.now() - this.startTime))
  }

  isPaused(): boolean {
    return this.paused
  }

  isExpired(): boolean {
    return this.getRemainingMs() <= 0
  }

  destroy(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = undefined
    }
  }
}
