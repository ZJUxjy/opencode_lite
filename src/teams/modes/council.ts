/**
 * Council 模式
 *
 * 用于架构决策的多 Agent 讨论，不直接修改代码。
 * 输出为"决策记录 + 执行建议"，再交给执行型模式落地。
 *
 * 角色组成：
 * - Speaker: 主持讨论，引导议题，总结共识
 * - Members: 提供不同视角和专业意见
 *
 * 适用场景：
 * - 技术选型决策
 * - 架构方案评估
 * - 技术债务优先级排序
 * - 复杂问题多方案对比
 */

import type { Agent } from "../../agent.js"
import type { TeamConfig, TeamResult } from "../types.js"
import { SharedBlackboard } from "../blackboard.js"
import { CostController } from "../cost-controller.js"
import { ProgressTracker } from "../progress-tracker.js"

/**
 * 决策选项
 */
export interface DecisionOption {
  /** 选项名称 */
  name: string
  /** 选项描述 */
  description: string
  /** 优缺点 */
  pros: string[]
  cons: string[]
  /** 风险评估 */
  risks: string[]
  /** 预估工作量 */
  estimatedEffort: "low" | "medium" | "high"
  /** 支持者 */
  supporters: string[]
}

/**
 * 决策记录
 */
export interface DecisionRecord {
  /** 决策 ID */
  decisionId: string
  /** 决策主题 */
  topic: string
  /** 背景/问题陈述 */
  context: string
  /** 考虑的选项 */
  options: DecisionOption[]
  /** 最终决策 */
  decision: {
    chosen: string
    rationale: string
    confidence: "low" | "medium" | "high"
  }
  /** 执行建议 */
  executionPlan: {
    steps: string[]
    prerequisites: string[]
    timeline: string
    assignee: string
  }
  /** 决策参与者 */
  participants: string[]
  /** 决策时间 */
  timestamp: number
  /** 决策有效期（可选） */
  validUntil?: number
}

/**
 * 讨论轮次
 */
export interface DiscussionRound {
  /** 轮次编号 */
  round: number
  /** 议题 */
  topic: string
  /** 各成员观点 */
  opinions: Array<{
    memberId: string
    opinion: string
    stance: "support" | "oppose" | "neutral"
    keyPoints: string[]
  }>
  /** 共识点 */
  agreements: string[]
  /** 分歧点 */
  disagreements: string[]
}

/**
 * Council 团队
 */
export class CouncilTeam {
  private config: TeamConfig
  private speaker: Agent
  private members: Agent[]
  private blackboard: SharedBlackboard
  private costController: CostController
  private progressTracker: ProgressTracker
  private debug: boolean

  /** 最大讨论轮次 */
  private readonly MAX_DISCUSSION_ROUNDS = 3

  constructor(
    config: TeamConfig,
    speaker: Agent,
    members: Agent[],
    options?: { debug?: boolean }
  ) {
    if (config.mode !== "council") {
      throw new Error("Invalid mode for CouncilTeam")
    }

    if (members.length < 2) {
      throw new Error("Council requires at least 2 members")
    }

    this.config = config
    this.speaker = speaker
    this.members = members
    this.blackboard = new SharedBlackboard()
    this.costController = new CostController(config.budget)
    this.progressTracker = new ProgressTracker(config.maxIterations)
    this.debug = options?.debug ?? false
  }

  /**
   * 调试日志
   */
  private log(message: string): void {
    if (this.debug) {
      console.log(message)
    }
  }

