# WINK GO 隐私政策 / Privacy Policy

**政策版本 / Policy version:** 2026-07-30  
**生效日期 / Effective date:** 2026-07-30  
**联系邮箱 / Contact:** 1394748660@qq.com

> 本文件是 WINK GO 项目的隐私政策基线，不构成法律意见。面向具体国家或地区正式运营前，应由熟悉当地法律的执业律师复核，并根据实际部署、供应商和数据流更新。
>
> This document is the WINK GO project privacy-policy baseline, not legal advice. Before operating in a particular country or region, have qualified local counsel review it and update it for the actual deployment, vendors, and data flows.

## 中文

### 1. 适用范围与角色

本政策适用于 WINK GO 桌面端、配套移动端或小程序、WINK GO 账号服务、设备配对、云端中转和用户主动提交的反馈。自行部署者、第三方模型或 API 提供商可能是独立的个人信息处理者，并适用其自己的政策。

WINK GO 的开源代码依据仓库中的 `LICENSE`、`NOTICE` 和第三方声明授权；本政策说明账号与在线服务中的个人信息处理，不改变开源许可证，也不把第三方服务变成 WINK GO 自有服务。

### 2. 本地优先不等于永不联网

WINK GO 采用本地优先设计。工作区文件、许多设置、对话和工具执行结果通常保存在用户选择的设备或工作区中。仅使用完全本地的功能时，这些内容通常不会自动上传到 WINK GO 账号服务。

当用户登录、注册、配对设备、启用云端中转、调用在线模型或 API、使用消息平台、语音服务或主动发送反馈时，完成相应功能所需的数据会离开设备。用户应在使用前检查端点、模型、MCP、Skill 和第三方服务的配置与政策。

### 3. 我们处理的信息

- **账号与认证信息：** 用户名、手机号、账号标识、注册和登录时间、认证请求、会话令牌及必要的安全记录。密码会通过 HTTPS（TLS）提交给托管账号服务进行验证，不应以明文形式保存。
- **设备与绑定信息：** 随机安装标识、桌面或设备标识、配对状态，以及由设备特征生成的哈希指纹。哈希指纹仍可能与设备或账号关联，我们不会把它描述成完全匿名信息。
- **云中转与小程序信息：** 账号、安装实例、电脑、智能体、会话和任务标识，配对码的状态与有效期，消息路由所需的时间戳、随机数、连接状态，以及用户通过中转发送的文字、语音转写或任务结果。
- **模型与第三方服务数据：** 用户主动发送给模型、API、MCP、Skill、语音识别或消息平台的提示词、上下文、文件或其他内容，以及端点处理所需的技术元数据。
- **用户主动反馈：** 用户填写的问题描述、所选模块、主动添加或确认发送的截图和附件，以及界面事先展示的必要应用版本、平台、路由或错误上下文。用户提交前应移除不希望共享的个人信息、密钥和机密内容。
- **安全与运行记录：** 为防止滥用、排查故障、维持账号会话、设备绑定和中转连接而产生的有限日志。产品可能使用连接保活或会话校验；我们不会再声称“没有心跳”或“只记录用户名和登录次数”。

当前正式打包的终端用户版本默认不启用自动崩溃、会话、追踪、截图或性能遥测。发送到反馈服务的报告须由用户主动提交；未打包的本地开发环境可由开发者通过显式环境变量开启诊断遥测，这不属于终端用户版本的默认行为。

用户登录 WINK GO 账号后，云端设备转发默认开启，用于签发一次性设备绑定码并维持用户所选的远程设备连接。该设置会连接 `wss://winkgo.top/desktop`，用户可随时在 MCP 配置页关闭；关闭后桌面端不再建立该中转连接。

### 4. 使用目的

我们仅为以下目的处理必要信息：创建和验证账号；保持用户选择的会话；绑定、识别和撤销设备；路由小程序与桌面端任务；提供用户主动调用的模型或第三方服务；处理反馈和安全事件；防止欺诈、攻击与跨账号访问；履行法律义务。

### 5. 第三方、云中转与跨境

云端中转只承担账号鉴权、首次绑定、消息路由和结果转发，不代表所有桌面工作区内容都会上传。用户选择的模型、API、语音、消息平台、MCP 或其他供应商会按照其条款独立处理收到的数据。

服务商、服务器或模型端点可能位于用户所在国家或地区之外，因此用户主动启用这些能力时可能发生跨境传输。WINK GO 的部署运营者应根据适用法律提供必要告知、取得所需授权并采用适用的传输机制；如果无法满足要求，应停用相应跨境端点。仅勾选本政策不替代法律要求的单独同意或其他程序。

### 6. 保存期限与删除请求

我们以实现上述目的所必需的最短期限为原则：

