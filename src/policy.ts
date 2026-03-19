import { resolve, join, dirname } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import type { ToolCall } from "./types.js"
import type { RiskConfig, RiskClassification, ToolRiskRule } from "./policy/risk.js"
import {
  classifyToolRisk,
  shouldAutoApprove,
  shouldDeny,
  DEFAULT_RISK_CONFIG,
  DEFAULT_TOOL_RISK_RULES,
} from "./policy/risk.js"

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
  defaultDecision?: PolicyDecision  // 默认决策，默认为 "ask"
  enableLearning?: boolean          // 是否启用决策学习
  learnedRulesPath?: string         // 学习的规则存储路径
  riskConfig?: RiskConfig           // 风险等级配置
  customRiskRules?: ToolRiskRule[]  // 自定义风险规则
}

const DEFAULT_CONFIG: PolicyConfig = {
  defaultDecision: "ask",
  enableLearning: true,
  riskConfig: DEFAULT_RISK_CONFIG,
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
  /** Plan file path for Plan Mode editing */
  private planFilePath: string | null = null
  /** Risk classification rules */
  private riskRules: ToolRiskRule[]

  constructor(config: Partial<PolicyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.riskRules = config.customRiskRules || DEFAULT_TOOL_RISK_RULES
    this.initializeDefaultRules()
    this.loadLearnedRules()
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

      // Skill 相关工具 - 默认允许（问题1修复）
      {
        tool: "list_skills",
        decision: "allow",
        description: "列出可用技能",
      },
      {
        tool: "activate_skill",
        decision: "allow",
        description: "激活技能",
      },
      {
        tool: "deactivate_skill",
        decision: "allow",
        description: "停用技能",
      },
      {
        tool: "show_skill",
        decision: "allow",
        description: "显示技能详情",
      },
      {
        tool: "get_active_skills_prompt",
        decision: "allow",
        description: "获取激活技能的提示",
      },

      // 联网搜索 - 默认允许
      {
        tool: "web_search",
        decision: "allow",
        description: "联网搜索信息",
      },

      // MCP 工具 - 默认允许（用户主动配置的外部工具）
      {
        tool: "mcp_*",
        decision: "allow",
        description: "MCP 外部工具（用户已配置）",
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
   * @param toolName 工具名称
   * @param args 工具参数
   * @param cwd 工作目录（用于 "Always Allow" 规则匹配）
   */
  check(toolName: string, args: Record<string, unknown>, cwd?: string): PolicyResult {
    // 0. YOLO 模式：自动批准所有（除了危险操作）
    if (this.yoloMode) {
      // 即使在 YOLO 模式下，仍然阻止极其危险的操作
      if (toolName === "bash" && args.command) {
        const cmd = String(args.command)
        // Note: regex-based blocking can be bypassed by obfuscation.
        // This is a best-effort guard for the most obvious destructive patterns.
        const extremelyDangerous =
          /\b(rm\s+-[^\s]*r[^\s]*f|rm\s+-[^\s]*f[^\s]*r)\s+\//i.test(cmd) || // rm -rf / or rm -fr /
          /\bmkfs\b/.test(cmd) ||
          /\bdd\s+if=/.test(cmd) ||
          /\bshred\b/.test(cmd) ||
          /\bwipefs\b/.test(cmd) ||
          />\s*\/dev\/(sd[a-z]|hd[a-z]|nvme\d)/.test(cmd)
        if (extremelyDangerous) {
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

    // 1.5. Risk-based decision (NEW)
    if (!this.yoloMode && !this.planMode) {
      const riskClassification = classifyToolRisk(toolName, args, this.riskRules)
      const riskDecision = this.makeRiskBasedDecision(riskClassification, toolName)
      if (riskDecision) {
        return riskDecision
      }
    }

    // 2. 检查预定义规则（按顺序，先匹配的优先）
    for (const rule of this.rules) {
      // 检查模式匹配
      if (rule.mode && rule.mode !== "all" && rule.mode !== "default") {
        continue
      }

      if (rule.tool !== toolName && rule.tool !== "*") {
        // 支持前缀通配符，如 "mcp_*"
        if (rule.tool.endsWith("_*")) {
          const prefix = rule.tool.slice(0, -1) // 移除 "*"，保留下划线
          if (!toolName.startsWith(prefix)) {
            continue
          }
        } else {
          continue
        }
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

    // 3. 检查学习的规则（问题2修复：按工具名 + 工作目录匹配）
    const ruleKey = this.makeRuleKey(toolName, cwd)
    const learnedDecision = this.learnedRules.get(ruleKey)
    if (learnedDecision) {
      return {
        decision: learnedDecision,
        reason: "根据您之前的选择（Always Allow）",
      }
    }

    // 4. 返回默认决策
    return {
      decision: this.config.defaultDecision || "ask",
      reason: "默认策略",
    }
  }

  /**
   * Make decision based on risk classification
   * Returns null if the decision should continue to normal rule checking
   */
  private makeRiskBasedDecision(
    risk: RiskClassification,
    toolName: string
  ): PolicyResult | null {
    const riskConfig = this.config.riskConfig || DEFAULT_RISK_CONFIG

    // Check if this risk level should be auto-approved
    if (shouldAutoApprove(risk, riskConfig)) {
      return {
        decision: "allow",
        reason: `Auto-approved: ${risk.reason} (${risk.level} risk)`,
      }
    }

    // Check if this risk level should be denied
    if (shouldDeny(risk, riskConfig)) {
      return {
        decision: "deny",
        reason: `Denied: ${risk.reason} (${risk.level} risk)`,
      }
    }

    // Continue to normal rule checking for medium/high risk
    return null
  }

  /**
   * Plan Mode 权限检查
   * 在 Plan Mode 下，只允许只读操作
   */
  private checkPlanMode(toolName: string, args: Record<string, unknown>): PolicyResult | null {
    // 新增：对 edit/write 工具的特殊处理
    if (toolName === "edit" || toolName === "write") {
      if (this.planFilePath && args.path) {
        const targetPath = resolve(String(args.path))
        const planPath = resolve(this.planFilePath)
        if (targetPath === planPath) {
          return {
            decision: "allow",
            reason: "Plan Mode: 允许编辑计划文件",
          }
        }
      }
      // 非计划文件直接拒绝，不弹窗
      return {
        decision: "deny",
        reason: "Plan Mode 下只能编辑计划文件，请先退出 Plan Mode",
      }
    }

    // 首先检查 Plan Mode 专用规则
    for (const rule of this.rules) {
      // 只应用 Plan Mode 规则或通用规则
      if (rule.mode && rule.mode !== "plan" && rule.mode !== "all") {
        continue
      }

      if (rule.tool !== toolName && rule.tool !== "*") {
        // 支持前缀通配符，如 "mcp_*"
        if (rule.tool.endsWith("_*")) {
          const prefix = rule.tool.slice(0, -1) // 移除 "*"，保留下划线
          if (!toolName.startsWith(prefix)) {
            continue
          }
        } else {
          continue
        }
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
  checkPermission(toolCall: ToolCall, cwd?: string): PolicyResult {
    return this.check(toolCall.name, toolCall.arguments, cwd)
  }

  /**
   * 从用户决策中学习（简化接口）
   * @param toolName 工具名称
   * @param args 工具参数（不再用于生成哈希）
   * @param decision 决策
   * @param always 是否永久记住
   * @param cwd 工作目录（用于生成规则键）
   */
  learn(toolName: string, args: Record<string, unknown>, decision: PolicyDecision, always: boolean = true, cwd?: string): void {
    if (this.config.enableLearning === false) return

    if (always) {
      // "总是允许/拒绝" - 按工具名 + 工作目录保存规则
      const ruleKey = this.makeRuleKey(toolName, cwd)
      this.learnedRules.set(ruleKey, decision)
      this.saveLearnedRules()
    }
  }

  /**
   * 从用户决策中学习（完整接口）
   */
  learnFromToolCall(toolCall: ToolCall, decision: PolicyDecision, always: boolean = false, cwd?: string): void {
    this.learn(toolCall.name, toolCall.arguments, decision, always, cwd)
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
   * 生成规则键（问题2修复：按工具名 + 工作目录）
   */
  private makeRuleKey(toolName: string, cwd?: string): string {
    const effectiveCwd = cwd || process.cwd()
    return `${toolName}:${effectiveCwd}`
  }

  /**
   * 获取 learnedRules 存储路径（默认 ~/.lite-opencode/learned-rules.json）
   */
  private getLearnedRulesPath(): string {
    return this.config.learnedRulesPath ?? join(homedir(), ".lite-opencode", "learned-rules.json")
  }

  /**
   * 加载学习的规则（从文件）
   */
  private loadLearnedRules(): void {
    if (this.config.enableLearning === false) return
    const filePath = this.getLearnedRulesPath()
    if (!existsSync(filePath)) return
    try {
      const data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, string>
      for (const [key, decision] of Object.entries(data)) {
        this.learnedRules.set(key, decision as PolicyDecision)
      }
    } catch {
      // Corrupt or missing file — start fresh
    }
  }

  /**
   * 保存学习的规则（到文件）
   */
  private saveLearnedRules(): void {
    if (this.config.enableLearning === false) return
    const filePath = this.getLearnedRulesPath()
    try {
      const dir = dirname(filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const data: Record<string, string> = {}
      for (const [key, decision] of this.learnedRules) {
        data[key] = decision
      }
      const tmp = filePath + ".tmp"
      writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8")
      // atomic rename
      const { renameSync } = require("fs") as typeof import("fs")
      renameSync(tmp, filePath)
    } catch {
      // Non-fatal — rules survive only in memory for this session
    }
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
   * Classify the risk level of a tool call
   * @param toolName Tool name
   * @param args Tool arguments
   * @returns Risk classification result
   */
  classifyRisk(toolName: string, args: Record<string, unknown>): RiskClassification {
    return classifyToolRisk(toolName, args, this.riskRules)
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

  /**
   * 设置计划文件路径
   */
  setPlanFilePath(path: string | null): void {
    this.planFilePath = path
  }

  /**
   * 获取计划文件路径
   */
  getPlanFilePath(): string | null {
    return this.planFilePath
  }
}