  /**
   * 执行 Council 决策流程
   */
  async execute(decisionTopic: string): Promise<TeamResult> {
    const startTime = Date.now()
    const discussionRounds: DiscussionRound[] = []
    let decisionRecord: DecisionRecord | null = null

    try {
      this.log("\n[Council] Starting decision process...")
      this.log(`[Topic] ${decisionTopic}`)

      // Phase 1: Speaker 定义问题和背景
      this.log("\n[Phase 1] Speaker defining problem context...")
      const context = await this.defineContext(decisionTopic)

      // Phase 2: 生成候选选项
      this.log("[Phase 2] Generating candidate options...")
      const options = await this.generateOptions(decisionTopic, context)
      this.log(`[Phase 2] Generated ${options.length} options`)

      // Phase 3: 多轮讨论
      this.log("\n[Phase 3] Starting multi-round discussion...")
      for (let round = 1; round <= this.MAX_DISCUSSION_ROUNDS; round++) {
        this.log(`\n[Round ${round}] Discussion...`)

        const roundResult = await this.conductDiscussionRound(
          round,
          decisionTopic,
          options,
          discussionRounds
        )
        discussionRounds.push(roundResult)

        // 检查是否达成共识
        if (roundResult.agreements.length > 0 && roundResult.disagreements.length === 0) {
          this.log(`[Round ${round}] Consensus reached!`)
          break
        }

        // 更新选项支持度
        this.updateOptionSupport(options, roundResult)
      }

      // Phase 4: Speaker 总结并做出决策
      this.log("\n[Phase 4] Speaker summarizing and making decision...")
      decisionRecord = await this.makeDecision(
        decisionTopic,
        context,
        options,
        discussionRounds
      )

      // Phase 5: 生成执行计划
      this.log("[Phase 5] Generating execution plan...")
      const executionPlan = await this.generateExecutionPlan(decisionRecord)

      decisionRecord.executionPlan = executionPlan

      const duration = Date.now() - startTime
      const costSummary = this.costController.getSummary()

      return {
        status: "success",
        summary: `Decision made: ${decisionRecord.decision.chosen} (confidence: ${decisionRecord.decision.confidence})`,
        artifacts: [],
        stats: {
          duration,
          iterations: discussionRounds.length,
          totalCost: costSummary.total,
          totalTokens: this.costController.getTotalTokens(),
        },
        metadata: {
          decisionRecord,
          discussionRounds,
        },
      }
    } catch (error) {
      const duration = Date.now() - startTime
      const costSummary = this.costController.getSummary()

      return {
        status: "failure",
        summary: error instanceof Error ? error.message : "Unknown error",
        artifacts: [],
        stats: {
          duration,
          iterations: discussionRounds.length,
          totalCost: costSummary.total,
          totalTokens: this.costController.getTotalTokens(),
        },
      }
    }
  }

  /**
   * 定义问题背景
   */
  private async defineContext(topic: string): Promise<string> {
    const prompt = `You are the Speaker of a technical council.

**Topic for Decision**: ${topic}

As the Speaker, please define:
1. BACKGROUND: What is the context and why is this decision needed?
2. PROBLEM_STATEMENT: What specific problem are we trying to solve?
3. CONSTRAINTS: What constraints must we consider (time, resources, existing systems)?
4. SUCCESS_CRITERIA: How will we know if we made the right decision?
5. STAKEHOLDERS: Who will be affected by this decision?

Provide a clear, concise context that will help council members understand the decision scope.`

    const response = await this.speaker.run(prompt)
    return response
  }

  /**
   * 生成候选选项
   */
  private async generateOptions(
    topic: string,
    context: string
  ): Promise<DecisionOption[]> {
    // 并行让每个成员提出选项
    const promptTemplate = (index: number) => `You are a Council Member with expertise in your domain.

**Decision Topic**: ${topic}

**Context**:
${context}

Please propose ONE solution option. Consider:
- Technical feasibility
- Resource requirements
- Risk factors
- Time to implement

Format your response as:
OPTION_NAME: <name>
DESCRIPTION: <brief description>
PROS:
- pro 1
- pro 2
CONS:
- con 1
- con 2
RISKS:
- risk 1
EFFORT: <low/medium/high>`

    // 并行执行所有成员的选项生成
    const responses = await Promise.all(
      this.members.map((member, i) => member.run(promptTemplate(i)))
    )

    // 解析所有响应
    const options = responses
      .map((response, i) => this.parseOption(response, `member-${i}`))
      .filter((option): option is DecisionOption => option !== null)

    // Speaker 可能添加一个综合选项
    if (options.length > 1) {
      const speakerOption = await this.synthesizeOptions(topic, options)
      if (speakerOption) {
        options.push(speakerOption)
      }
    }

    return options
  }

  /**
   * 进行讨论轮次
   */
  private async conductDiscussionRound(
    round: number,
    topic: string,
    options: DecisionOption[],
    previousRounds: DiscussionRound[]
  ): Promise<DiscussionRound> {
    // 并行让每个成员发表意见
    const responses = await Promise.all(
      this.members.map((member, i) => {
        const prompt = this.buildDiscussionPrompt(round, topic, options, previousRounds, i)
        return member.run(prompt)
      })
    )

    // 解析所有意见
    const opinions = responses.map((response, i) =>
      this.parseOpinion(response, `member-${i}`)
    )

    // Speaker 总结本轮讨论
    const summary = await this.summarizeRound(round, opinions, options)

    return {
      round,
      topic,
      opinions,
      agreements: summary.agreements,
      disagreements: summary.disagreements,
    }
  }

