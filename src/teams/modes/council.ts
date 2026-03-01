import { EventEmitter } from "events"
import type { TeamConfig, TeamStatus } from "../types.js"
import type { DecisionArtifact } from "../contracts.js"

// ============================================================================
// CouncilRunner - Council 模式运行器
// ============================================================================

/**
 * Council 模式
 *
 * 适用场景：架构决策、技术选型
 *
 * 角色：
 * 1. Speaker：陈述问题、引导讨论
 * 2. Members：提供方案、评估利弊
 * 3. (可选) Leader/Moderator：总结决策
 *
 * 输出：
 * - DecisionArtifact：决策记录 + 执行建议
 * - 不直接改代码，产出决策文档
 */
export class CouncilRunner extends EventEmitter {
  private config: TeamConfig

  // 组件
  private status: TeamStatus = "initializing"

  // 回调
  private speakerExecutor: (topic: string) => Promise<CouncilTopic>
  private memberExecutors: Array<(topic: CouncilTopic) => Promise<MemberOpinion>>

  // 状态
  private currentTopic: string = ""
  private topic: CouncilTopic | null = null
  private memberOpinions: MemberOpinion[] = []
  private finalDecision: DecisionArtifact | null = null

  constructor(
    config: TeamConfig,
    callbacks: {
      speakerExecutor: (topic: string) => Promise<CouncilTopic>
      memberExecutors: Array<(topic: CouncilTopic) => Promise<MemberOpinion>>
    }
  ) {
    super()
    this.config = config
    this.speakerExecutor = callbacks.speakerExecutor
    this.memberExecutors = callbacks.memberExecutors

    this.setupEventHandlers()
  }

  // ========================================================================
  // 事件处理
  // ========================================================================

  private setupEventHandlers(): void {
    this.on("member-opinion", (opinion) => {
      this.memberOpinions.push(opinion)
    })

    this.on("decision-made", (decision) => {
      this.finalDecision = decision
    })
  }

  // ========================================================================
  // 状态管理
  // ========================================================================

  private setStatus(status: TeamStatus): void {
    if (this.status === status) return

    this.status = status
    this.emit("status-changed", status)
  }

  getStatus(): TeamStatus {
    return this.status
  }

  // ========================================================================
  // 决策执行
  // ========================================================================

  /**
   * 执行决策讨论
   */
  async run(topic: string): Promise<DecisionArtifact | null> {
    this.setStatus("running")
    this.currentTopic = topic

    try {
      // 阶段 1: Speaker 陈述问题
      this.emit("phase-change", { phase: "presentation" })
      const councilTopic = await this.executeSpeaker(topic)

      if (!councilTopic) {
        this.setStatus("failed")
        return null
      }

      this.topic = councilTopic

      // 阶段 2: Members 提供方案
      this.emit("phase-change", { phase: "discussion" })
      const opinions = await this.executeMembers(councilTopic)

      this.memberOpinions = opinions

      // 阶段 3: 综合评估
      this.emit("phase-change", { phase: "evaluation" })
      const decision = this.evaluateAndDecide(councilTopic, opinions)

      this.finalDecision = decision
      this.setStatus("completed")

      return decision
    } catch (error) {
      this.setStatus("failed")
      this.emit("error", { error })
      return null
    }
  }

  /**
   * Speaker 执行
   */
  private async executeSpeaker(topic: string): Promise<CouncilTopic | null> {
    try {
      const councilTopic = await this.speakerExecutor(topic)
      this.emit("topic-presented", councilTopic)
      return councilTopic
    } catch (error) {
      this.emit("speaker-error", { error })
      return null
    }
  }

  /**
   * Members 并行执行
   */
  private async executeMembers(topic: CouncilTopic): Promise<MemberOpinion[]> {
    const promises = this.memberExecutors.map(async (executor, index): Promise<MemberOpinion> => {
      try {
        const opinion = await executor(topic)
        this.emit("member-opinion", { memberId: `member-${index}`, opinion })
        return opinion
      } catch (error) {
        this.emit("member-error", { memberId: `member-${index}`, error })
        return {
          memberId: `member-${index}`,
          position: "abstain" as const,
          reasoning: `执行失败: ${error}`,
          pros: [],
          cons: [],
          recommendation: "需要更多信息",
        }
      }
    })

    return Promise.all(promises)
  }

