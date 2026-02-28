/**
 * Session 类型定义
 *
 * 会话元数据存储和管理
 */

/**
 * 会话信息
 */
export interface Session {
  /** 会话唯一ID */
  id: string
  /** 会话标题 */
  title: string
  /** 工作目录 */
  cwd: string
  /** 创建时间 (unix timestamp) */
  createdAt: number
  /** 最后更新时间 (unix timestamp) */
  updatedAt: number
  /** 消息数量 */
  messageCount: number
  /** 是否归档 */
  isArchived: boolean
}

/**
 * 创建会话的参数
 */
export interface CreateSessionParams {
  id?: string
  title?: string
  cwd: string
}

/**
 * 更新会话的参数
 */
export interface UpdateSessionParams {
  title?: string
  messageCount?: number
  isArchived?: boolean
}

/**
 * 会话列表查询选项
 */
export interface ListSessionsOptions {
  /** 按工作目录过滤 */
  cwd?: string
  /** 包含已归档的 */
  includeArchived?: boolean
  /** 限制数量 */
  limit?: number
  /** 排序方向 */
  order?: "asc" | "desc"
}

/**
 * 数据库会话记录
 */
export interface DBSession {
  id: string
  title: string
  cwd: string
  created_at: number
  updated_at: number
  message_count: number
  is_archived: number
}

/**
 * 会话信息（用于列表显示）
 */
export interface SessionInfo extends Session {
  /** 相对时间显示（如：2小时前） */
  relativeTime: string
  /** 是否是当前目录的会话 */
  isCurrentDirectory: boolean
}
