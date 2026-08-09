# ESS Event Listener

ESS Event Listener 是一个用于接收、保存和查看 SAP Concur Event Subscription Service（ESS）事件通知的 Node.js 应用。它同时提供受保护的 Webhook 接口和轻量级管理界面，适合开发、联调及事件排查场景。

## 项目能力

- 接收 SAP Concur ESS 推送的 JSON 事件。
- 将事件 payload、topic、时间、correlation ID 和来源 IP 保存至 MongoDB。
- 按时间分页浏览事件，并按 topic 筛选。
- 对 payload 进行关键词搜索。
- 查看单条事件的完整 payload。
- 删除单条事件或清空事件记录。
- 根据服务端接收时间自动清理过期数据。
- 使用事件 ID 唯一索引实现重复通知的幂等处理。

## 工作流程

```text
SAP Concur ESS
      │  HTTP Basic Auth
      ▼
POST /eventlistener
      │  校验、规范化、幂等保存
      ▼
   MongoDB
      │
      ▼
管理界面 ── 浏览 / 筛选 / 搜索 / 删除
```

Webhook 使用 `LEU_USER` 和 `LEU_PASSWORD`，管理界面使用独立的 `ADMIN_USER` 和 `ADMIN_PASSWORD`。两组凭据不应复用。

## 技术栈

- Node.js 20.19+
- Express 5
- MongoDB 4.2+
- Mongoose 9
- EJS 6
- node-cron
- Node.js Test Runner 与 Supertest

## 目录结构

```text
.
├── app.js                  # 应用、路由、数据模型、认证及定时清理
├── common.js               # 日期与时间工具
├── public/                 # 浏览器端 CSS、JavaScript 和图片
├── views/                  # EJS 页面及公共组件
├── test/                   # 自动化测试
├── .env.example            # 环境变量模板
├── Procfile                # 进程启动声明
├── package.json            # 依赖和运行脚本
└── LICENSE                 # MIT License
```

## 快速开始

1. 安装依赖：

   ```sh
   npm install
   ```

2. 创建本地配置：

   ```sh
   cp .env.example .env
   ```

3. 修改 `.env` 中的数据库地址和全部凭据。

4. 运行测试并启动应用：

   ```sh
   npm test
   npm start
   ```

5. 打开 `http://localhost:3030/`，使用管理端凭据登录。

## 环境变量

| 变量 | 必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DB_CONNECT_STRING` | 是 | — | MongoDB 连接 URI |
| `LEU_USER` | 是 | — | ESS Webhook 和连接测试用户名 |
| `LEU_PASSWORD` | 是 | — | ESS Webhook 和连接测试密码 |
| `ADMIN_USER` | 是 | — | 管理界面用户名 |
| `ADMIN_PASSWORD` | 是 | — | 管理界面密码 |
| `PORT` | 否 | `3030` | HTTP 服务端口 |
| `RECORD_AGE` | 否 | `7` | 事件保留天数 |
| `TRUST_PROXY` | 否 | 未启用 | 信任的反向代理层数，例如 `1` |
| `NODE_ENV` | 否 | — | 设置为 `production` 时启用安全 Cookie 和 HSTS |

缺少数据库地址或任一组凭据时，应用会拒绝启动。生产环境必须通过 HTTPS 提供服务。

## HTTP 接口

| 方法 | 路径 | 认证 | 用途 |
| --- | --- | --- | --- |
| `POST` | `/eventlistener` | LEU | 接收 ESS 事件通知 |
| `GET` | `/system/v1.0/testconnection` | LEU | 验证 ESS 连接凭据 |
| `GET` | `/events/:page` | Admin | 分页浏览及筛选事件 |
| `GET` | `/event/:eventId` | Admin | 查看事件详情 |
| `GET` | `/eventsearch?keyword=...` | Admin | 搜索事件 payload |
| `POST` | `/eventdelete/:eventId` | Admin + CSRF | 删除单条事件 |
| `POST` | `/deleteallevents` | Admin + CSRF | 删除全部事件 |

Webhook 请求示例：

```sh
curl --user "$LEU_USER:$LEU_PASSWORD" \
  --header "Content-Type: application/json" \
  --data '{
    "id": "event-123",
    "timeStamp": "2026-08-09T00:00:00Z",
    "topic": "public.concur.request",
    "eventType": "UPDATED",
    "facts": { "href": "https://us.api.example.com/requests/123" }
  }' \
  http://localhost:3030/eventlistener
```

成功接收时返回 HTTP `200` 和事件 ID。相同 ID 再次送达时也返回成功，但不会重复保存。

## 数据与清理

每条记录包含以下主要字段：

- `id`：ESS 事件 ID，具有唯一索引。
- `timeStamp`：事件声明的发生时间，保存为 MongoDB `Date`。
- `receivedAt`：服务端实际接收时间。
- `topic`、`type`、`facts`、`payload`：事件内容。
- `correlationId`、`clientIpAddress`：诊断信息。

清理任务每天在 `Asia/Shanghai` 时区的 01:00 运行，并依据不可由发送方控制的 `receivedAt` 删除超过 `RECORD_AGE` 的记录。启动时会自动迁移旧版字符串时间戳和缺失的接收时间。

如果现有数据库包含重复的非空事件 ID，必须先解决重复数据；否则唯一索引无法创建，应用将安全地停止启动。

## 安全设计

- Webhook 与管理端使用相互独立的 HTTP Basic 凭据。
- 请求体、字段长度、时间戳和分页参数均受到验证。
- JSON 请求体最大为 1 MB。
- 删除表单要求 SameSite Cookie 和匹配的 CSRF token。
- 搜索词按普通文本转义，不作为原始正则表达式执行。
- 页面使用 Content Security Policy、HSTS、禁止缓存及其他安全响应头。
- 内部异常不会通过 HTTP 响应返回给调用方。

Basic Auth 本身不提供传输加密，因此生产环境必须配置 TLS。MongoDB 也应启用认证、网络访问控制和备份。

## 测试

```sh
npm test
npm audit --omit=dev
```

测试覆盖认证、Webhook 校验、重复事件、XSS 输出、CSRF、分页筛选、数据保留及配置失败路径。

## License

本项目采用 [MIT License](./LICENSE)。你可以在保留版权声明和许可声明的前提下使用、复制、修改、发布及分发本软件。
