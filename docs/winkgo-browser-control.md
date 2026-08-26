# WINK GO 浏览器控制中心

## 边界

浏览器由 WINK GO 电脑端执行。Agent、手机和 ESP32 只发送命令，不接收登录 Cookie、完整 DOM、录制选择器或工作流正文。

当前控制目标只允许是 WINK GO 内置浏览器的 `webview`。主应用窗口不会暴露给浏览器工具。

## 电脑端控制链路

```text
Agent / ESP32 command
        |
        v
WINK GO browser MCP / compact Skill dispatcher
        |
        v
Browser Control Service
        |
        v
Visible WINK GO built-in browser webview
```

Browser Control Service 提供两组能力：

1. `inspect_browser_page`：读取当前地址、标题、可见正文和交互元素；每个交互元素带有短期有效的 `ref`。
2. `browser_action`：按 `ref`、CSS 选择器或“可访问性角色 + 名称”执行一个明确动作。

支持的动作包括导航、点击、提交、填写、选择、按键、等待、滚动、前进、后退和刷新。导航只允许 HTTP(S)。

页面发生导航或明显变化后必须重新检查页面，旧 `ref` 不保证继续有效。

## 录制 Skill

新录制步骤会同时保存：

- `data-testid` / `data-test` / `data-cy`；
- 可访问性角色；
- 可访问性名称；
- CSS 后备选择器；
- 文本后备信息。

回放与 Agent 直接控制共用 Browser Control Service。旧版工作流仍能读取和执行；没有语义定位信息时自动退回 CSS 与文本定位。

已保存的 Skill 可以在浏览器工具栏中展开步骤列表。用户可以调整步骤顺序、删除冗余步骤并保存；渲染层只提交原步骤 ID 的新顺序，主进程校验后原子写回，不能从界面注入任意脚本。

如果原选择器失效，回放会重新读取当前页面，并且只在“角色与名称”得到唯一匹配时重试一次。多个候选或无法确认目标时立即停止，避免误点购买、删除、发布等按钮。

密码、验证码、Token、授权码和银行卡安全字段只保存为运行时参数，不写入 Skill 文件、注册表或设备消息。

## ESP32 调用

ESP32 只需发送技能编号和少量参数：

```json
{
  "command": "browser.skill.run",
  "skill_id": "submit-daily-report",
  "parameters": {
    "date": "2026-08-08"
  }
}
```

电脑端读取本地私有工作流并执行。ESP32 只接收执行中、成功、失败或需要用户确认等精简状态。

## 后续阶段

- 上传、下载、iframe、弹窗和多标签语义步骤；
- 条件、循环、断言、重试与取消；
- 可审查的站点级恢复策略与人工确认；
- 灵动岛实时步骤、失败原因和人工接管入口；
- 对 OpenCLI 风格网站适配器和 Browser Harness JS CDP 能力进行隔离验证，验证通过后再决定是否引入依赖。
