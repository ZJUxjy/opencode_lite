import type { ToolCall } from "./types.js"

/**
 * 策略决策类型
 */
export type PolicyDecision = "allow" | "deny" | "ask"

/**
 * 策略规则
 */
export interface PolicyRule {
  tool: string           // 工具名，"*" 表示所有工具
  decision: PolicyDecision
  mode?: "default" | "plan" | "all"  // 适用的模式，默认为 "all"
  condition?: {
    // 可选条件
    argPattern?: RegExp       // 参数匹配模式
    pathPattern?: RegExp      // 路径匹配模式（用于文件操作）
    readOnlyHint?: boolean    // 是否为只读工具（用于 Plan Mode）
  }
  description?: string   // 规则描述（用于 UI 显示）
}

/**
 * 用户决策记录（用于学习）
 */
export interface UserDecision {
  tool: string
  argsHash: string
  decision: PolicyDecision
  timestamp: number
}

/**
 * 策略检查结果
 */
export interface PolicyResult {
  decision: PolicyDecision
  reason: string
  rule?: PolicyRule  // 匹配的规则
}

/**
 * 策略引擎配置
 */
export interface PolicyConfig {
  defaultDecision: PolicyDecision  // 默认决策，默认为 "ask"
  enableLearning: boolean          // 是否启用决策学习
  learnedRulesPath?: string        // 学习的规则存储路径
}

const DEFAULT_CONFIG: PolicyConfig = {
  defaultDecision: "ask",
  enableLearning: true,
}

/**
 * 策略引擎
 *
 * 负责工具调用的权限控制：
 * - 检查预定义规则
 * - 检查用户学习的规则
 * - 返回决策结果
 * - 支持 YOLO 模式（自动批准所有）
 * - 支持 Plan Mode（只读模式）
 */
export class PolicyEngine {
  private config: PolicyConfig
  private rules: PolicyRule[] = []
  private learnedRules: Map<string, PolicyDecision> = new Map()
  /** YOLO 模式：自动批准所有操作 */
  private yoloMode: boolean = false
  /** Plan Mode：只读模式 */
  private planMode: boolean = false

  constructor(config: Partial<PolicyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.initializeDefaultRules()
  }

  /**
   * 初始化默认规则
   */
  private initializeDefaultRules(): void {
    this.rules = [
      // 读操作 - 通常允许
      {
        tool: "read",
        decision: "allow",
        description: "读取文件内容",
      },
      {
        tool: "glob",
        decision: "allow",
        description: "搜索文件",
      },
      {
        tool: "grep",
        decision: "allow",
        description: "搜索文件内容",
      },

      // 写操作 - 询问用户
      {
        tool: "write",
        decision: "ask",
        description: "写入文件",
      },
      {
        tool: "edit",
        decision: "ask",
        description: "编辑文件",
      },

      // 系统命令 - 询问用户（安全考虑）
      {
        tool: "bash",
        decision: "ask",
        description: "执行 Shell 命令",
        condition: {
          // 危险命令需要询问
          argPattern: /(rm\s+-rf|sudo|chmod|chown|mkfs|dd|>|>>)/,
        },
      },

      // 安全的 bash 命令 - 允许
      {
        tool: "bash",
        decision: "allow",
        description: "执行安全的只读命令",
        condition: {
          argPattern: /^(ls|cat|head|tail|grep|find|pwd|echo|which|git status|git log|git diff|git branch)/,
        },
      },
    ]
  }

  /**
   * 检查工具调用权限（简化接口）
   */
  check(toolName: string, args: Record<string, unknown>): PolicyResult {
    // 0. YOLO 模式：自动批准所有（除了危险操作）
    if (this.yoloMode) {
      // 即使在 YOLO 模式下，仍然阻止极其危险的操作
      if (toolName === "bash" && args.command) {
        const cmd = String(args.command)
        const extremelyDangerous = /\b(rm\s+-rf\s+\/|mkfs|dd\s+if=|>\s*\/dev\/(sda|hda|nvme))/i
        if (extremelyDangerous.test(cmd)) {
          return {
            decision: "deny",
            reason: "Extremely dangerous command blocked even in YOLO mode",
          }
        }
      }
      return {
        decision: "allow",
        reason: "YOLO mode enabled",
      }
    }

    // 1. Plan Mode 检查
    if (this.planMode) {
      const planResult = this.checkPlanMode(toolName, args)
      if (planResult) return planResult
    }

    // 2. 检查预定义规则（按顺序，先匹配的优先）
    for (const rule of this.rules) {
      // 检查模式匹配
      if (rule.mode && rule.mode !== "all" && rule.mode !== "default") {
        continue
      }

      if (rule.tool !== toolName && rule.tool !== "*") {
        continue
      }

      // 检查条件
      if (rule.condition) {
        if (rule.condition.argPattern) {
          const argsStr = JSON.stringify(args)
          if (!rule.condition.argPattern.test(argsStr)) {
            continue
          }
        }
        if (rule.condition.pathPattern && args.path) {
          if (!rule.condition.pathPattern.test(String(args.path))) {
            continue
          }
        }
      }

      // 规则匹配
      return {
        decision: rule.decision,
        reason: rule.description || `规则匹配: ${rule.tool}`,
        rule,
      }
    }

    // 3. 检查学习的规则
    const argsHash = this.hashArgs(toolName, args)
    const learnedDecision = this.learnedRules.get(argsHash)
    if (learnedDecision) {
      return {
        decision: learnedDecision,
        reason: "根据您之前的选择",
      }
    }

    // 4. 返回默认决策
    return {
      decision: this.config.defaultDecision,
      reason: "默认策略",
    }
  }

