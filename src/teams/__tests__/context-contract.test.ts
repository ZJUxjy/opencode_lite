import { describe, it, expect } from "vitest"
import {
  ContextContractBuilder,
  generateContextPrompt,
  createContract,
  createFeatureContract,
  createBugFixContract,
  type ContextContract,
} from "../index.js"

describe("ContextContractBuilder", () => {
  it("should build a basic contract", () => {
    const contract = createContract("test-001")
      .objective("Add a hello world function")
      .background("Need to add a simple hello world function")
      .outputIntent("Function is implemented and working")
      .validationHint("Call the function and verify it returns 'Hello, World!'")
      .build()

    expect(contract.id).toBe("test-001")
    expect(contract.objective).toBe("Add a hello world function")
    expect(contract.expectedOutcome.intent).toBe("Function is implemented and working")
  })

  it("should throw error when objective is missing", () => {
    const builder = new ContextContractBuilder()

    expect(() => builder.build()).toThrow("Objective is required")
  })

  it("should throw error when output intent is missing", () => {
    const builder = new ContextContractBuilder().objective("Test objective")

    expect(() => builder.build()).toThrow("Output intent is required")
  })

  it("should support all configuration options", () => {
    const contract = createContract()
      .objective("Full test")
      .background("Background info")
      .contextDescription("Detailed context")
      .addConstraint("Must use TypeScript")
      .addConstraint("Must be compatible with Node 18")
      .addReference({
        type: "file",
        path: "src/index.ts",
        description: "Main entry file",
        required: true,
      })
      .addMustNot("Do not delete existing code")
      .addShouldConsider("Consider async/await pattern")
      .addHardConstraint("No external dependencies")
      .outputIntent("Feature is complete")
      .validationHint("Run tests")
      .addSuccessCriteria("All tests pass")
      .formatSuggestion("TypeScript with JSDoc comments")
      .priority("high")
      .complexity("complex")
      .createdBy("test-user")
      .assignedRole("worker")
      .addTag("feature")
      .addTag("backend")
      .build()

    expect(contract.objective).toBe("Full test")
    expect(contract.context.constraints).toHaveLength(2)
    expect(contract.context.references).toHaveLength(1)
    expect(contract.boundaries.mustNot).toHaveLength(1)
    expect(contract.boundaries.shouldConsider).toHaveLength(1)
    expect(contract.boundaries.hardConstraints).toHaveLength(1)
    expect(contract.expectedOutcome.successCriteria).toHaveLength(1)
    expect(contract.metadata.priority).toBe("high")
    expect(contract.metadata.complexity).toBe("complex")
    expect(contract.metadata.tags).toContain("feature")
    expect(contract.metadata.tags).toContain("backend")
  })
})

describe("generateContextPrompt", () => {
  it("should generate a well-formatted prompt", () => {
    const contract: ContextContract = {
      id: "test-002",
      objective: "Implement user authentication",
      background: "The application needs user login functionality",
      context: {
        description: "Authentication context",
        constraints: ["Use JWT tokens", "Support OAuth2"],
        references: [
          { type: "file", path: "src/auth.ts", description: "Auth module", required: true },
        ],
      },
      boundaries: {
        mustNot: ["Don't store passwords in plain text"],
        shouldConsider: ["Consider rate limiting"],
        hardConstraints: ["Must comply with OWASP guidelines"],
      },
      expectedOutcome: {
        intent: "Users can log in securely",
        validationHint: "Test login flow end-to-end",
        successCriteria: ["Login works", "Tokens are valid"],
        formatSuggestion: "TypeScript",
      },
      metadata: {
        createdAt: 1700000000000,
        createdBy: "test",
        priority: "high",
        complexity: "complex",
      },
    }

    const prompt = generateContextPrompt(contract)

    expect(prompt).toContain("# 任务目标")
    expect(prompt).toContain("Implement user authentication")
    expect(prompt).toContain("## 背景")
    expect(prompt).toContain("约束条件")
    expect(prompt).toContain("Use JWT tokens")
    expect(prompt).toContain("参考资源")
    expect(prompt).toContain("src/auth.ts")
    expect(prompt).toContain("⛔ 禁止事项")
    expect(prompt).toContain("Don't store passwords in plain text")
    expect(prompt).toContain("💡 建议考虑")
    expect(prompt).toContain("Consider rate limiting")
    expect(prompt).toContain("🔒 硬性约束")
    expect(prompt).toContain("OWASP")
    expect(prompt).toContain("## 输出期望")
    expect(prompt).toContain("Users can log in securely")
    expect(prompt).toContain("成功标准")
    expect(prompt).toContain("Login works")
    expect(prompt).toContain("验证方式")
    expect(prompt).toContain("Test login flow end-to-end")
  })
})

describe("createFeatureContract", () => {
  it("should create a feature contract with sensible defaults", () => {
    const contract = createFeatureContract(
      "Search",
      "Full-text search capability",
      ["src/search.ts"]
    )

    expect(contract.objective).toContain("Search")
    expect(contract.background).toContain("Full-text search")
    expect(contract.boundaries.mustNot).toContain("不要删除现有功能")
    expect(contract.expectedOutcome.successCriteria).toHaveLength(3)
    expect(contract.context.references).toHaveLength(1)
    expect(contract.metadata.complexity).toBe("medium")
  })
})

describe("createBugFixContract", () => {
  it("should create a bug fix contract with high priority", () => {
    const contract = createBugFixContract(
      "Null pointer exception on login",
      ["src/auth.ts", "src/user.ts"],
      "Try to login with empty username"
    )

    expect(contract.objective).toContain("Null pointer exception")
    expect(contract.background).toContain("需要修复的 bug")
    expect(contract.metadata.priority).toBe("high")
    expect(contract.boundaries.hardConstraints).toContain("不要引入新的 bug")
    expect(contract.boundaries.mustNot).toContain("不要跳过测试")
    expect(contract.context.references).toHaveLength(2)
  })
})
