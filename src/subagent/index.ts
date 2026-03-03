export {
  SubagentManager,
  getSubagentManager,
  resetSubagentManager,
} from "./manager.js"

export type {
  Subagent,
  SubagentConfig,
  SubagentManagerConfig,
  SubagentResult,
  SubagentStatus,
  SubagentType,
  SubagentEvents,
  ParallelExploreConfig,
  ExploreTask,
  AggregatedResult,
  // 新增类型
  SubagentTerminateReason,
  OutputValidationResult,
  CompleteTaskParams,
} from "./types.js"

export { DeadlineTimer } from "./timer.js"
export { TaskCompleter, completeTaskTool, CompleteTaskSchema } from "./completer.js"
export { SubagentRunner } from "./runner.js"
