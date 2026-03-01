import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { ProgressFileManager, createProgressManager, type ProgressTask } from "../index.js"

describe("ProgressFileManager", () => {
  const testDir = path.resolve(process.cwd(), ".test-progress")
  const testFile = "TEST_PROGRESS.md"
  const testPath = path.join(testDir, testFile)
  let manager: ProgressFileManager

  beforeEach(() => {
    // 创建测试目录
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }
    // 删除旧的测试文件
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath)
    }
    manager = new ProgressFileManager(testDir, testFile)
  })

  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath)
    }
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir)
    }
  })

  describe("addTask", () => {
    it("should add a new task", () => {
      const task = manager.addTask("Implement feature X")

      expect(task.id).toBeDefined()
      expect(task.description).toBe("Implement feature X")
      expect(task.status).toBe("pending")
      expect(task.priority).toBe("medium")
    })

    it("should add a task with options", () => {
      const task = manager.addTask("Fix bug Y", {
        priority: "high",
        assignee: "worker-1",
        tags: ["bugfix", "urgent"],
      })

      expect(task.priority).toBe("high")
      expect(task.assignee).toBe("worker-1")
      expect(task.tags).toContain("bugfix")
    })
  })

  describe("updateTaskStatus", () => {
    it("should update task status", () => {
      const task = manager.addTask("Test task")

      const result = manager.updateTaskStatus(task.id, "in_progress")

      expect(result).toBe(true)
      const updated = manager.getTask(task.id)
      expect(updated?.status).toBe("in_progress")
      expect(updated?.startedAt).toBeDefined()
    })

    it("should set completedAt when marking as completed", () => {
      const task = manager.addTask("Test task")

      manager.updateTaskStatus(task.id, "completed")

      const updated = manager.getTask(task.id)
      expect(updated?.status).toBe("completed")
      expect(updated?.completedAt).toBeDefined()
    })

    it("should return false for non-existent task", () => {
      const result = manager.updateTaskStatus("non-existent", "completed")
      expect(result).toBe(false)
    })
  })

  describe("getTask", () => {
    it("should return task by id", () => {
      const task = manager.addTask("Find me")

      const found = manager.getTask(task.id)

      expect(found).toBeDefined()
      expect(found?.description).toBe("Find me")
    })

    it("should return undefined for non-existent task", () => {
      const found = manager.getTask("non-existent")
      expect(found).toBeUndefined()
    })
  })

  describe("getAllTasks", () => {
    it("should return all tasks", () => {
      manager.addTask("Task 1")
      manager.addTask("Task 2")
      manager.addTask("Task 3")

      const tasks = manager.getAllTasks()

      expect(tasks).toHaveLength(3)
    })
  })

  describe("getProgress", () => {
    it("should return progress with correct stats", () => {
      manager.addTask("Task 1")
      const task2 = manager.addTask("Task 2")
      manager.updateTaskStatus(task2.id, "completed")

      const progress = manager.getProgress()

      expect(progress.stats.total).toBe(2)
      expect(progress.stats.completed).toBe(1)
      expect(progress.stats.inProgress).toBe(0)
    })
  })

  describe("getNextTask", () => {
    it("should return the next pending task", () => {
      manager.addTask("Task 1")
      manager.addTask("Task 2")

      const next = manager.getNextTask()

      expect(next).toBeDefined()
      expect(next?.status).toBe("pending")
    })

    it("should respect priority order", () => {
      manager.addTask("Low priority", { priority: "low" })
      manager.addTask("High priority", { priority: "high" })
      manager.addTask("Critical", { priority: "critical" })

      const next = manager.getNextTask()

      expect(next?.description).toBe("Critical")
    })

    it("should return undefined when no pending tasks", () => {
      const task = manager.addTask("Only task")
      manager.updateTaskStatus(task.id, "completed")

      const next = manager.getNextTask()

      expect(next).toBeUndefined()
    })
  })

  describe("setCurrentSession", () => {
    it("should set current session info", () => {
      manager.setCurrentSession("session-123", "worker-1")

      const progress = manager.getProgress()

      expect(progress.currentSessionId).toBe("session-123")
      expect(progress.activeAgent).toBe("worker-1")
    })
  })

  describe("addNote", () => {
    it("should add a note", () => {
      manager.addNote("This is a note")

      const progress = manager.getProgress()

      expect(progress.notes).toContain("This is a note")
    })
  })

  describe("clearCompleted", () => {
    it("should clear completed tasks", () => {
      const task1 = manager.addTask("Task 1")
      manager.addTask("Task 2")
      manager.updateTaskStatus(task1.id, "completed")

      const cleared = manager.clearCompleted()

      expect(cleared).toBe(1)
      expect(manager.getAllTasks()).toHaveLength(1)
    })
  })

  describe("persistence", () => {
    it("should save and load progress", () => {
      manager.addTask("Persistent task", { priority: "high" })
      manager.setCurrentSession("session-456")

      // 创建新实例来加载
      const newManager = new ProgressFileManager(testDir, testFile)

      const tasks = newManager.getAllTasks()
      expect(tasks).toHaveLength(1)
      expect(tasks[0].description).toBe("Persistent task")
      expect(tasks[0].priority).toBe("high")

      const progress = newManager.getProgress()
      expect(progress.currentSessionId).toBe("session-456")
    })
  })

  describe("file generation", () => {
    it("should generate valid markdown", () => {
      const task1 = manager.addTask("Pending task")
      const task2 = manager.addTask("In progress task")
      manager.updateTaskStatus(task2.id, "in_progress")
      const task3 = manager.addTask("Completed task")
      manager.updateTaskStatus(task3.id, "completed")

      manager.save()

      const content = fs.readFileSync(testPath, "utf-8")

      expect(content).toContain("# Project Progress")
      expect(content).toContain("## 📋 Pending")
      expect(content).toContain("## 🔄 In Progress")
      expect(content).toContain("## ✅ Completed")
      expect(content).toContain("Pending task")
      expect(content).toContain("In progress task")
      expect(content).toContain("Completed task")
    })
  })
})

describe("createProgressManager", () => {
  it("should create a progress manager", () => {
    const manager = createProgressManager()
    expect(manager).toBeInstanceOf(ProgressFileManager)
  })
})
