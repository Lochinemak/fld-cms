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
deploy/        单机部署示例（docker compose）
.github/       CI：检查、测试，并把镜像推到 ghcr.io
compose.yaml   本地开发用的 Postgres 18 + Redis 8，另有可选的 RustFS（本地试 S3 存储，见 .env.example）
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

打开 http://localhost:5173 ，用超级管理员登录（见下一节），会进入「租户管理」。租户里的成员登录后，首页是工作台：显示当前租户、你在该租户的页面和按钮权限，后端、数据库和 Redis 的状态，以及你能看到的文件里最近上传或更新的 10 个（有「文件库」页面权限才有这张卡片）。每个人可以在「编辑工作台」里调整显示哪些卡片、顺序和大小，布局记在浏览器里。

## 首次登录

API 第一次连上空数据库时，会创建系统租户（ID 1，编码 `system`）和超级管理员 `superadmin`（可用 `SUPER_ADMIN_USERNAME` 改名）。初始密码随机生成，只在这次启动的日志里打印一次（`SystemBootstrapService` 的 WARN 行），首次登录后必须修改；忘了就用下面的 `reset-password` 命令重置。

账号全局唯一（用户名或邮箱都能登录），可以同时属于多个租户：登录后可以切换租户，下次登录默认进入上次使用的租户。

超级管理员只管平台，不进各租户的业务：在「租户管理」里新建、编辑和停用租户。新建时给租户指定管理员（选已有账号，或者新建账号），之后的部门、角色和成员由租户管理员自己管；管理员离开了，用「重设管理员」换一个。

## 常用命令

- `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test`：通过 Turborepo 在所有包上执行
- `pnpm db:migrate`：修改 `apps/api/prisma/schema.prisma` 后生成并应用新迁移（开发环境）
- `pnpm db:deploy`：只应用已有迁移（部署环境）
- `pnpm db:studio`：打开 Prisma Studio
- `pnpm --filter @fld/api test:e2e`：后端端到端测试（需要先 `pnpm infra:up`）。用单独的 `fld_asset_test` 库和 Redis 1 号库，每次运行重建，不影响开发数据
- `pnpm --filter @fld/api reset-password <用户名或邮箱>`：重置密码（先 `pnpm build`），新密码打印在终端，下次登录必须修改，该账号所有登录立即失效。镜像里用 `node dist/cli.js reset-password <用户名或邮箱>`
- `pnpm format`：用根目录的 Prettier 配置格式化全部代码
- `pnpm infra:down`：停止本地容器（数据保留在 Docker 卷里）

## 部署

推到 `main` 后，GitHub Actions 先跑格式、lint、类型检查、单元测试、端到端测试和构建，全部通过后才构建并推送两个镜像（amd64 + arm64）：

- `ghcr.io/lochinemak/fld-cms-api`：后端。启动时自动执行数据库迁移（`RUN_MIGRATIONS=false` 可关闭），以非 root 用户运行。
- `ghcr.io/lochinemak/fld-cms-web`：nginx 提供前端页面，并把 `/api` 转发给后端（`API_UPSTREAM`，默认 `http://api:3000`）。

镜像标签是 `latest` 和 `sha-<提交号>`；推送 `v1.2.3` 这样的 git tag 时，再加上 `1.2.3` 和 `1.2`。PR 只构建、不推送。

单机部署用 `deploy/` 下的示例：

```bash
cd deploy
cp .env.example .env     # 填上 POSTGRES_PASSWORD
docker compose up -d
docker compose logs api | grep 'Initial password'   # 首次启动时超级管理员的初始密码
```

然后访问 `http://服务器:8080`。注意：

