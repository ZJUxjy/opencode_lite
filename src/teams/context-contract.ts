/**
 * Context Contract - 宽松上下文契约
 *
 * 基于 agent-teams-supplement.md 原则 1: Context, Not Control
 *
 * 提供目标导向而非指令导向的任务定义，给 Agent 更多自主判断空间。
 *
 * 设计原则：
 * - 目标而非步骤
 * - 背景知识而非指令
 * - 边界而非范围
 * - 输出期望而非格式
 */

import type { AgentRole } from "./types.js"

/**
 * 上下文引用
 */
export interface ContextReference {
  /** 引用类型 */
  type: "file" | "url" | "documentation" | "code"
  /** 引用路径或 URL */
  path: string
  /** 引用描述 */
  description?: string
  /** 是否必读 */
  required?: boolean
}

/**
 * 边界约束
 */
export interface BoundaryConstraints {
  /** 禁止事项 */
  mustNot: string[]
  /** 建议考虑 */
  shouldConsider: string[]
  /** 硬性约束（不可违反） */
  hardConstraints?: string[]
}

/**
 * 输出期望
 */
export interface OutputExpectation {
  /** 期望意图 */
  intent: string
  /** 验证提示（如何验证结果） */
  validationHint: string
  /** 成功标准 */
  successCriteria?: string[]
  /** 可选的输出格式建议 */
  formatSuggestion?: string
}

/**
 * 上下文契约
 */
export interface ContextContract {
  /** 契约 ID */
  id: string
  /** 目标（而非步骤） */
  objective: string
  /** 背景/问题陈述 */
  background: string
  /** 背景知识引用 */
  context: {
    /** 背景描述 */
    description: string
    /** 约束条件 */
    constraints: string[]
    /** 参考资源 */
    references: ContextReference[]
  }
  /** 边界约束（而非范围） */
  boundaries: BoundaryConstraints
  /** 输出期望（而非格式） */
  expectedOutcome: OutputExpectation
  /** 元数据 */
  metadata: {
    /** 创建时间 */
    createdAt: number
    /** 创建者 */
    createdBy: string
    /** 优先级 */
    priority?: "low" | "medium" | "high" | "critical"
    /** 预估复杂度 */
    complexity?: "simple" | "medium" | "complex"
    /** 分配给的角色 */
    assignedRole?: AgentRole
    /** 标签 */
    tags?: string[]
  }
}

/**
 * 从 ContextContract 生成 Agent 提示
 */
export function generateContextPrompt(contract: ContextContract): string {
  const sections: string[] = []

  // 目标
  sections.push("# 任务目标")
  sections.push("")
  sections.push(contract.objective)
  sections.push("")

  // 背景
  sections.push("## 背景")
  sections.push("")
  sections.push(contract.background)
  sections.push("")

  if (contract.context.constraints.length > 0) {
    sections.push("### 约束条件")
    for (const constraint of contract.context.constraints) {
      sections.push(`- ${constraint}`)
    }
    sections.push("")
  }

  if (contract.context.references.length > 0) {
    sections.push("### 参考资源")
    for (const ref of contract.context.references) {
      const required = ref.required ? " [必读]" : ""
      sections.push(`- **${ref.type}**: ${ref.path}${required}`)
      if (ref.description) {
        sections.push(`  ${ref.description}`)
      }
    }
    sections.push("")
  }

  // 边界
  sections.push("## 边界约束")
  sections.push("")

  if (contract.boundaries.mustNot.length > 0) {
    sections.push("### ⛔ 禁止事项")
    for (const item of contract.boundaries.mustNot) {
      sections.push(`- ${item}`)
    }
    sections.push("")
  }

  if (contract.boundaries.shouldConsider.length > 0) {
    sections.push("### 💡 建议考虑")
    for (const item of contract.boundaries.shouldConsider) {
      sections.push(`- ${item}`)
    }
    sections.push("")
  }

  if (contract.boundaries.hardConstraints && contract.boundaries.hardConstraints.length > 0) {
    sections.push("### 🔒 硬性约束（不可违反）")
    for (const item of contract.boundaries.hardConstraints) {
      sections.push(`- ${item}`)
    }
    sections.push("")
  }

  // 输出期望
  sections.push("## 输出期望")
  sections.push("")
  sections.push(`**意图**: ${contract.expectedOutcome.intent}`)
  sections.push("")

  if (contract.expectedOutcome.successCriteria && contract.expectedOutcome.successCriteria.length > 0) {
    sections.push("### 成功标准")
    for (const criteria of contract.expectedOutcome.successCriteria) {
      sections.push(`- ${criteria}`)
    }
    sections.push("")
  }

  sections.push("### 验证方式")
  sections.push(contract.expectedOutcome.validationHint)
  sections.push("")

  if (contract.expectedOutcome.formatSuggestion) {
    sections.push("### 输出格式建议")
    sections.push(contract.expectedOutcome.formatSuggestion)
    sections.push("")
  }

  // 元数据
  sections.push("---")
  sections.push("")
  sections.push(`*创建时间: ${new Date(contract.metadata.createdAt).toISOString()}*`)
  sections.push(`*创建者: ${contract.metadata.createdBy}*`)
  if (contract.metadata.priority) {
    sections.push(`*优先级: ${contract.metadata.priority}*`)
  }
  if (contract.metadata.complexity) {
    sections.push(`*复杂度: ${contract.metadata.complexity}*`)
  }

  return sections.join("\n")
}

/**
 * ContextContract 构建器
 */
export class ContextContractBuilder {
  private contract: Partial<ContextContract> = {}

