/**
 * 错误处理工具函数
 *
 * 提供类型安全的错误信息提取
 */

/**
 * 从任意错误值中安全地提取错误信息
 *
 * 处理 Error 实例、字符串错误、以及其他未知错误类型
 *
 * @param error - 捕获的错误值
 * @returns 错误信息字符串
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === "string") {
    return error
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

/**
 * 将未知错误转换为 Error 实例
 *
 * @param error - 捕获的错误值
 * @returns Error 实例
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  return new Error(getErrorMessage(error))
}