- 镜像的可见性跟随仓库：仓库公开时，任何人都能直接拉取。仓库或镜像包改成私有后，先用有 `read:packages` 权限的 GitHub token 执行 `docker login ghcr.io`。
- 登录 Cookie 只在 HTTPS 下生效（localhost 例外）。正式环境在前面加 HTTPS 反向代理（Caddy、Nginx、云负载均衡等）；只在内网用 http 试用时，在 `.env` 里设 `SESSION_COOKIE_SECURE=false`。
- 登录限流按客户端 IP 计。后端只相信 web 容器里这一层 nginx 转发的 IP（`TRUST_PROXY=1`），客户端自己伪造的地址不会被采信。前面每多加一层反向代理，就在 `.env` 里把 `TRUST_PROXY` 加 1。
- 同一个账号连续输错 10 次密码就会被锁定，之后输对密码也登录不了，不会自动解开；登录成功一次，错误次数就清零。解锁：租户管理员在「成员管理」、超级管理员在「账号管理」里点「解锁」，或者本人用「忘记密码」重设；管理员重置密码和下面的命令也会顺带解锁。
- 重置密码：`docker compose exec api node dist/cli.js reset-password <用户名或邮箱>`。
- 时区：时间在数据库里按 UTC 存，页面按浏览器所在的时区显示。后端连接数据库时把会话时区固定为 UTC，所以数据库或 postgres 容器的时区（`TZ`、`timezone`）设成什么都不影响存取的时间。只有在 `DATABASE_URL` 里自己加了 `options` 参数时，它会盖掉这个设置，要一并写上 `-c TimeZone=UTC`。

### 文件存储

上传的文件默认存在 api 容器的 `/data/storage`，也就是 compose 里的 `file-storage` 卷。这种方式只支持跑一个 api 实例。

要放到 S3 兼容的对象存储（AWS S3、云厂商的对象存储、自建的 RustFS 等），在 `.env` 里设 `STORAGE_DRIVER=s3`，并填上 `S3_*` 各项（说明见 `.env.example`）：

- 自建的存储一般要设 `S3_FORCE_PATH_STYLE=true`。
- 用户的浏览器访问不到 `S3_ENDPOINT` 时，设 `S3_SIGNED_DOWNLOADS=false`，下载改由后端转发。

其他注意事项：

- 单个文件的上限由 `FILE_MAX_SIZE_MB` 决定，默认 100。web 容器里的 nginx 会自动放宽到这个值再加 1 MB。前面另加的 HTTPS 反向代理也要放行同样的大小，比如 nginx 的 `client_max_body_size`。
- 删除的文件在页面上立即消失、外链立即失效；存储里的内容保留 30 天后自动清除。
- 备份时，数据库和文件存储（`file-storage` 卷，或对象存储的桶）要在同一时间点一起备份，否则恢复后文件记录和文件对不上。

### 加密

- 传输：正式环境一定要走 HTTPS（见上面的反向代理）。
- 本地存储：把 Docker 卷所在的磁盘做成加密盘（云盘加密、LUKS 等）。
- 云厂商的对象存储：在桶上开启默认加密（SSE-S3 或 KMS），应用不用改。
- 自建的 RustFS：
  - 先给 RustFS 配上主密钥。可以用环境变量 `RUSTFS_SSE_S3_MASTER_KEY` 给出：32 字节，base64 编码，用 `openssl rand -base64 32` 生成。也可以接入 KMS（如 Vault）。
  - 再在控制台给桶开启默认加密，或者调用 S3 的 PutBucketEncryption。
  - 开启默认加密却没配主密钥时，所有上传都会失败。
  - 开启前已经存进去的文件不会被加密，所以要在存文件之前开好。
- 主密钥和数据分开保管，数据备份里不要带主密钥。主密钥丢了，加密的文件就再也读不出来。
- 备份文件本身也要加密存放。

### 邮件

「忘记密码」靠邮件发重设链接。超级管理员在「平台设置」页面里填 SMTP 服务器、发件人和站点地址，也可以写在 `.env` 的 `SMTP_*`、`MAIL_FROM_*`、`SITE_URL` 里（说明见 `.env.example`）。页面上填了的项优先，留空的项用环境变量。三项都有了，登录页的「忘记密码」才能用。

- 站点地址是用户在浏览器里打开系统的地址（比如 `https://crm.example.com`），邮件里的链接以它开头。
- 要在页面上保存 SMTP 密码，先在 `.env` 里设 `SETTINGS_ENCRYPTION_KEY`（用 `openssl rand -base64 32` 生成），密码加密后才存进数据库。这个密钥和数据库备份分开保管；换了或丢了，页面上存过的密码要重新填。不想配密钥，就把密码写在 `SMTP_PASSWORD` 里。
- 重设链接 30 分钟内有效，只能用一次，重新申请后旧链接作废；同一个账号每分钟最多发 1 封、每小时最多 5 封。重设后该账号所有登录立即失效。没有绑定邮箱的账号不能自己重设，只能请管理员重置。
- 本地开发用 Mailpit 收信：`docker compose --profile mail up -d`，在平台设置里填服务器 `localhost`、端口 `11025`、加密方式「不加密」，站点地址 `http://localhost:5173`。邮件不会真的发出去，都在 http://localhost:18025 里看。