  constructor(id: string = `contract-${Date.now()}`) {
    this.contract.id = id
    this.contract.background = ""
    this.contract.context = {
      description: "",
      constraints: [],
      references: [],
    }
    this.contract.boundaries = {
      mustNot: [],
      shouldConsider: [],
    }
    this.contract.expectedOutcome = {
      intent: "",
      validationHint: "",
    }
    this.contract.metadata = {
      createdAt: Date.now(),
      createdBy: "system",
    }
  }

  /**
   * 设置目标
   */
  objective(text: string): this {
    this.contract.objective = text
    return this
  }

  /**
   * 设置背景
   */
  background(text: string): this {
    this.contract.background = text
    return this
  }

  /**
   * 设置背景描述
   */
  contextDescription(text: string): this {
    this.contract.context!.description = text
    return this
  }

  /**
   * 添加约束
   */
  addConstraint(constraint: string): this {
    this.contract.context!.constraints.push(constraint)
    return this
  }

  /**
   * 添加引用
   */
  addReference(ref: ContextReference): this {
    this.contract.context!.references.push(ref)
    return this
  }

  /**
   * 添加禁止事项
   */
  addMustNot(item: string): this {
    this.contract.boundaries!.mustNot.push(item)
    return this
  }

  /**
   * 添加建议考虑
   */
  addShouldConsider(item: string): this {
    this.contract.boundaries!.shouldConsider.push(item)
    return this
  }

  /**
   * 添加硬性约束
   */
  addHardConstraint(item: string): this {
    if (!this.contract.boundaries!.hardConstraints) {
      this.contract.boundaries!.hardConstraints = []
    }
    this.contract.boundaries!.hardConstraints.push(item)
    return this
  }

  /**
   * 设置输出意图
   */
  outputIntent(intent: string): this {
    this.contract.expectedOutcome!.intent = intent
    return this
  }

  /**
   * 设置验证提示
   */
  validationHint(hint: string): this {
    this.contract.expectedOutcome!.validationHint = hint
    return this
  }

  /**
   * 添加成功标准
   */
  addSuccessCriteria(criteria: string): this {
    if (!this.contract.expectedOutcome!.successCriteria) {
      this.contract.expectedOutcome!.successCriteria = []
    }
    this.contract.expectedOutcome!.successCriteria.push(criteria)
    return this
  }

  /**
   * 设置格式建议
   */
  formatSuggestion(suggestion: string): this {
    this.contract.expectedOutcome!.formatSuggestion = suggestion
    return this
  }

  /**
   * 设置优先级
   */
  priority(p: "low" | "medium" | "high" | "critical"): this {
    this.contract.metadata!.priority = p
    return this
  }

  /**
   * 设置复杂度
   */
  complexity(c: "simple" | "medium" | "complex"): this {
    this.contract.metadata!.complexity = c
    return this
  }

  /**
   * 设置创建者
   */
  createdBy(creator: string): this {
    this.contract.metadata!.createdBy = creator
    return this
  }

  /**
   * 设置分配角色
   */
  assignedRole(role: AgentRole): this {
    this.contract.metadata!.assignedRole = role
    return this
  }

  /**
   * 添加标签
   */
  addTag(tag: string): this {
    if (!this.contract.metadata!.tags) {
      this.contract.metadata!.tags = []
    }
    this.contract.metadata!.tags.push(tag)
    return this
  }

  /**
   * 构建契约
   */
  build(): ContextContract {
    if (!this.contract.objective) {
      throw new Error("Objective is required")
    }
    if (!this.contract.expectedOutcome?.intent) {
      throw new Error("Output intent is required")
    }

    return this.contract as ContextContract
  }
}

/**
 * 创建契约构建器
 */
export function createContract(id?: string): ContextContractBuilder {
  return new ContextContractBuilder(id)
}

/**
 * 示例：创建一个简单的功能实现契约
 */
export function createFeatureContract(
  featureName: string,
  description: string,
  files: string[]
): ContextContract {
  return createContract()
    .objective(`实现 ${featureName} 功能`)
    .background(`需要为项目添加 ${featureName} 功能。${description}`)
    .outputIntent(`完成 ${featureName} 功能的实现`)
    .validationHint(`运行相关测试验证功能是否正常工作`)
    .addSuccessCriteria(`功能按预期工作`)
    .addSuccessCriteria(`代码通过 lint 检查`)
    .addSuccessCriteria(`添加了必要的测试`)
    .addMustNot("不要删除现有功能")
    .addMustNot("不要引入 breaking changes")
    .addShouldConsider("保持代码风格一致")
    .addShouldConsider("考虑错误处理")
    .addReference({
      type: "file",
      path: files[0],
      description: "主要修改文件",
      required: true,
    })
    .complexity("medium")
    .build()
}

/**
 * 示例：创建一个 bug 修复契约
 */
export function createBugFixContract(
  bugDescription: string,
  affectedFiles: string[],
  reproduction?: string
): ContextContract {
  const builder = createContract()
    .objective(`修复 bug: ${bugDescription}`)
    .background(`发现一个需要修复的 bug: ${bugDescription}`)
    .outputIntent("Bug 被修复，不再出现")
    .validationHint(reproduction || "按照 bug 描述的步骤验证")
    .addSuccessCriteria("Bug 不再复现")
    .addSuccessCriteria("修复不影响其他功能")
    .addHardConstraint("不要引入新的 bug")
    .addMustNot("不要跳过测试")
    .addShouldConsider("添加回归测试")
    .priority("high")
    .complexity("medium")

  for (const file of affectedFiles) {
    builder.addReference({
      type: "file",
      path: file,
      description: "受影响的文件",
      required: true,
    })
  }

  return builder.build()
}