  /**
   * 构建讨论提示
   */
  private buildDiscussionPrompt(
    round: number,
    topic: string,
    options: DecisionOption[],
    previousRounds: DiscussionRound[],
    memberIndex: number
  ): string {
    let prompt = `You are Council Member ${memberIndex + 1}.

**Decision Topic**: ${topic}

**Current Options**:
${options.map((o, i) => `${i + 1}. ${o.name}: ${o.description}`).join("\n")}

`

    if (previousRounds.length > 0) {
      prompt += `**Previous Discussion Summary**:\n`
      const lastRound = previousRounds[previousRounds.length - 1]
      prompt += `Agreements: ${lastRound.agreements.join(", ")}\n`
      prompt += `Disagreements: ${lastRound.disagreements.join(", ")}\n\n`
    }

    prompt += `Round ${round}: Please provide your opinion.

Format:
STANCE: <support/oppose/neutral> - which option do you prefer?
KEY_POINTS:
- point 1
- point 2
CONCERNS: <any concerns about your preferred option?>
QUESTIONS: <any clarifying questions?>`

    return prompt
  }

  /**
   * 解析选项
   */
  private parseOption(response: string, memberId: string): DecisionOption | null {
    const nameMatch = response.match(/OPTION_NAME:\s*(.+?)(?:\n|$)/i)
    const descMatch = response.match(/DESCRIPTION:\s*(.+?)(?:\n|$)/i)
    const effortMatch = response.match(/EFFORT:\s*(low|medium|high)/i)

    if (!nameMatch) return null

    return {
      name: nameMatch[1].trim(),
      description: descMatch?.[1]?.trim() || "",
      pros: this.extractList(response, "PROS"),
      cons: this.extractList(response, "CONS"),
      risks: this.extractList(response, "RISKS"),
      estimatedEffort: (effortMatch?.[1]?.toLowerCase() as any) || "medium",
      supporters: [memberId],
    }
  }

  /**
   * 解析意见
   */
  private parseOpinion(
    response: string,
    memberId: string
  ): DiscussionRound["opinions"][0] {
    const stanceMatch = response.match(/STANCE:\s*(support|oppose|neutral)/i)

    return {
      memberId,
      opinion: response.substring(0, 500),
      stance: (stanceMatch?.[1]?.toLowerCase() as any) || "neutral",
      keyPoints: this.extractList(response, "KEY_POINTS"),
    }
  }

  /**
   * 综合选项
   */
  private async synthesizeOptions(
    topic: string,
    options: DecisionOption[]
  ): Promise<DecisionOption | null> {
    const prompt = `You are the Speaker. Based on the proposed options, suggest a HYBRID or COMPROMISE option.

**Topic**: ${topic}

**Proposed Options**:
${options.map(o => `- ${o.name}: ${o.description}`).join("\n")}

Consider:
- Can we combine the best aspects of multiple options?
- Is there a middle-ground approach?
- What trade-offs are acceptable?

Format your response the same way as other options:
OPTION_NAME: <name>
DESCRIPTION: <brief description>
PROS:
- pro 1
CONS:
- con 1
RISKS:
- risk 1
EFFORT: <low/medium/high>`

    const response = await this.speaker.run(prompt)
    return this.parseOption(response, "speaker-synthesis")
  }

  /**
   * 总结讨论轮次
   */
  private async summarizeRound(
    round: number,
    opinions: DiscussionRound["opinions"],
    options: DecisionOption[]
  ): Promise<{ agreements: string[]; disagreements: string[] }> {
    const prompt = `You are the Speaker. Summarize this round of discussion.

**Opinions**:
${opinions.map(o => `- ${o.memberId}: ${o.stance} - ${o.keyPoints.join(", ")}`).join("\n")}

**Options**:
${options.map(o => `${o.name} (supporters: ${o.supporters.length})`).join(", ")}

Identify:
1. AGREEMENTS: Points where all members agree
2. DISAGREEMENTS: Points where members disagree

Format:
AGREEMENTS:
- agreement 1
DISAGREEMENTS:
- disagreement 1`

    const response = await this.speaker.run(prompt)

    return {
      agreements: this.extractList(response, "AGREEMENTS"),
      disagreements: this.extractList(response, "DISAGREEMENTS"),
    }
  }

