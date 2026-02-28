import { homedir } from "os"
import { join } from "path"

/**
 * 获取 Lite OpenCode 基础目录
 * 用于存储配置、计划文件等
 */
export function getLiteOpencodeBaseDir(): string {
  return join(homedir(), ".lite-opencode")
}

/**
 * 获取配置目录
 */
export function getConfigDir(): string {
  return join(getLiteOpencodeBaseDir(), "config")
}

/**
 * 获取数据目录
 */
export function getDataDir(): string {
  return join(getLiteOpencodeBaseDir(), "data")
}

/**
 * 获取计划目录
 */
export function getPlansDir(): string {
  return join(getLiteOpencodeBaseDir(), "plans")
}
