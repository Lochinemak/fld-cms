# FLD CRM

基础 CRM：多租户、RBAC（权限控制到页面元素 + 行级数据权限）、预留 OIDC 接入。

## 技术栈

- 后端：NestJS 12、Prisma 7（PostgreSQL）、Redis（ioredis）、zod
- 前端：Vite 8、React 19、TanStack Router / Query、shadcn/ui（Base UI）、Tailwind CSS 4
- 工程：pnpm workspace + Turborepo，Node 24

## 目录结构

```
apps/
  api/         NestJS 后端（接口前缀 /api，Swagger 在 /api/docs）
  web/         React 前端（开发时 /api 代理到 :3000）
packages/
  shared/      前后端共用的 zod schema 和类型
compose.yaml   本地开发用的 Postgres 18 + Redis 8
```

## 快速开始

前置：Node 24、pnpm 10、Docker。

```bash
cp .env.example .env   # 首次：改掉里面的 change-me 密码
pnpm install
pnpm infra:up          # 启动 Postgres（127.0.0.1:15432）和 Redis（127.0.0.1:16379）
pnpm db:deploy         # 应用数据库迁移
pnpm dev               # 同时启动 shared（监听编译）、api（:3000）、web（:5173）
```

打开 http://localhost:5173 ，首页会显示后端、数据库和 Redis 的状态。

## 常用命令

- `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test`：通过 Turborepo 在所有包上执行
- `pnpm db:migrate`：修改 `apps/api/prisma/schema.prisma` 后生成并应用新迁移（开发环境）
- `pnpm db:deploy`：只应用已有迁移（部署环境）
- `pnpm db:studio`：打开 Prisma Studio
- `pnpm --filter @fld/api test:e2e`：后端端到端测试（需要先 `pnpm infra:up`）
- `pnpm format`：用根目录的 Prettier 配置格式化全部代码
- `pnpm infra:down`：停止本地容器（数据保留在 Docker 卷里）

## 约定

- 主键使用雪花 ID（数据库 bigint），接口里以字符串传输，避免 JS 数字精度丢失。
- 表名、字段名用 snake_case，在 Prisma 模型里用 `@map` / `@@map` 映射。
- 本地开发只用根目录一份 `.env`；部署时由容器环境变量提供同名配置。
