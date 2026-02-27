/**
 * Prompt 工具函数
 */

/**
 * 简单变量替换
 * 支持 ${var} 语法
 *
 * @example
 * substitute("Hello ${name}!", { name: "World" }) // "Hello World!"
 */
export function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key) => vars[key] || '')
}
