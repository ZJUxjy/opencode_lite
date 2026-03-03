/**
 * Web Search Tool - 内置联网搜索工具
 *
 * 使用 Exa AI 作为主要搜索引擎（AI 优化的语义搜索）
 * 后备方案：Bing/百度 HTML 抓取
 */

import { z } from "zod"
import { exec } from "child_process"
import { promisify } from "util"
import type { Tool } from "../types.js"

const execAsync = promisify(exec)

// Exa AI API Key - 从环境变量或使用默认值
const EXA_API_KEY = process.env.EXA_API_KEY || "526ee416-07ec-4e72-aa87-c85c4a18c4af"
const EXA_API_URL = "https://api.exa.ai/search"

interface SearchResult {
  title: string
  link: string
  snippet: string
  publishedDate?: string
  author?: string
}

interface ExaSearchResult {
  title: string
  url: string
  text?: string
  publishedDate?: string
  author?: string
}

/**
 * 使用 Exa AI API 进行搜索（AI 优化的语义搜索）
 */
async function searchExa(query: string, numResults: number = 10, timeoutMs: number = 20000): Promise<SearchResult[]> {
  const requestBody = {
    query,
    type: "auto",
    numResults,
    contents: {
      text: {
        maxCharacters: 20000
      }
    }
  }

  const { stdout } = await execAsync(
    `curl -s -L --max-time ${Math.floor(timeoutMs / 1000)} ` +
    `-H "Content-Type: application/json" ` +
    `-H "x-api-key: ${EXA_API_KEY}" ` +
    `-H "Accept: application/json" ` +
    `-d '${JSON.stringify(requestBody)}' ` +
    `"${EXA_API_URL}"`,
    { timeout: timeoutMs + 5000 }
  )

  try {
    const response = JSON.parse(stdout)

    if (response.error) {
      throw new Error(`Exa API error: ${response.error}`)
    }

    if (!response.results || !Array.isArray(response.results)) {
      throw new Error("Invalid response format from Exa API")
    }

    return response.results.map((result: ExaSearchResult) => ({
      title: result.title || "Untitled",
      link: result.url,
      snippet: result.text ? result.text.substring(0, 500) + (result.text.length > 500 ? "..." : "") : "",
      publishedDate: result.publishedDate,
      author: result.author
    }))
  } catch (parseError) {
    // 如果 JSON 解析失败，可能是 curl 错误
    if (stdout.includes("curl:") || stdout.includes("error")) {
      throw new Error(`curl error: ${stdout}`)
    }
    throw parseError
  }
}

/**
 * 使用 curl 调用百度搜索（HTML 抓取）- 作为后备方案
 */
async function searchBaidu(query: string, timeoutMs: number = 15000): Promise<SearchResult[]> {
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=10`

  const { stdout: html } = await execAsync(
    `curl -s -L --max-time ${Math.floor(timeoutMs / 1000)} ` +
    `-H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" ` +
    `-H "Accept: text/html,application/xhtml+xml" ` +
    `-H "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8" ` +
    `-H "Accept-Encoding: identity" ` +
    `"${url}"`,
    { timeout: timeoutMs + 5000 }
  )

  const results: SearchResult[] = []

  // 提取百度搜索结果
  const resultRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi
  let resultMatch

  while ((resultMatch = resultRegex.exec(html)) !== null && results.length < 10) {
    const content = resultMatch[1]

    const titleMatch = /<h3[^>]*class="[^"]*t[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(content) ||
                      /<a[^>]*data-click[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(content)

    if (titleMatch) {
      let link = titleMatch[1]
      const title = titleMatch[2].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim()

      const descMatch = /<span[^>]*class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(content) ||
                       /<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(content) ||
                       /<p[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(content)

      let snippet = ""
      if (descMatch) {
        snippet = descMatch[1].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim()
      }

      if (title && link && !link.includes("baidu.com/") &&
          !title.includes("百度为您找到") && !title.includes("相关搜索")) {
        results.push({ title, link, snippet })
      }
    }
  }

  // 备用正则匹配
  if (results.length === 0) {
    const simpleRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let match
    while ((match = simpleRegex.exec(html)) !== null && results.length < 10) {
      const link = match[1]
      const title = match[2].replace(/<[^>]*>/g, "").trim()

      if (title && link && !link.includes("baidu.com") &&
          !link.includes("javascript:") && title.length > 5 && title.length < 100) {
        results.push({ title, link, snippet: "" })
      }
    }
  }

  return results
}

/**
 * 使用 curl 调用 Bing 搜索 - 作为后备方案
 */
async function searchBing(query: string, timeoutMs: number = 15000): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`

  const { stdout: html } = await execAsync(
    `curl -s -L --max-time ${Math.floor(timeoutMs / 1000)} ` +
    `-H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" ` +
    `-H "Accept: text/html,application/xhtml+xml" ` +
    `-H "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8" ` +
    `"${url}"`,
    { timeout: timeoutMs + 5000 }
  )

  const results: SearchResult[] = []

  const liRegex = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi
  let liMatch

  while ((liMatch = liRegex.exec(html)) !== null && results.length < 10) {
    const liContent = liMatch[1]

    const titleMatch = /<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>/i.exec(liContent)
    if (titleMatch) {
      let link = titleMatch[1]
      if (link.startsWith("/")) {
        link = "https://www.bing.com" + link
      }

      const title = titleMatch[2].replace(/<[^>]*>/g, "").trim()

      const descMatch = /<div class="b_caption"[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i.exec(liContent) ||
                       /<span class="news-caption"[^>]*>([\s\S]*?)<\/span>/i.exec(liContent)
      const snippet = descMatch ? descMatch[1].replace(/<[^>]*>/g, "").trim() : ""

      if (title && link && !link.includes("javascript:")) {
        results.push({ title, link, snippet })
      }
    }
  }

  return results
}

