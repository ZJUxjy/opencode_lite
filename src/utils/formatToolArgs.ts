/**
 * 工具参数格式化工具
 *
 * 解决两个问题：
 * 1. 大量编辑内容显示导致性能卡顿
 * 2. \n \t 等制表符显示问题
 */

interface FormatOptions {
  maxLength: number      // 单个字段最大长度
  maxTotalLength: number // 总显示长度
}

const DEFAULT_OPTIONS: FormatOptions = {
  maxLength: 100,
  maxTotalLength: 200,
}

/**
 * 格式化工具参数用于显示
 *
 * @param args 工具参数对象
 * @param options 格式化选项
 * @returns 格式化后的字符串
 */
export function formatToolArgs(
  args: Record<string, unknown>,
  options: FormatOptions = DEFAULT_OPTIONS
): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ""

  const formatted: string[] = []
  let totalLength = 0

  for (const [key, value] of entries) {
    if (totalLength >= options.maxTotalLength) break

    let display = formatValue(value, options.maxLength)

    const entry = `${key}: ${display}`
    const entryLength = entry.length

    if (totalLength + entryLength <= options.maxTotalLength) {
      formatted.push(entry)
      totalLength += entryLength + 2 // +2 for ", "
    } else {
      // 空间不足，截断并添加省略
      const remaining = options.maxTotalLength - totalLength
      if (remaining > 10) {
        formatted.push(entry.slice(0, remaining - 1) + '…')
      }
      break
    }
  }

  let result = formatted.join(', ')

  // 最终检查总长度
  if (result.length > options.maxTotalLength) {
    result = result.slice(0, options.maxTotalLength - 1) + '…'
  }

  return result
}

/**
 * 格式化单个值
 */
function formatValue(value: unknown, maxLength: number): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'

  if (typeof value === 'string') {
    return formatStringValue(value, maxLength)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    const summary = `Array(${value.length})`
    if (value.length === 0) return '[]'
    // 简短显示数组前几个元素
    const preview = value.slice(0, 3).map(v => formatValue(v, 30)).join(', ')
    const truncated = value.length > 3 ? ', ...' : ''
    const content = `[${preview}${truncated}]`
    return content.length > maxLength ? summary : content
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    const summary = `Object{${keys.length}}`
    if (keys.length === 0) return '{}'
    return summary
  }

  // 其他类型
  const str = String(value)
  return str.length > maxLength ? str.slice(0, maxLength) + '…' : str
}

/**
 * 格式化字符串值
 * 处理转义字符显示
 */
function formatStringValue(value: string, maxLength: number): string {
  // 如果字符串很短且没有特殊字符，直接返回
  if (value.length <= maxLength && !hasSpecialChars(value)) {
    return value
  }

  // 处理转义字符的显示
  // 将实际的换行和制表符转换为可视化表示
  let display = value
    .replace(/\n/g, '↵\\n')  // 显示换行符为 ↵\n
    .replace(/\r/g, '\\r')   // 回车符
    .replace(/\t/g, '→\\t')  // 制表符显示为 →\t

  // 如果是 JSON 字符串中的转义（双反斜杠），处理一下
  // 例如 "\\n" 应该显示为 \n 而不是 ↵\n
  display = display
    .replace(/↵\\n/g, '\\n')  // 还原 JSON 转义
    .replace(/→\\t/g, '\\t')

  // 截断过长内容
  if (display.length > maxLength) {
    display = display.slice(0, maxLength) + '…'
  }

  return display
}

/**
 * 检查字符串是否包含特殊字符
 */
function hasSpecialChars(value: string): boolean {
  return /[\n\r\t]/.test(value)
}
