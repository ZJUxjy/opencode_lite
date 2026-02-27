/**
 * Scratchpad 管理器
 *
 * 管理 ReAct 循环中的思考过程 (Thought → Action → Observation)
 *
 * 参考: dify AgentScratchpadUnit
 *
 * Phase 3 增强:
 * - 序列化/反序列化支持
 * - 从持久化数据恢复
 */

import type { Action, ScratchpadUnit } from "./types.js"

/**
 * 可序列化的思考单元（用于持久化）
 */
export interface SerializableUnit {
  thought: string
  actionName: string | null
  actionInput: string  // JSON string
  actionStr: string
  observation: string | null
}

/**
 * Scratchpad 管理器
 *
 * 负责管理 ReAct 循环中的思考过程单元
 */
export class ScratchpadManager {
  private units: ScratchpadUnit[] = []
  private currentUnit: ScratchpadUnit | null = null

  /**
   * 添加新的思考单元
   */
  add(partial: Partial<ScratchpadUnit>): void {
    if (!this.currentUnit) {
      this.currentUnit = this.createEmptyUnit()
    }

    // 合并部分数据
    if (partial.thought !== undefined) {
      this.currentUnit.thought += partial.thought
    }
    if (partial.action !== undefined) {
      this.currentUnit.action = partial.action
    }
    if (partial.actionStr !== undefined) {
      this.currentUnit.actionStr = partial.actionStr
    }
    if (partial.observation !== undefined) {
      this.currentUnit.observation = partial.observation
    }
  }

  /**
   * 设置当前单元的 Action
   */
  setAction(action: Action): void {
    if (!this.currentUnit) {
      this.currentUnit = this.createEmptyUnit()
    }
    this.currentUnit.action = action
    this.currentUnit.actionStr = JSON.stringify(action)
  }

  /**
   * 添加 Observation
   */
  addObservation(observation: string): void {
    if (this.currentUnit) {
      this.currentUnit.observation = observation
      this.units.push(this.currentUnit)
      this.currentUnit = null
    }
  }

  /**
   * 完成当前单元（没有 Observation 的情况下）
   */
  completeCurrentUnit(): void {
    if (this.currentUnit) {
      this.units.push(this.currentUnit)
      this.currentUnit = null
    }
  }

  /**
   * 格式化为 Prompt 文本
   *
   * 生成 ReAct 格式的文本，用于添加到消息历史
   */
  format(): string {
    if (this.units.length === 0 && !this.currentUnit) {
      return ""
    }

    const allUnits = [...this.units]
    if (this.currentUnit) {
      allUnits.push(this.currentUnit)
    }

    return allUnits
      .map((unit) => {
        let text = ""

        if (unit.thought) {
          text += `Thought: ${unit.thought.trim()}\n`
        }

        if (unit.action) {
          const actionJson = JSON.stringify(
            {
              action: unit.action.name,
              action_input: unit.action.input,
            },
            null,
            2
          )
          text += `Action:\n\`\`\`json\n${actionJson}\n\`\`\`\n`
        }

        if (unit.observation) {
          text += `Observation: ${unit.observation}\n`
        }

        return text
      })
      .join("\n")
  }

  /**
   * 获取所有单元
   */
  getUnits(): ScratchpadUnit[] {
    const result = [...this.units]
    if (this.currentUnit) {
      result.push(this.currentUnit)
    }
    return result
  }

  /**
   * 获取已完成的单元（不包括当前进行中的）
   */
  getCompletedUnits(): ScratchpadUnit[] {
    return [...this.units]
  }

  /**
   * 获取最后一个单元
   */
  getLastUnit(): ScratchpadUnit | null {
    if (this.currentUnit) {
      return this.currentUnit
    }
    return this.units[this.units.length - 1] || null
  }

  /**
   * 检查是否为最终答案
   */
  isFinal(): boolean {
    const lastUnit = this.getLastUnit()
    if (!lastUnit?.action) {
      return false
    }
    const actionName = lastUnit.action.name.toLowerCase()
    return actionName.includes("final") && actionName.includes("answer")
  }

  /**
   * 获取最终答案
   */
  getFinalAnswer(): string | null {
    const lastUnit = this.getLastUnit()
    if (!lastUnit?.action) {
      return null
    }

    const actionName = lastUnit.action.name.toLowerCase()
    if (actionName.includes("final") && actionName.includes("answer")) {
      const input = lastUnit.action.input
      if (typeof input === "string") {
        return input
      }
      return JSON.stringify(input)
    }

    return null
  }

  /**
   * 获取单元数量
   */
  get length(): number {
    return this.units.length + (this.currentUnit ? 1 : 0)
  }

  /**
   * 检查是否为空
   */
  isEmpty(): boolean {
    return this.units.length === 0 && !this.currentUnit
  }

  /**
   * 重置
   */
  reset(): void {
    this.units = []
    this.currentUnit = null
  }

  // ═══════════════════════════════════════════════════════
  // Phase 3: 序列化/反序列化支持
  // ═══════════════════════════════════════════════════════

  /**
   * 序列化为可存储的格式
   */
  serialize(): SerializableUnit[] {
    const allUnits = this.getUnits()
    return allUnits.map(unit => ({
      thought: unit.thought,
      actionName: unit.action?.name || null,
      actionInput: unit.action ? JSON.stringify(unit.action.input) : "",
      actionStr: unit.actionStr,
      observation: unit.observation,
    }))
  }

  /**
   * 从序列化数据恢复
   */
  static deserialize(data: SerializableUnit[]): ScratchpadManager {
    const manager = new ScratchpadManager()
    for (const item of data) {
      const unit: ScratchpadUnit = {
        thought: item.thought,
        action: item.actionName ? {
          name: item.actionName,
          input: item.actionInput ? JSON.parse(item.actionInput) : {},
        } : null,
        actionStr: item.actionStr,
        observation: item.observation,
      }
      manager.units.push(unit)
    }
    return manager
  }

  /**
   * 导出为 JSON 字符串
   */
  toJSON(): string {
    return JSON.stringify(this.serialize())
  }

  /**
   * 从 JSON 字符串导入
   */
  static fromJSON(json: string): ScratchpadManager {
    const data = JSON.parse(json) as SerializableUnit[]
    return ScratchpadManager.deserialize(data)
  }

  /**
   * 创建空的思考单元
   */
  private createEmptyUnit(): ScratchpadUnit {
    return {
      thought: "",
      action: null,
      actionStr: "",
      observation: null,
    }
  }
}
