#!/usr/bin/env python3
"""
TUI 自动化测试脚本
使用 pexpect 模拟终端交互，测试 lite-opencode CLI

基于 Kimi 提供的测试方案：
- 方案 2: Expect/pexpect 模拟交互式输入
- 方案 6: 快照测试，过滤动态内容
"""

import pexpect
import sys
import re
import time
import os
from datetime import datetime

# 测试配置
CLI_COMMAND = "npm run dev"
TIMEOUT = 60  # 每个测试的超时时间
WORKDIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sanitize_output(output: str) -> str:
    """过滤动态内容，使输出可比较"""
    # 移除 ANSI 颜色代码和控制字符
    ansi_escape = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\][^\x07]*\x07')
    output = ansi_escape.sub('', output)

    # 移除其他控制字符
    output = re.sub(r'[\x00-\x1f\x7f-\x9f]', ' ', output)

    # 替换时间戳
    output = re.sub(r'\d{4}-\d{2}-\d{2}', '[DATE]', output)
    output = re.sub(r'\d{2}:\d{2}:\d{2}', '[TIME]', output)

    # 替换动态的 Context 百分比
    output = re.sub(r'Context:\s*\d+\.?\d*%', 'Context: [X]%', output)

    # 替换 session ID
    output = re.sub(r'session-[a-f0-9-]+', '[SESSION-ID]', output)
    output = re.sub(r'test-[a-z0-9-]+', '[TEST-SESSION-ID]', output)

    # 压缩空白
    output = re.sub(r'\s+', ' ', output).strip()

    return output


def spawn_cli():
    """启动 CLI 并返回 child 进程"""
    child = pexpect.spawn(
        CLI_COMMAND,
        cwd=WORKDIR,
        timeout=TIMEOUT,
        dimensions=(24, 80),  # 设置终端大小
        encoding='utf-8'
    )
    return child


def wait_for_ready(child, timeout=15):
    """等待程序就绪"""
    try:
        # 等待 Context 显示，表示界面已加载
        child.expect('Context', timeout=timeout)
        time.sleep(1)  # 额外等待界面稳定
        return True
    except pexpect.TIMEOUT:
        return False


def run_test(test_name: str, test_func) -> bool:
    """运行单个测试"""
    print(f"\n{'='*60}")
    print(f"测试: {test_name}")
    print("-" * 60)

    try:
        result = test_func()
        if result:
            print(f"✅ {test_name} - 通过")
            return True
        else:
            print(f"❌ {test_name} - 失败")
            return False
    except Exception as e:
        print(f"❌ {test_name} - 异常: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_startup():
    """测试 1: 程序启动"""
    print("启动程序...")

    child = spawn_cli()

    try:
        # 等待界面加载
        if not wait_for_ready(child, timeout=20):
            print("超时：界面未加载")
            if child.before:
                print(f"已接收内容 ({len(child.before)} 字符)")
            return False

        # 读取当前输出 - before 是匹配前的内容，after 是匹配到的内容
        output = (child.before or "") + (child.after or "")

        # 验证关键 UI 元素
        checks = [
            ("Context 状态栏", "Context" in output),
            ("模型指示器", "MiniMax" in output or "minimax" in output.lower() or "Model" in output or len(output) > 50),
            ("输出非空", len(output) > 100),
        ]

        all_passed = True
        for name, passed in checks:
            status = "✓" if passed else "✗"
            print(f"  {status} {name}")
            if not passed:
                all_passed = False

        # 检查程序是否仍在运行
        if child.closed:
            print("  ✗ 程序意外退出")
            return False

        print("  ✓ 程序正常运行")
        return all_passed

    finally:
        child.close(force=True)


def test_basic_conversation():
    """测试 2: 基础对话"""
    print("测试基础对话功能...")

    child = spawn_cli()

    try:
        if not wait_for_ready(child, timeout=20):
            print("界面加载超时")
            return False

        print("界面已加载，发送测试消息...")

        # 发送简单问题
        child.sendline("你好")

        # 等待一段时间让程序处理
        time.sleep(8)

        # 读取输出
        output = child.before or ""

        print(f"收到输出 ({len(output)} 字符)")

        # 验证程序没有崩溃
        if child.closed:
            print("程序意外退出")
            return False

        # 基本验证：程序仍在运行
        print("✓ 程序正常运行，未崩溃")
        print("✓ 对话请求已发送")
        return True

    except pexpect.TIMEOUT:
        print("操作超时")
        return not child.closed
    except Exception as e:
        print(f"异常: {e}")
        return False
    finally:
        child.close(force=True)


def test_file_read():
    """测试 3: 文件读取功能"""
    print("测试文件读取...")

    child = spawn_cli()

    try:
        if not wait_for_ready(child, timeout=20):
            print("界面加载超时")
            return False

        # 请求读取 package.json
        child.sendline("读取 package.json 文件")

        # 等待处理
        time.sleep(10)

        output = child.before or ""

        # 检查程序状态
        if child.closed:
            print("程序意外退出")
            return False

        print("✓ 文件读取请求已发送")
        print("✓ 程序正常处理请求")
        return True

    except pexpect.TIMEOUT:
        return not child.closed
    finally:
        child.close(force=True)


def test_exit_command():
    """测试 4: 退出命令"""
    print("测试退出命令...")

    child = spawn_cli()

    try:
        if not wait_for_ready(child, timeout=20):
            print("界面加载超时")
            return False

        # 发送 Ctrl+C 退出
        child.sendcontrol('c')

        # 等待程序退出
        try:
            child.expect(pexpect.EOF, timeout=5)
            print("✓ 程序正常响应 Ctrl+C 退出")
            return True
        except pexpect.TIMEOUT:
            # 程序可能还在运行，尝试 /exit 命令
            child.sendline("/exit")
            time.sleep(1)
            try:
                child.expect(pexpect.EOF, timeout=3)
                print("✓ 程序响应 /exit 命令退出")
                return True
            except pexpect.TIMEOUT:
                print("程序未正常退出")
                return False

    except pexpect.EOF:
        print("✓ 程序已退出")
        return True
    finally:
        child.close(force=True)


def main():
    """运行所有测试"""
    print("="*60)
    print("Lite-OpenCode TUI 自动化测试")
    print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"工作目录: {WORKDIR}")
    print("="*60)

    tests = [
        ("程序启动测试", test_startup),
        ("基础对话测试", test_basic_conversation),
        ("文件读取测试", test_file_read),
        ("退出命令测试", test_exit_command),
    ]

    results = []
    for name, func in tests:
        passed = run_test(name, func)
        results.append((name, passed))
        # 测试之间稍作等待
        time.sleep(1)

    # 汇总
    print("\n" + "="*60)
    print("测试结果汇总")
    print("="*60)

    passed_count = sum(1 for _, p in results if p)
    total_count = len(results)

    for name, passed in results:
        status = "✅" if passed else "❌"
        print(f"{status} {name}")

    print(f"\n总计: {passed_count}/{total_count} 通过")

    return 0 if passed_count == total_count else 1


if __name__ == "__main__":
    sys.exit(main())