  /**
   * 评估并决策
   */
  private evaluateAndDecide(topic: CouncilTopic, opinions: MemberOpinion[]): DecisionArtifact {
    // 收集所有方案
    const options: DecisionOption[] = []

    for (const opinion of opinions) {
      if (opinion.position === "support" || opinion.position === "neutral") {
        if (opinion.proposedSolution) {
          options.push({
            name: opinion.proposedSolution.name,
            pros: opinion.pros,
            cons: opinion.cons,
            recommendation: opinion.recommendation,
          })
        }
      }
    }

    // 去重方案
    const uniqueOptions = this.deduplicateOptions(options)

    // 统计支持意见
    const supportCount = opinions.filter((o) => o.position === "support").length
    const opposeCount = opinions.filter((o) => o.position === "oppose").length

    // 生成决策
    const finalDecision = supportCount > opposeCount ? "采用方案" : "需要更多信息"

    // 生成理由
    const reasoning = this.generateReasoning(topic, opinions, uniqueOptions)

    // 生成执行建议
    const actionItems = this.generateActionItems(topic, uniqueOptions)

    return {
      topic: topic.question,
      options: uniqueOptions,
      finalDecision,
      reasoning,
      actionItems,
    }
  }

  /**
   * 去重方案
   */
  private deduplicateOptions(options: DecisionOption[]): DecisionOption[] {
    const seen = new Set<string>()
    const unique: DecisionOption[] = []

    for (const option of options) {
      const key = option.name.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        unique.push(option)
      } else {
        // 合并 pros 和 cons
        const existing = unique.find((u) => u.name.toLowerCase() === key)
        if (existing) {
          existing.pros = [...new Set([...existing.pros, ...option.pros])]
          existing.cons = [...new Set([...existing.cons, ...option.cons])]
        }
      }
    }

    return unique
  }

  /**
   * 生成理由
   */
  private generateReasoning(topic: CouncilTopic, opinions: MemberOpinion[], options: DecisionOption[]): string {
    const lines: string[] = []

    lines.push(`议题: ${topic.question}`)
    lines.push("")

    // 参与情况
    const supportCount = opinions.filter((o) => o.position === "support").length
    const opposeCount = opinions.filter((o) => o.position === "oppose").length
    const abstainCount = opinions.filter((o) => o.position === "abstain").length

    lines.push(`讨论结果:`)
    lines.push(`- 支持: ${supportCount}`)
    lines.push(`- 反对: ${opposeCount}`)
    lines.push(`- 弃权: ${abstainCount}`)
    lines.push("")

    // 方案汇总
    if (options.length > 0) {
      lines.push("提出的方案:")
      for (const option of options) {
        lines.push(`- ${option.name}`)
      }
    }

    return lines.join("\n")
  }

  /**
   * 生成执行建议
   */
  private generateActionItems(topic: CouncilTopic, options: DecisionOption[]): string[] {
    const actionItems: string[] = []

    // 基于讨论生成行动项
    if (options.length === 0) {
      actionItems.push("需要进一步调研以确定方案")
    } else if (options.length === 1) {
      actionItems.push(`执行方案: ${options[0].name}`)
      actionItems.push("制定详细实施计划")
    } else {
      actionItems.push("评估多个可行方案")
      actionItems.push("选择最佳方案进行实施")
    }

    // 添加后续步骤
    actionItems.push("安排技术分享会")
    actionItems.push("更新相关文档")

    return actionItems
  }

  // ========================================================================
  // 状态查询
  // ========================================================================

  /**
   * 获取成员意见
   */
  getMemberOpinions(): MemberOpinion[] {
    return this.memberOpinions
  }

  /**
   * 获取最终决策
   */
  getDecision(): DecisionArtifact | null {
    return this.finalDecision
  }

  /**
   * 获取统计信息
   */
  getStats(): CouncilStats {
    return {
      status: this.status,
      currentTopic: this.currentTopic,
      memberCount: this.memberExecutors.length,
      opinionCount: this.memberOpinions.length,
      hasDecision: this.finalDecision !== null,
    }
  }

  /**
   * 取消执行
   */
  cancel(): void {
    this.setStatus("cancelled")
  }
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Council 议题
 */
export interface CouncilTopic {
  question: string
  context: string
  constraints: string[]
  successCriteria: string[]
}

/**
 * 成员意见
 */
export interface MemberOpinion {
  memberId: string
  position: "support" | "oppose" | "neutral" | "abstain"
  reasoning: string
  proposedSolution?: DecisionOption
  pros: string[]
  cons: string[]
  recommendation: string
  confidence?: number // 0-100
}

/**
 * 决策方案
 */
export interface DecisionOption {
  name: string
  pros: string[]
  cons: string[]
  recommendation: string
}

export interface CouncilStats {
  status: TeamStatus
  currentTopic: string
  memberCount: number
  opinionCount: number
  hasDecision: boolean
}
