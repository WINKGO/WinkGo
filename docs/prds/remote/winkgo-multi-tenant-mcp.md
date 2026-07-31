# WINK GO 多租户桌面 Agent 与小程序协议

## 目标

所有客户使用同一个 WINK GO 安装包。Agent、界面和本地 Runtime 保持一致，但账号、安装实例、电脑、Agent、会话与任务必须严格隔离。

桌面端负责本地文件和技能执行；`winkgo.top` 只负责登录鉴权、首次绑定、消息路由和任务结果转发，不在云端为每位客户运行完整桌面 Agent。

## 六层执行上下文

| 字段              | 含义       | 生命周期                           |
| ----------------- | ---------- | ---------------------------------- |
| `account_id`      | 客户账号   | 用户账号长期稳定                   |
| `installation_id` | 安装实例   | 首次安装生成，重装后变化           |
| `desktop_id`      | 具体电脑   | 当前安装的桌面设备身份             |
| `agent_id`        | Agent 实例 | 区分桌面、手机小智、ESP32 等 Agent |
| `session_id`      | 对话会话   | 每段连续对话独立                   |
| `task_id`         | 执行任务   | 每次执行唯一，用于去重与结果关联   |

桌面端同时兼容协议中的 camelCase 字段。旧小程序只发送 `messageId` 与 `skillScope` 时，桌面端会自动映射到六层上下文。

## 首次绑定

1. WINK GO 首次启动生成 `installation_id`、`desktop_id` 和设备密钥。
2. 桌面端使用设备令牌主动连接 `wss://winkgo.top/desktop`。
3. 云端返回一次性绑定码；用户在微信小程序中确认绑定。
4. 云端在 `relay.hello` 中返回 `accountId`，桌面端将账号写入本机受保护的设备身份。
5. 已绑定的安装实例拒绝静默切换到其他账号。换账号或迁移设备必须经过显式解绑和重新授权。

绑定码只用于首次建立关系，不能代替后续设备令牌。

## 小程序下发任务

```json
{
  "type": "miniapp.message.send",
  "timestamp": 1800000000000,
  "nonce": "unique_replay_nonce_123456",
  "account_id": "u_aaaaaaaaaaaaaaaaaaaaaaaa",
  "installation_id": "installation-001",
  "desktop_id": "WINKGO-DESKTOP-001",
  "agent_id": "winkgo-desktop-agent",
  "session_id": "session-001",
  "task_id": "task-001",
  "text": "打开网易云音乐"
}
```

桌面返回结果时回传同一组标识。相同安装、电脑和 `task_id` 的重复投递只执行一次；如果同一任务被另一个账号、Agent 或会话认领，桌面端直接拒绝。

## MCP 兼容

桌面端连接本机 Runtime 后读取 `tools/list`：

- Runtime 明确声明 `execution_context` 或 `context` 时，将六层上下文随 `tools.run_skill_command` 一起传入。
- 旧 Runtime 没有声明时，继续使用原有 `{ command, source }` 参数，不发送未知字段。

这样新版可以做完整的租户审计和任务隔离，旧版 Runtime 仍可正常执行。

## Agent 与通道隔离

手机小智、ESP32 小智、ESP32 表情设备必须使用不同的 `agent_id`、令牌、连接状态和任务队列。它们可以归属同一个 `account_id`，但不能共用设备令牌或执行队列。

## 低配置原则

- 每台电脑只保持一个出站 WebSocket。
- 无云端 Agent 常驻进程；连接状态通过有限的会话校验、心跳或状态上报维护。
- 本地 Runtime 和技能按需执行。
- 任务去重缓存有数量和时间上限。
- MCP 工具能力只在每次 Runtime 连接后读取一次。
- GIF 和 ESP32 表情继续使用独立 HTTPS 设备服务，不进入桌面技能消息通道。
