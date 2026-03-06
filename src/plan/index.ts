export {
  PlanModeManager,
  getPlanModeManager,
  enterPlanMode,
  exitPlanMode,
  isPlanModeEnabled,
  getPlanFilePath,
  isPlanFilePath,
  readPlanFile,
  clearPlanModeManagerCache,
  // 全局上下文便捷函数
  isPlanModeEnabledCurrent,
  enterPlanModeCurrent,
  exitPlanModeCurrent,
  getPlanFilePathCurrent,
  isPlanFilePathCurrent,
  readPlanFileCurrent,
} from "./manager.js"

export {
  PlanStore,
  type PlanState,
  type PlanRecord,
} from "./store.js"

export {
  setPlanContext,
  getPlanContext,
  clearPlanContext,
  requirePlanContext,
  type PlanContext,
} from "./context.js"

export {
  generatePlanFile,
  getEmptyPlanTemplate,
  parsePlanFile,
  type PlanTemplateData,
} from "./template.js"

export {
  HANDOVER_PROMPT,
  extractHandoverFromMessages,
  formatHandover,
  buildNewSessionPrompt,
  buildContinueSessionPrompt,
  type HandoverData,
} from "./handover.js"