- 本地数据保留到用户在应用内删除、清除数据目录或卸载时；卸载是否删除数据取决于操作系统和安装选项。
- 账号服务代码包含定时清理规则：已处于非活动状态的下载票据在 30 天后删除，已处于非活动状态的会话在 90 天后删除，登录安全事件在 180 天后删除，限流记录在 1 天后删除。这些期限以部署运营者按要求持续运行维护任务为前提；正式上线前必须核验维护任务确已启用。
- 账号、手机号、设备、设备绑定和政策同意记录目前没有自动到期删除任务，账号存续期间会继续保存。桌面端目前也没有可由用户自行调用的账号删除接口；收到并核验删除请求后，须由部署运营者人工关闭、删除或去标识化相关记录，并按其已经公示的备份轮换和法定留存规则处理副本。
- 中转消息和连接记录仅在投递、重试、安全审计和故障排查所需期间保存；第三方模型或平台的保存期限由其政策决定。
- 用户反馈保留到问题处理、质量改进和必要的安全审计完成；不再需要时删除或去标识化。

当前桌面端权利请求渠道是发送邮件至 **1394748660@qq.com**，可请求访问、更正、导出、撤回同意、解除设备绑定、删除账号或删除相关个人信息。为防止冒名操作，我们可能要求核验账号或设备归属。法律要求继续保存或暂时无法从备份删除时，我们会限制除存储和安全保护之外的处理，并在可行时完成删除。实际部署运营者尚未在本文件中确定受理确认时限、处理完成时限和备份轮换周期；在这些信息确定并公示前，不应把托管账号或官方云端中转作为已具备完整生产合规条件的服务开放。

### 7. 不出售、不做定向广告

WINK GO 不出售或出租个人信息，不使用个人信息建立广告画像，也不在项目中投放基于个人信息的定向广告。向完成用户所选功能所必需的处理服务商传输数据，不代表允许其为自身广告目的使用数据。

### 8. 安全、用户选择与未成年人

我们对托管账号服务和官方云端中转采用 HTTPS/WSS（TLS）传输，并采取与风险相称的访问控制、令牌保护、最小化和日志脱敏措施。局域网二维码直连当前使用本地 HTTP/WebSocket；未另行配置 HTTPS 时，该局域网链路不提供传输加密，因此只能在可信网络内使用，不能直接暴露到公网。任何系统都无法保证绝对安全。请保护账号、设备码、API 密钥和本机数据目录；只连接可信端点，不要通过反馈发送秘密信息。

用户可以不启用在线模型、云中转、语音、消息平台或反馈功能，并可使用适用的本地能力。若当地法律要求监护人同意，未成年人应在取得有效同意后使用账号与在线服务。

### 9. 政策更新

数据类别、用途、接收方或跨境安排发生实质变化时，应先更新本政策并在适用法律要求时重新取得同意。本机保存的同意记录只证明该设备上勾选过相应政策版本，不替代服务器端审计记录或法定程序。

## English

### 1. Scope and roles

This policy covers the WINK GO desktop app, companion mobile app or mini program, WINK GO account services, device pairing, cloud relay, and feedback a user chooses to submit. A self-hosting operator and third-party model or API providers may act as independent controllers or processors under their own notices.

The open-source code is licensed under the repository `LICENSE`, `NOTICE`, and third-party notices. This policy describes personal-data handling for accounts and online services; it does not change the open-source license or turn a third-party service into a WINK GO-operated service.

### 2. Local-first does not mean never online

WINK GO is designed to be local-first. Workspace files, many settings, conversations, and tool results are normally stored on the device or in the workspace selected by the user. When only local features are used, this content is not normally uploaded automatically to the WINK GO account service.

Data required for a selected function leaves the device when the user signs in or registers, pairs a device, enables the cloud relay, calls an online model or API, uses a messaging or speech provider, or submits feedback. Users should review the configured endpoints and the policies of each model, MCP server, Skill, and third-party service.

### 3. Information we process

- **Account and authentication data:** username, mobile number, account identifier, registration and sign-in times, authentication requests, session tokens, and necessary security records. A password is transmitted to the hosted account service over HTTPS (TLS) for verification and should not be stored in plaintext.
- **Device and binding data:** a random installation identifier, desktop or device identifiers, binding state, and a hashed fingerprint derived from device characteristics. A hash may still be linkable to a device or account and is not represented as fully anonymous.
- **Cloud-relay and mini-program data:** account, installation, desktop, agent, session, and task identifiers; pairing-code status and expiry; timestamps, nonces, connection state, and the text, speech transcript, or task result routed at the user's request.
- **Model and third-party service data:** prompts, context, files, and other content the user intentionally sends to a model, API, MCP server, Skill, speech service, or messaging platform, plus technical metadata required by that endpoint.
- **User-initiated feedback:** the description, selected module, screenshots or attachments the user adds or confirms, and necessary app version, platform, route, or error context shown before submission. Users should remove personal information, secrets, and confidential material they do not want to share.
- **Security and operational records:** limited logs needed to prevent abuse, troubleshoot failures, maintain account sessions, bind devices, and keep a selected relay connection operating. The product may use connection keep-alives or session validation; we do not claim that it has “no heartbeat” or stores only a username and sign-in count.