/**
 * Web Search Tool
 */
export const webSearchTool: Tool = {
  name: "web_search",
  description: `Search the web for information using Exa AI (AI-optimized semantic search).
Use this tool when you need to find current information, look up facts, or research topics online.

Features:
- AI-optimized semantic search for better relevance
- Returns full text content from search results
- Falls back to Bing/Baidu if Exa is unavailable
- Supports both English and Chinese queries

Usage tips:
- Use natural language queries for best results
- Exa AI understands semantic meaning, so describe what you're looking for
- For time-sensitive topics, include the year (e.g., "latest React features 2026")`,

  parameters: z.object({
    query: z.string().describe("The search query. Use natural language for best results with Exa AI."),
  }),

  execute: async (params) => {
    const { query } = params
    const timeout = 20000 // 20 秒超时

    try {
      let results: SearchResult[] = []
      let usedEngine = ""
      let lastError: string = ""

      // 搜索引擎优先级：Exa AI > Bing > 百度
      const searchEngines = [
        { name: "Exa AI", search: () => searchExa(query, 10, timeout) },
        { name: "Bing", search: () => searchBing(query, timeout) },
        { name: "百度", search: () => searchBaidu(query, timeout) },
      ]

      for (const engine of searchEngines) {
        try {
          results = await engine.search()
          if (results.length > 0) {
            usedEngine = engine.name
            break
          }
        } catch (err) {
          lastError = `${engine.name}: ${err instanceof Error ? err.message : String(err)}`
          // 继续尝试下一个搜索引擎
        }
      }

      if (results.length === 0) {
        return `No results found for "${query}". ${lastError ? `Last error: ${lastError}` : "Try a different search term."}`
      }

      // 格式化输出
      const output: string[] = []
      output.push(`## Search Results for "${query}"`)
      output.push(`_Powered by ${usedEngine}_`)
      output.push("")

      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        output.push(`### ${i + 1}. ${result.title}`)
        output.push(`Link: ${result.link}`)

        // 添加发布日期和作者（如果有）
        if (result.publishedDate || result.author) {
          const meta: string[] = []
          if (result.author) meta.push(`Author: ${result.author}`)
          if (result.publishedDate) meta.push(`Date: ${result.publishedDate}`)
          output.push(`_${meta.join(" | ")}_`)
        }

        if (result.snippet) {
          output.push(`> ${result.snippet}`)
        }
        output.push("")
      }

      return output.join("\n")

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)

      if (errorMsg.includes("ETIMEDOUT") || errorMsg.includes("timeout")) {
        return `Search timed out. Please check your network connection.`
      }

      return `Search failed: ${errorMsg}`
    }
  }
}
