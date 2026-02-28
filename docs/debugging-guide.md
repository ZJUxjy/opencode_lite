# VS Code 调试指南

> 本指南帮助你在 VS Code 中调试 Lite OpenCode，当程序崩溃或报错时自动跳转到对应代码位置。

---

## 快速开始

### 1. 编译项目（带 Source Map）

```bash
npm run build
```

**注意**：`tsconfig.json` 已启用 `sourceMap`，确保断点能映射到 TypeScript 源码。

### 2. 启动调试

**方式一**：使用 VS Code 界面
1. 打开 VS Code 左侧的 "Run and Debug" 面板（或按 `Ctrl+Shift+D`）
2. 选择配置：
   - `Debug: Run CLI` - 正常启动
   - `Debug: Run with Resume` - 带 `--resume` 参数启动
   - `Debug: Run Tests` - 运行测试
3. 按 `F5` 或点击绿色播放按钮

**方式二**：使用快捷键
- `F5` - 启动调试
- `Ctrl+F5` - 不带调试启动
- `Shift+F5` - 停止调试
- `Ctrl+Shift+F5` - 重新启动调试

---

## 调试配置说明

### 可用配置

| 配置名称 | 用途 | 说明 |
|---------|------|------|
| `Debug: Run CLI` | 正常运行项目 | 启动 CLI 并等待断点 |
| `Debug: Run with Resume` | 恢复上次会话 | 带 `--resume` 参数启动 |
| `Debug: Run Tests` | 运行所有测试 | 调试测试用例 |
| `Debug: Run Tests (Specific File)` | 调试单个测试文件 | 先打开测试文件再启动 |
| `Debug: Attach to Process` | 附加到已运行进程 | 用于调试已启动的程序 |
| `Build & Debug` | 先编译再调试 | 自动执行 `npm run build` |

### 异常断点（重要！）

捕获未处理的错误，让程序在崩溃处自动停止：

1. 打开 "Run and Debug" 面板
2. 点击下方的 `BREAKPOINTS` 区域
3. 勾选：
   - ☑️ **Uncaught Exceptions** - 捕获未处理的异常
   - ☑️ **Caught Exceptions** - 捕获所有异常（包括 try-catch 中的）

> 💡 **建议**：开发时开启 `Uncaught Exceptions`，可以第一时间定位崩溃原因。

---

## 设置断点

### 普通断点

在代码行号左侧点击，出现红点即可：

```typescript
// src/agent.ts
async run(userInput: string): Promise<string> {
  // 在这里点击设置断点
  this.store.add(this.sessionId, {
    role: "user",
    content: userInput,
  });
  // ...
}
```

### 条件断点

右键点击断点，选择 "Edit Breakpoint"，输入条件表达式：

```typescript
// 只在特定条件下停止
skill.metadata.activation === "auto"

// 或者计数器
i > 10

// 复杂的条件
error && error.message.includes("timeout")
```

### 日志断点

不断程序执行，只输出日志：

1. 右键点击断点
2. 选择 "Edit Breakpoint"
3. 勾选 "Log message to Debug Console"
4. 输入：`Skill activated: {skill.metadata.id}`

---

## 调试技巧

### 1. 查看变量

程序停止时，左侧 `VARIABLES` 面板显示：
- **Local** - 局部变量
- **Closure** - 闭包变量
- **Global** - 全局变量

鼠标悬停在变量上可查看值。

### 2. 监视表达式

在 `WATCH` 面板添加表达式：

```javascript
// 监视特定变量
skill.isActive

// 监视计算值
this.skills.size

// 监视复杂表达式
JSON.stringify(skill.metadata, null, 2)
```

### 3. 调用堆栈

`CALL STACK` 面板显示函数调用链：
- 点击堆栈帧跳转到对应代码
- 右键选择 "Restart Frame" 重新执行当前函数
- 右键选择 "Copy Call Stack" 复制堆栈信息

### 4. 控制台调试

在 `DEBUG CONSOLE` 中执行代码：

```javascript
// 查看变量
skill

// 执行函数
registry.getActive()

// 修改变量（仅在当前调试会话有效）
skill.isActive = true
```

### 5. 步进控制

| 快捷键 | 功能 | 说明 |
|--------|------|------|
| `F10` | Step Over | 执行当前行，不进入函数内部 |
| `F11` | Step Into | 进入函数内部 |
| `Shift+F11` | Step Out | 跳出当前函数 |
| `F5` | Continue | 继续执行到下一个断点 |

---

## 调试常见问题

### 断点不生效（灰色空心）

**原因**：Source Map 未正确生成或配置

**解决**：
1. 检查 `tsconfig.json` 中 `"sourceMap": true`
2. 重新编译：`npm run build`
3. 确保 `.js.map` 文件在 `dist/` 目录中生成
4. 检查 `launch.json` 中的 `outFiles` 路径正确