The current packaged end-user build does not enable automatic crash, session, tracing, screenshot, or performance telemetry by default. A report sent to the feedback service must be initiated by the user. In an unpackaged local development environment, a developer can explicitly enable diagnostic telemetry through an environment variable; that is not the end-user build default.

After a user signs in to a WINK GO account, cloud device relay is enabled by default to issue one-time device pairing codes and maintain the remote-device connection selected by the user. This setting connects to `wss://winkgo.top/desktop`; users can turn it off at any time in MCP settings, after which the desktop no longer establishes that relay connection.

### 4. Purposes

We process necessary information to create and authenticate accounts; maintain a user-selected session; bind, identify, and revoke devices; route mini-program and desktop tasks; provide a model or third-party service requested by the user; handle feedback and security incidents; prevent fraud, attacks, and cross-account access; and meet legal obligations.

### 5. Third parties, cloud relay, and international transfers

The cloud relay is intended for account authentication, initial binding, message routing, and result forwarding. This does not mean that every desktop workspace file is uploaded. Models, APIs, speech providers, messaging platforms, MCP servers, and other vendors selected by the user process received data under their own terms.

A provider, server, or model endpoint may be outside the user's country or region, so enabling that function may cause an international transfer. The deployment operator must provide required notices, obtain required authorization, and use an applicable transfer mechanism. If those requirements cannot be met, the cross-border endpoint should be disabled. Checking this policy is not a substitute for any legally required separate consent or procedure.

### 6. Retention and deletion requests

We follow the principle of retaining data only for the shortest period necessary for the purposes above:

- Local data remains until the user deletes it in the app, clears the data directory, or uninstalls. Whether uninstalling removes data depends on the operating system and installer choice.
- The account-service code contains scheduled cleanup rules: download tickets that are no longer active are deleted after 30 days, sessions that are no longer active after 90 days, sign-in security events after 180 days, and rate-limit records after one day. These periods depend on the deployment operator continuously running the required maintenance job; its operation must be verified before production launch.
- Accounts, mobile numbers, devices, device bindings, and policy-consent records currently have no automatic expiry-deletion job and remain while the account exists. The desktop app also has no user-operated account-deletion API at present. After a deletion request is received and verified, the deployment operator must manually close, delete, or de-identify the relevant records and handle copies under its published backup-rotation and legally required retention rules.
- Relay messages and connection records are kept only as needed for delivery, retry, security review, and troubleshooting. A third-party model or platform applies its own retention policy.
- Feedback is kept until issue handling, quality improvement, and necessary security review are complete, then deleted or de-identified when no longer needed.

The current desktop rights-request channel is **1394748660@qq.com**. Users may request access, correction, export, withdrawal of consent, device unbinding, account deletion, or deletion of related personal data. We may verify account or device ownership to prevent impersonation. If law requires continued retention or immediate backup deletion is technically infeasible, processing will be restricted to storage and necessary security protection until deletion is feasible. The actual deployment operator has not yet specified in this document the acknowledgement deadline, completion deadline, or backup-rotation period. Until those details are fixed and published, the hosted account service and official cloud relay should not be represented as fully production-compliant services.

### 7. No sale or targeted advertising

WINK GO does not sell or rent personal data, build advertising profiles from it, or serve targeted advertising based on personal data. A transfer to a service provider needed to perform a function selected by the user does not authorize that provider to use the data for its own advertising.

### 8. Security, choices, and children

The hosted account service and official cloud relay use HTTPS/WSS (TLS), together with access controls, token protection, minimization, and log redaction appropriate to the risk. Local QR pairing currently uses HTTP/WebSocket on the local network; unless HTTPS is configured separately, that LAN connection is not transport-encrypted and must be used only on a trusted network, never exposed directly to the public internet. No system can guarantee absolute security. Protect account credentials, pairing codes, API keys, and the local data directory; connect only to trusted endpoints and do not send secrets through feedback.

Users may choose not to enable online models, cloud relay, speech, messaging, or feedback and may continue using applicable local features. Where local law requires parental consent, a minor should use account and online services only after valid consent is obtained.

### 9. Changes

If data categories, purposes, recipients, or transfer arrangements materially change, this policy should be updated first and consent renewed where required. A consent record stored on one device only shows that the corresponding policy version was checked on that device; it does not replace server audit records or legally required procedures.