### 审计日志

「系统管理 → 审计日志」记录谁在什么时候做了什么：登录（包括失败的尝试）、改密码和重设密码；成员、部门、角色、租户和平台设置的管理；删除和转交业务数据，以及文件的删除、恢复版本和分享。新建和普通编辑不记录。每条记录带操作人、IP、浏览器和改动前后的值；密码、密钥和分享链接不会写进去。

- 租户管理员看本租户的记录；超级管理员看平台的记录，以及用不存在的账号尝试登录的记录。一个账号在几个租户里，它的登录和改密码在这几个租户里都看得到。
- 记录只能查看，不能修改或删除。默认保留 365 天，过期的每天自动清除；用 `AUDIT_RETENTION_DAYS` 调整，最少 180 天。
- 记下的 IP 是否准确取决于 `TRUST_PROXY`：web 容器前面每多一层反向代理就加 1，否则记下的是代理的地址。

## 约定

- 主键使用雪花 ID（数据库 bigint），接口里以字符串传输，避免 JS 数字精度丢失。机器号启动时从 Redis 租用（也可用 `SNOWFLAKE_WORKER_ID` 固定）。
- 接口默认要求登录并拒绝访问：新接口要用 `@RequirePermission('权限码')` 声明所需权限（或 `@Public()` / `@Can.Anyone()`）。权限码统一在 `packages/shared/src/permissions.ts` 里按「目录 → 页面 → 元素」登记，前端用同一份码控制显示。
- 前端：登录后的页面放在 `apps/web/src/routes/_app/` 下，自动要求登录；按钮、列等页面元素用 `<Can code="权限码">` 或 `useCan('权限码')` 控制显示。请求统一走 `src/lib/api.ts` 的 `api()`：它带上当前租户，其他标签页切换了租户时会刷新页面。
- 租户内的数据用注入的 `TENANT_PRISMA` 客户端读写，它自动限定在当前租户；行级数据权限用 `dataScopeWhere(当前用户, { dept, owner })` 生成查询条件。
- 改了角色、成员、部门或租户状态后调用 `TenantContextCache.invalidate(租户 ID)`，让该租户所有人的权限缓存失效。
- 删除、转交和管理类的操作完成后用 `AuditService.record()` 写审计日志，操作先在 `packages/shared/src/audit.ts` 里登记。改动用 `changesOf()` 写成文字，不要放密码、密钥和链接。
- 表名、字段名用 snake_case，在 Prisma 模型里用 `@map` / `@@map` 映射。
- 本地开发只用根目录一份 `.env`；部署时由容器环境变量提供同名配置。

## 加一个新模块

可以照着客户模块（`crm`）写，按这个顺序改：

1. 数据格式：在 `packages/shared/src/` 里写接口输入输出的 zod schema，从 `index.ts` 导出。
2. 权限：在 `packages/shared/src/permissions.ts` 登记页面和按钮的权限码。内置的管理员角色自动拥有全部权限，其他角色在「角色管理」里勾选。
3. 数据库：在 `apps/api/prisma/schema.prisma` 里加模型，然后 `pnpm db:migrate`。属于租户的表带 `tenant_id`，并把模型名加进 `apps/api/src/authz/tenant-prisma.ts` 的 `TENANT_MODELS`。不加的话 `TENANT_PRISMA` 不会限定租户，会读写到别的租户的数据。
4. 后端：在 `apps/api/src/<模块>/` 里写 controller、service 和 module，再在 `app.module.ts` 里引入。每个接口用 `@RequirePermission()` 声明权限，删除、转交这类操作写审计日志。
5. 前端：请求函数放在 `apps/web/src/lib/<模块>.ts`；页面放在 `apps/web/src/routes/_app/` 下，内容用 `<RequirePermission code="页面权限码">` 包住；菜单加在 `apps/web/src/components/app-sidebar.tsx`，带上同一个权限码。
6. 测试：单元测试和代码放在一起（`*.spec.ts`）。接口的端到端测试放在 `apps/api/test/`（`*.e2e-spec.ts`），用 `createTestApp()` 启动应用、`seedTenant()` 建租户。
7. 提交前跑 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 和端到端测试，CI 会再跑一遍。