  /**
   * 更新选项支持度
   */
  private updateOptionSupport(
    options: DecisionOption[],
    roundResult: DiscussionRound
  ): void {
    for (const opinion of roundResult.opinions) {
      // 根据意见找到支持的选项
      const supportedOption = options.find(
        o => opinion.opinion.toLowerCase().includes(o.name.toLowerCase())
      )
      if (supportedOption && !supportedOption.supporters.includes(opinion.memberId)) {
        supportedOption.supporters.push(opinion.memberId)
      }
    }
  }

  /**
   * 做出最终决策
   */
  private async makeDecision(
    topic: string,
    context: string,
    options: DecisionOption[],
    rounds: DiscussionRound[]
  ): Promise<DecisionRecord> {
    const prompt = `You are the Speaker. Based on all discussions, make the final decision.

**Topic**: ${topic}

**Options with Support**:
${options.map(o => `- ${o.name}: ${o.supporters.length} supporters`).join("\n")}

**Discussion Summary**:
- Total rounds: ${rounds.length}
- Final agreements: ${rounds[rounds.length - 1]?.agreements.join(", ") || "None"}
- Remaining disagreements: ${rounds[rounds.length - 1]?.disagreements.join(", ") || "None"}

Make a decision and provide:

DECISION: <chosen option name>
RATIONALE: <why this option was chosen>
CONFIDENCE: <low/medium/high>
EXECUTION_STEPS:
- step 1
- step 2
PREREQUISITES:
- prerequisite 1
TIMELINE: <estimated timeline>
ASSIGNEE: <who should execute>`

    const response = await this.speaker.run(prompt)

    const decisionMatch = response.match(/DECISION:\s*(.+?)(?:\n|$)/i)
    const rationaleMatch = response.match(/RATIONALE:\s*(.+?)(?:\n|$)/i)
    const confidenceMatch = response.match(/CONFIDENCE:\s*(low|medium|high)/i)

    return {
      decisionId: `decision-${Date.now()}`,
      topic,
      context,
      options,
      decision: {
        chosen: decisionMatch?.[1]?.trim() || options[0]?.name || "No decision",
        rationale: rationaleMatch?.[1]?.trim() || "",
        confidence: (confidenceMatch?.[1]?.toLowerCase() as any) || "medium",
      },
      executionPlan: {
        steps: this.extractList(response, "EXECUTION_STEPS"),
        prerequisites: this.extractList(response, "PREREQUISITES"),
        timeline: this.extractSection(response, "TIMELINE") || "TBD",
        assignee: this.extractSection(response, "ASSIGNEE") || "TBD",
      },
      participants: ["speaker", ...this.members.map((_, i) => `member-${i}`)],
      timestamp: Date.now(),
    }
  }

  /**
   * 生成执行计划
   */
  private async generateExecutionPlan(
    record: DecisionRecord
  ): Promise<DecisionRecord["executionPlan"]> {
    // 如果已经有执行计划，直接返回
    if (record.executionPlan.steps.length > 0) {
      return record.executionPlan
    }

    // 否则生成一个基本的执行计划
    const prompt = `Based on this decision, create a detailed execution plan.

**Decision**: ${record.decision.chosen}
**Rationale**: ${record.decision.rationale}

Provide:
1. Step-by-step implementation plan
2. Required resources and prerequisites
3. Estimated timeline
4. Who should be responsible

Format as:
STEPS:
- step 1
- step 2
PREREQUISITES:
- prerequisite 1
TIMELINE: <timeline>
ASSIGNEE: <role/team>`

    const response = await this.speaker.run(prompt)

    return {
      steps: this.extractList(response, "STEPS"),
      prerequisites: this.extractList(response, "PREREQUISITES"),
      timeline: this.extractSection(response, "TIMELINE") || "TBD",
      assignee: this.extractSection(response, "ASSIGNEE") || "TBD",
    }
  }

  // ============ 辅助方法 ============

  private extractSection(response: string, section: string): string | null {
    const regex = new RegExp(`${section}:\\s*(.+?)(?=\\n[A-Z_]+:|$)`, "is")
    const match = response.match(regex)
    return match ? match[1].trim() : null
  }

  private extractList(response: string, section: string): string[] {
    const content = this.extractSection(response, section)
    if (!content) return []

    return content
      .split("\n")
      .map(line => line.replace(/^[\s-*]*/, "").trim())
      .filter(line => line.length > 0 && line !== "None" && line !== "N/A")
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.blackboard.clear()
    this.costController.clear()
    this.progressTracker.clear()
  }
}