  /**
   * Plan Mode 权限检查
   * 在 Plan Mode 下，只允许只读操作
   */
  private checkPlanMode(toolName: string, args: Record<string, unknown>): PolicyResult | null {
    // 首先检查 Plan Mode 专用规则
    for (const rule of this.rules) {
      // 只应用 Plan Mode 规则或通用规则
      if (rule.mode && rule.mode !== "plan" && rule.mode !== "all") {
        continue
      }

      if (rule.tool !== toolName && rule.tool !== "*") {
        continue
      }

      // 检查条件
      if (rule.condition) {
        if (rule.condition.argPattern) {
          const argsStr = JSON.stringify(args)
          if (!rule.condition.argPattern.test(argsStr)) {
            continue
          }
        }
        if (rule.condition.pathPattern && args.path) {
          if (!rule.condition.pathPattern.test(String(args.path))) {
            continue
          }
        }
      }

      return {
        decision: rule.decision,
        reason: rule.description || `Plan Mode 规则: ${rule.tool}`,
        rule,
      }
    }

    // 默认拒绝非只读操作
    const readOnlyTools = ["read", "glob", "grep", "bash"]
    if (!readOnlyTools.includes(toolName)) {
      return {
        decision: "deny",
        reason: "Plan Mode 下只允许只读操作。如需修改，请先退出 Plan Mode。",
      }
    }

    // 对于 bash，进一步检查命令是否安全
    if (toolName === "bash" && args.command) {
      const cmd = String(args.command)
      // 只允许安全的只读命令
      const safePattern = /^(ls|cat|head|tail|grep|find|pwd|echo|which|git\s+(status|log|diff|branch|show))\b/
      if (!safePattern.test(cmd)) {
        return {
          decision: "deny",
          reason: "Plan Mode 下只允许执行安全的只读命令。",
        }
      }
    }

    return null // 继续正常检查流程
  }

  /**
   * 检查工具调用权限（完整接口）
   */
  checkPermission(toolCall: ToolCall): PolicyResult {
    return this.check(toolCall.name, toolCall.arguments)
  }

  /**
   * 从用户决策中学习（简化接口）
   */
  learn(toolName: string, args: Record<string, unknown>, decision: PolicyDecision, always: boolean = true): void {
    if (!this.config.enableLearning) return

    if (always) {
      // "总是允许/拒绝" - 保存到学习的规则
      const argsHash = this.hashArgs(toolName, args)
      this.learnedRules.set(argsHash, decision)
      this.saveLearnedRules()
    }
  }

  /**
   * 从用户决策中学习（完整接口）
   */
  learnFromToolCall(toolCall: ToolCall, decision: PolicyDecision, always: boolean = false): void {
    this.learn(toolCall.name, toolCall.arguments, decision, always)
  }

  /**
   * 添加自定义规则
   */
  addRule(rule: PolicyRule): void {
    this.rules.unshift(rule)  // 添加到开头，优先级最高
  }

  /**
   * 移除规则
   */
  removeRule(tool: string): void {
    this.rules = this.rules.filter(r => r.tool !== tool)
  }

  /**
   * 清除学习的规则（新会话时调用）
   */
  clearLearnedRules(): void {
    this.learnedRules.clear()
  }

  /**
   * 获取所有规则
   */
  getRules(): PolicyRule[] {
    return [...this.rules]
  }

  /**
   * 生成参数哈希
   * 使用工具名 + 参数结构生成唯一标识
   */
  private hashArgs(tool: string, args: Record<string, unknown>): string {
    // 简化参数结构，忽略具体值的细微差异
    const simplified = this.simplifyArgs(args)
    return `${tool}:${JSON.stringify(simplified)}`
  }

  /**
   * 简化参数对象
   */
  private simplifyArgs(args: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string") {
        // 字符串：只保留长度范围
        const len = value.length
        if (len < 50) {
          result[key] = value  // 短字符串保留原值
        } else {
          result[key] = `string(${len})`
        }
      } else if (typeof value === "number" || typeof value === "boolean") {
        result[key] = value
      } else if (Array.isArray(value)) {
        result[key] = `array(${value.length})`
      } else if (typeof value === "object" && value !== null) {
        result[key] = this.simplifyArgs(value as Record<string, unknown>)
      } else {
        result[key] = String(value)
      }
    }

    return result
  }

  /**
   * 加载学习的规则（从内存，实际项目可持久化到文件）
   */
  private loadLearnedRules(): void {
    // TODO: 从文件加载
    // 目前只在内存中保存
  }

  /**
   * 保存学习的规则
   */
  private saveLearnedRules(): void {
    // TODO: 保存到文件
    // 目前只在内存中保存
  }

  /**
   * 切换 YOLO 模式
   * @returns 新的 YOLO 模式状态
   */
  toggleYoloMode(): boolean {
    this.yoloMode = !this.yoloMode
    return this.yoloMode
  }

  /**
   * 设置 YOLO 模式
   */
  setYoloMode(enabled: boolean): void {
    this.yoloMode = enabled
  }

  /**
   * 获取 YOLO 模式状态
   */
  isYoloMode(): boolean {
    return this.yoloMode
  }

  /**
   * 获取学习的规则数量
   */
  getLearnedRulesCount(): number {
    return this.learnedRules.size
  }

  /**
   * 切换 Plan Mode
   * @returns 新的 Plan Mode 状态
   */
  togglePlanMode(): boolean {
    this.planMode = !this.planMode
    return this.planMode
  }

  /**
   * 设置 Plan Mode
   */
  setPlanMode(enabled: boolean): void {
    this.planMode = enabled
  }

  /**
   * 获取 Plan Mode 状态
   */
  isPlanMode(): boolean {
    return this.planMode
  }
}
