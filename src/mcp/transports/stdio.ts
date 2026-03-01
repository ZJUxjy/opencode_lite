/**
 * MCP Stdio 传输层实现
 *
 * 通过标准输入/输出与子进程通信
 */

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import {
  MCPTransportBase,
  type MCPTransportConfig,
} from "../transport.js"
import { MCPTransportError } from "../errors.js"
import { createServerLogger } from "../logger.js"

/**
 * Stdio 传输层实现
 */
export class StdioTransport extends MCPTransportBase {
  private transport?: StdioClientTransport
  private stderrHandler?: (data: Buffer) => void
  private logger = createServerLogger(this.serverName)

  /**
   * 启动 stdio 传输层
   */
  protected async _doStart(): Promise<void> {
    const { command, args, cwd, env } = this.config

    if (!command) {
      throw new MCPTransportError(
        this.serverName,
        "Command is required for stdio transport",
        "stdio",
        false
      )
    }

    // Windows 平台特殊处理：通过 cmd.exe 包装命令
    const isWindows = process.platform === "win32"
    const isAlreadyWrapped =
      command.toLowerCase() === "cmd.exe" || command.toLowerCase() === "cmd"

    const finalCommand =
      isWindows && !isAlreadyWrapped ? "cmd.exe" : command
    const finalArgs =
      isWindows && !isAlreadyWrapped
        ? ["/c", command, ...(args || [])]
        : args || []

    // 创建传输层
    this.transport = new StdioClientTransport({
      command: finalCommand,
      args: finalArgs,
      cwd,
      env: env
        ? Object.fromEntries(
            Object.entries({ ...process.env, ...env }).filter(
              (entry): entry is [string, string] => entry[1] !== undefined
            )
          )
        : undefined,
      stderr: "pipe", // 启用 stderr 捕获
    })

    // 设置错误处理
    this.transport.onerror = (error) => {
      this._triggerError(error)
    }

    // 设置关闭处理
    this.transport.onclose = () => {
      this._triggerClose()
    }

    // 设置消息处理
    this.transport.onmessage = (message: JSONRPCMessage) => {
      this._triggerMessage(message)
    }

    // 启动传输层
    await this.transport.start()

    // 捕获 stderr 输出（用于调试）
    const stderr = this.transport.stderr
    if (stderr) {
      this.stderrHandler = (data: Buffer) => {
        const output = data.toString().trim()
        if (!output) return

        // 区分日志级别
        const isInfoLog = /INFO|DEBUG/i.test(output)
        const isErrorLog = /ERROR|FATAL/i.test(output)

        if (isErrorLog) {
          this.logger.error(`stderr: ${output}`)
          // 将 stderr 错误传递给错误处理器
          this._triggerError(
            new Error(`Server stderr: ${output.slice(0, 500)}`)
          )
        } else if (isInfoLog) {
          // 信息日志只在调试模式下输出
          this.logger.debug(output)
        } else {
          // 其他输出视为警告
          this.logger.warn(`stderr: ${output.slice(0, 200)}`)
        }
      }

      stderr.on("data", this.stderrHandler)
    }

    // 关键：阻止 SDK 的 client.connect() 重复启动 transport
    // 我们已经在这里调用了 start()，所以需要覆盖 start 方法
    const originalStart = this.transport.start.bind(this.transport)
    this.transport.start = async () => {
      // 如果已经启动，不做任何事
      if (this._connected) {
        return
      }
      // 否则调用原始方法
      return originalStart()
    }
  }

  /**
   * 发送消息
   */
  protected async _doSend(message: JSONRPCMessage): Promise<void> {
    if (!this.transport) {
      throw new MCPTransportError(
        this.serverName,
        "Transport not initialized",
        "stdio",
        false
      )
    }

    await this.transport.send(message)
  }

  /**
   * 关闭传输层
   */
  protected async _doClose(): Promise<void> {
    // 移除 stderr 处理器
    if (this.transport?.stderr && this.stderrHandler) {
      this.transport.stderr.off("data", this.stderrHandler)
    }

    // 关闭传输层
    if (this.transport) {
      await this.transport.close()
      this.transport = undefined
    }
  }
}