### 断点跳转到错误位置

**原因**：源码和编译后的代码不同步

**解决**：
```bash
# 清理并重新编译
rm -rf dist
npm run build
```

### 无法启动调试

**错误信息**：`Cannot find runtime 'node' on PATH`

**解决**：
1. 确保 Node.js 已安装：`node --version`
2. 在 VS Code 终端中运行：`which node`
3. 如使用 nvm，在 `.vscode/settings.json` 中添加：
   ```json
   {
     "terminal.integrated.shellArgs.linux": ["-l"]
   }
   ```

### 调试时终端无响应

**原因**：Ink TUI 与调试终端冲突

**解决**：
1. 在 `launch.json` 中已配置 `"console": "integratedTerminal"`
2. 调试时会有独立终端，与 Debug Console 分开
3. 确保焦点在正确的终端中

### 异步代码调试困难

**技巧**：
1. 使用 `async/await` 替代回调
2. 开启 `Caught Exceptions` 捕获异步错误
3. 在 Promise 链的关键位置设置断点

---

## 实战示例

### 场景 1：调试 Skill 加载失败

1. 在 `src/skills/loader.ts` 第 50 行设置断点：
   ```typescript
   const skillMetadata = validate
     ? validateMetadata(metadata)
     : (metadata as unknown as SkillMetadata)
   ```

2. 启动 `Debug: Run CLI`

3. 程序会在加载 skill 时停止，检查：
   - `metadata` - YAML 解析结果
   - `skillMetadata` - 验证后的数据
   - `content` - Markdown 内容

### 场景 2：捕获未处理的 Promise 异常

1. 开启 `Uncaught Exceptions` 断点

2. 在 `src/agent.ts` 的 `run()` 方法中可能有：
   ```typescript
   const result = await this.reactRunner.run(...)
   ```

3. 如果 `reactRunner.run()` 抛出未捕获的异常，调试器会自动停止在异常位置

### 场景 3：调试测试失败

1. 打开失败的测试文件，如 `src/skills/__tests__/registry.test.ts`

2. 在失败的测试用例中设置断点：
   ```typescript
   it("should activate a skill", () => {
     const skill = createMockSkill("activatable")
     registry.register(skill)
     // 在这里设置断点
     const result = registry.activate("activatable")
   })
   ```

3. 选择 `Debug: Run Tests (Specific File)` 配置

4. 调试器会在断点处停止，检查 `registry` 和 `result`

---

## 高级配置

### 自定义启动参数

编辑 `.vscode/launch.json`：

```json
{
  "name": "Debug: Custom Args",
  "type": "node",
  "request": "launch",
  "runtimeArgs": [
    "--inspect-brk",
    "${workspaceFolder}/dist/index.js",
    "--model", "claude-sonnet-4",
    "--resume"
  ]
}
```

### 环境变量调试

```json
{
  "name": "Debug: With Env",
  "type": "node",
  "request": "launch",
  "env": {
    "DEBUG": "true",
    "LOG_LEVEL": "debug"
  }
}
```

### 远程调试

如果程序在其他机器上运行：

```bash
# 在远程机器上
node --inspect=0.0.0.0:9229 dist/index.js
```

```json
// 在本地 VS Code 中
{
  "name": "Attach Remote",
  "type": "node",
  "request": "attach",
  "address": "remote-ip",
  "port": 9229,
  "localRoot": "${workspaceFolder}",
  "remoteRoot": "/path/to/project"
}
```

---

## 快捷键速查

| 操作 | Windows/Linux | Mac |
|------|---------------|-----|
| 启动调试 | `F5` | `F5` |
| 停止调试 | `Shift+F5` | `Shift+F5` |
| 重新启动 | `Ctrl+Shift+F5` | `Cmd+Shift+F5` |
| 单步跳过 | `F10` | `F10` |
| 单步进入 | `F11` | `F11` |
| 单步跳出 | `Shift+F11` | `Shift+F11` |
| 切换断点 | `F9` | `F9` |
| 条件断点 | `Ctrl+Shift+F9` | `Cmd+Shift+F9` |
| 打开调试面板 | `Ctrl+Shift+D` | `Cmd+Shift+D` |

---

## 推荐配置

在 `.vscode/settings.json` 中添加：

```json
{
  "debug.inlineValues": true,
  "debug.showBreakpointsInOverviewRuler": true,
  "debug.console.collapseIdenticalLines": true,
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

---

## 更多资源

- [VS Code 调试文档](https://code.visualstudio.com/docs/editor/debugging)
- [Node.js 调试指南](https://nodejs.org/en/docs/guides/debugging-getting-started/)
- [TypeScript 调试配置](https://code.visualstudio.com/docs/typescript/typescript-debugging)
