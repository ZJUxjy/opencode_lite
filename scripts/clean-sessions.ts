#!/usr/bin/env tsx
/**
 * Session 清理脚本
 *
 * 用法:
 *   npx tsx scripts/clean-sessions.ts          # 列出所有 sessions
 *   npx tsx scripts/clean-sessions.ts --all    # 删除所有 sessions
 *   npx tsx tsx scripts/clean-sessions.ts --keep 10  # 保留最近10个，删除其余
 */

import { SessionStore } from "../src/session/store.js"
import { join } from "path"
import { homedir } from "os"

const dbPath = join(homedir(), ".lite-opencode", "history.db")

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("zh-CN")
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

async function main() {
  const args = process.argv.slice(2)
  const deleteAll = args.includes("--all")
  const keepFlag = args.indexOf("--keep")
  const keepCount = keepFlag >= 0 ? parseInt(args[keepFlag + 1]) || 10 : null

  console.log(`📂 Database: ${dbPath}\n`)

  const store = new SessionStore(dbPath)

  // 获取所有 sessions
  const sessions = store.list({ includeArchived: true })

  if (sessions.length === 0) {
    console.log("✅ No sessions found. Database is clean.")
    process.exit(0)
  }

  console.log(`Found ${sessions.length} session(s):\n`)

  // 按更新时间排序（最新的在前）
  const sortedSessions = sessions.sort((a, b) => b.updatedAt - a.updatedAt)

  // 显示 sessions
  sortedSessions.forEach((session, index) => {
    const age = Math.floor((Date.now() / 1000 - session.updatedAt) / 60) // minutes
    const ageStr = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.floor(age / 60)}h ago` : `${Math.floor(age / 1440)}d ago`

    console.log(`${index + 1}. ${session.title}`)
    console.log(`   ID: ${session.id.slice(0, 20)}...`)
    console.log(`   Messages: ${session.messageCount} | Last active: ${ageStr}`)
    console.log(`   Directory: ${session.cwd}`)
    if (session.isArchived) console.log(`   [ARCHIVED]`)
    console.log("")
  })

  // 删除操作
  if (deleteAll) {
    console.log("⚠️  Deleting ALL sessions...")
    let deleted = 0
    for (const session of sortedSessions) {
      if (store.delete(session.id)) {
        deleted++
      }
    }
    console.log(`✅ Deleted ${deleted} session(s)`)
  } else if (keepCount !== null) {
    console.log(`⚠️  Keeping ${keepCount} most recent session(s)...`)
    const toDelete = sortedSessions.slice(keepCount)
    let deleted = 0
    for (const session of toDelete) {
      if (store.delete(session.id)) {
        deleted++
      }
    }
    console.log(`✅ Deleted ${deleted} session(s), kept ${Math.min(keepCount, sortedSessions.length)}`)
  } else {
    console.log("💡 Use --all to delete all sessions, or --keep N to keep N most recent")
  }

  store.close()
}

main().catch(console.error)
