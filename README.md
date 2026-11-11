# Admin Dashboard

后台管理系统的基座项目：多租户、RBAC（权限控制到页面元素 + 行级数据权限）、Logto 登录、文件管理、审计日志，另带一套基础的客户关系管理（客户、联系人、跟进记录、商机）。要加功能或页面，从这里开分支。

## 技术栈

- 后端：NestJS 12、Prisma 7（PostgreSQL）、Redis（ioredis）、zod
- 前端：Vite 8、React 19、TanStack Router / Query、shadcn/ui（Base UI）、Tailwind CSS 4
- 工程：pnpm workspace + Turborepo，Node 24

## 目录结构

```
apps/
  api/         NestJS 后端（接口前缀 /api，Swagger 在 /api/docs）
  web/         React 前端（开发时 /api 代理到 :3011）
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
pnpm dev               # 同时启动 shared（监听编译）、api（:3011）、web（:5173）
```

打开 http://localhost:5173 ，用超级管理员登录（见下一节），会进入「租户管理」。租户里的成员登录后，首页是工作台：显示当前租户、你在该租户的页面和按钮权限，后端、数据库和 Redis 的状态，以及你能看到的文件里最近上传或更新的 10 个（有「文件库」页面权限才有这张卡片）。每个人可以在「编辑工作台」里调整显示哪些卡片、顺序和大小，布局记在浏览器里。

## 首次登录

API 第一次连上空数据库时，会创建系统租户（ID 1，编码 `system`）和超级管理员 `superadmin`（可用 `SUPER_ADMIN_USERNAME` 改名）。初始密码随机生成，只在这次启动的日志里打印一次（`SystemBootstrapService` 的 WARN 行），首次登录后必须修改；忘了就用下面的 `reset-password` 命令重置。

账号全局唯一（用户名或邮箱都能登录），可以同时属于多个租户：登录后可以切换租户，下次登录默认进入上次使用的租户。

超级管理员只管平台，不进各租户的业务：在「租户管理」里新建、编辑和停用租户。新建时给租户指定管理员（选已有账号，或者新建账号），之后的部门、角色和成员由租户管理员自己管；管理员离开了，用「重设管理员」换一个。

租户用不到的功能模块（侧边栏的一个菜单组，比如「客户关系」「文件管理」）可以按租户关闭：在「租户管理」的新建和编辑对话框里取消勾选「功能模块」。关闭后，这个租户里的所有人（包括租户管理员）都看不到菜单、打不开页面、调不了接口，「角色管理」里也不再列出该模块的权限；数据和角色里已勾选的权限都保留，重新勾选就恢复。「系统管理」不能关闭。「文件管理」关闭期间，该租户的分享链接打不开，客户上已有的附件仍可查看和下载、但不能再添加。

## 常用命令

- `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test`：通过 Turborepo 在所有包上执行
- `pnpm db:migrate`：修改 `apps/api/prisma/schema.prisma` 后生成并应用新迁移（开发环境）
- `pnpm db:deploy`：只应用已有迁移（部署环境）
- `pnpm db:studio`：打开 Prisma Studio
- `pnpm --filter @fld/api test:e2e`：后端端到端测试（需要先 `pnpm infra:up`）。用单独的 `fld_asset_test` 库和 Redis 1 号库，每次运行重建，不影响开发数据
- `pnpm test:ui`：在真实浏览器里跑一遍冒烟流程（超级管理员首次登录、建租户、租户管理员登录、建客户、上传文件、查看登录设备），会先构建全部代码。需要先 `pnpm infra:up`，第一次还要 `pnpm --filter @fld/web exec playwright install chromium`。用单独的 `fld_asset_ui` 库和 Redis 2 号库，每次运行清空；后端和页面分别跑在 3021 和 4183 端口，不影响正在开发的服务。失败时的录屏和页面快照在 `apps/web/test-results/`，用 `pnpm --filter @fld/web exec playwright show-trace <trace.zip>` 查看
- `pnpm --filter @fld/api reset-mfa <用户名或邮箱>`：关闭账号的两步验证（先 `pnpm build`），之后只用密码就能登录。给手机和恢复码都丢了、又没有别的管理员能重置的人用，比如唯一的超级管理员。镜像里用 `node dist/cli.js reset-mfa <用户名或邮箱>`
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

### 日志和请求 ID

- 正式环境（`NODE_ENV=production`）的日志每行一个 JSON 对象，用 `docker compose logs api` 查看，也可以交给日志系统收集。
- 每个请求有一个请求 ID：web 容器里的 nginx 生成，后端沿用；直接访问后端时由后端生成。它写在响应头 `X-Request-Id` 里，这个请求期间的每行日志都带着它（`requestId`），登录后还带 `userId`、`tenantId`。每个请求结束时记一行访问日志（方法、路径、状态码、耗时），健康检查除外。
- 接口出了服务器错误（5xx）时，页面上的提示末尾带着请求 ID 的前 8 位，用户报告问题时提供它，就能在日志里找到这次请求：`docker compose logs api | grep <请求 ID>`。审计日志的详情里也有完整的请求 ID。

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

「忘记密码」的重设链接和修改邮箱的确认邮件都靠邮件发。超级管理员在「平台设置」页面里填 SMTP 服务器、发件人和站点地址，也可以写在 `.env` 的 `SMTP_*`、`MAIL_FROM_*`、`SITE_URL` 里（说明见 `.env.example`）。页面上填了的项优先，留空的项用环境变量。三项都有了，登录页的「忘记密码」才能用，用户也才能修改自己的邮箱（见下面的「个人资料」）。

- 站点地址是用户在浏览器里打开系统的地址（比如 `https://admin.example.com`），邮件里的链接以它开头。
- 要在页面上保存 SMTP 密码，先在 `.env` 里设 `SETTINGS_ENCRYPTION_KEY`（用 `openssl rand -base64 32` 生成），密码加密后才存进数据库。这个密钥和数据库备份分开保管；换了或丢了，页面上存过的密码要重新填。不想配密钥，就把密码写在 `SMTP_PASSWORD` 里。
- 重设链接 30 分钟内有效，只能用一次，重新申请后旧链接作废；同一个账号每分钟最多发 1 封、每小时最多 5 封。重设后该账号所有登录立即失效。没有绑定邮箱的账号不能自己重设，只能请管理员重置。
- 两种邮件（「重置密码」「修改邮箱确认」）的标题和正文都可以在「平台设置」页面里改，随时能恢复默认；正文里必须留着链接的占位符。标题和正文里都可以写 `{{系统名称}}`，发信时换成当时的系统名称。
- 本地开发用 Mailpit 收信：`docker compose --profile mail up -d`，在平台设置里填服务器 `localhost`、端口 `11025`、加密方式「不加密」，站点地址 `http://localhost:5173`。邮件不会真的发出去，都在 http://localhost:18025 里看。

### 个人资料

每个人都可以在右上角用户菜单的「个人资料」里改自己的姓名和邮箱；用户名不能改。

- 姓名保存后立即生效，不需要密码。
- 改邮箱要输入当前密码。保存后邮箱先不变，系统往新地址发一封确认邮件，打开邮件里的链接、点「确认修改邮箱」之后才生效（不用先登录）。所以要先配好上面的邮件服务，没配好时改不了邮箱。
- 确认链接 30 分钟内有效，只能用一次。再申请一次、清空了邮箱、或者改了密码（自己改、用邮件重设、管理员重置都算），之前没点的链接就作废。同一个账号每分钟最多发 1 封、每小时最多 5 封。
- 邮箱全系统唯一，别的账号已经在用的填不了；点确认之前被别的账号占了，确认会失败。
- 清空邮箱不用确认，输入当前密码就立即生效，也不要求配好邮件服务；清空后这个账号就不能用「忘记密码」了。
- 改邮箱时当前密码输错 5 次，要等 15 分钟才能再试；这期间改姓名不受影响。
- 邮箱改了之后，发到旧邮箱的重设密码链接作废；已经和 Logto 账号建立的对应关系不变。
- 管理员新建账号时填的邮箱不需要确认。
- 每次申请和每次修改都记在审计日志里（「申请修改邮箱」「修改个人资料」），带改动前后的值；没成功的也记，并写明原因（密码不对或输错太多次、邮箱已被占用、申请太频繁、邮件没发出去、链接失效）。

### 登录设备

右上角用户菜单的「登录设备」列出这个账号正在登录的浏览器和设备：浏览器和系统、IP、登录时间和最近活动时间，用 Logto 登录的另有标记。

- 可以退出其中任何一个（当前设备用「退出登录」），或者一次退出其他所有设备。看到不认识的设备，退出它并修改密码。
- 超级管理员在「账号管理」里可以让一个账号「退出全部登录」，密码不变。怀疑账号被别人登录时，先这样做，再重置密码。
- 这些操作都记在审计日志里（「退出其他设备的登录」「退出账号的全部登录」）。

### 两步验证

每个人都可以在右上角用户菜单的「两步验证」里开启：登录时除了密码，还要输入手机上验证器应用（Google Authenticator、Microsoft Authenticator 等）里的 6 位验证码。

- 要先在 `.env` 里设 `SETTINGS_ENCRYPTION_KEY`（见上面的「邮件」），验证器的密钥加密后才存进数据库；没设时页面上会说明，开不了。这个密钥换了或丢了，开了两步验证的人都登录不了，要管理员逐个重置。
- 开启要输入当前密码，再扫二维码、输入一次验证码。开启后显示 10 个恢复码，只显示这一次：手机不在身边时，每个恢复码可以代替验证码登录一次。用完或丢了可以重新生成，旧的随即作废。
- 用密码登录和用 Logto 登录都要过这一步。同一个验证码只能用一次；连续输错 5 次，15 分钟内什么码都不认。
- 重新生成恢复码和关闭两步验证，只能在登录时过了两步验证的设备上做（关闭还要输入当前密码）。
- 手机和恢复码都丢了：租户管理员在「成员管理」、超级管理员在「账号管理」里点「重置两步验证」，关闭后本人只用密码登录，再自己重新开启。连超级管理员也进不来时，用 `reset-mfa` 命令（见「常用命令」）。
- 开启、关闭、重新生成恢复码、管理员重置，以及两步验证输错，都记在审计日志里。

### 数据字典和自定义字段

租户管理员不改代码，就能给业务数据加字段、改下拉选项：

- 「系统管理 → 数据字典」：维护下拉选项的列表。内置的字典（现在有「客户来源」）每个租户第一次用到时自动建好，可以改名称、排序、新增和停用选项，但不能删除。自己新建的字典给自定义字段用，没有字段在用时才能删。选项都不能删除，只能停用：停用后不再出现在下拉里，已经选了它的记录照常显示。
- 「系统管理 → 自定义字段」：给「客户」「联系人」加字段，类型有单行文字、多行文字、数字、日期、是/否（表单里是一个开关，不打开就是「否」）、单选和多选；只有单选和多选的选项来自数据字典，其他类型直接填写。新增字段默认是单行文字，可以设必填、在列表中显示和排序。字段的标识和类型创建后不能改。删除字段时已经填的值留在记录里，再加同样标识的字段就重新显示。
- 新建记录时必填字段要填；字段是后来加上或改成必填的，旧记录在填它之前不受影响。所在模块对租户关闭时，它的字段也不能查看和修改。
- 改动记在审计日志里（「新建/编辑/删除数据字典」「新建/编辑/删除自定义字段」）。

在代码里：

- 定义在 `packages/shared/src/custom-fields.ts`：`BUILTIN_DICTIONARIES` 是内置字典和它们的默认选项，`CUSTOM_FIELD_ENTITIES` 是能加字段的模型。值的检查（`customValueError()`）前后端共用。
- 字段的值存在业务表的 `custom` 列（JSONB）里，按字段标识存：`{"region": "east", "budget": 5000}`。
- 让一个模型支持自定义字段：在 Prisma 模型上加 `custom Json @default("{}")` 并迁移；在 `CUSTOM_FIELD_ENTITIES` 登记，写上看这个模型的页面权限；service 新建和修改时用 `CustomFieldsService.values()` 检查并合并值，读出时用 `customOf()`；前端表单用 `<CustomFieldInputs>`，详情用 `<CustomFieldList>`，列表用 `formatCustomValue()`。可以照着联系人（`contacts.service.ts`、`contact-form-dialog.tsx`）写。
- 内置字典的选项用 `DictionariesService.assertValue()` 检查（见 `customers.service.ts` 的来源），前端用 `builtinItemsQuery(编码)` 取。
- 现在还不能按自定义字段筛选和排序列表。

### 通知

右上角的铃铛显示自己在当前租户的通知，未读的有数字，每分钟刷新一次。点一条通知会标为已读并打开相关页面，也可以「全部标为已读」。现在会通知的事：导出、导入完成或失败，以及别人把客户或商机转给了你。通知保留 90 天，过期的每天自动清除。

代码里任何地方都可以发通知：`NotificationsService.notify({ tenantId, userId, kind, title, body, link })`，`link` 是前端页面的路径。

### 导入导出

客户可以导出和导入，联系人可以导出。权限是「导出客户」「导入客户」「导出联系人」，在「角色管理」里勾选（内置管理员自动拥有）。

- 导出：在客户或联系人列表点「导出」，按列表当前的筛选条件导出成 Excel，只包含自己数据范围内的记录，选项和自定义字段都写成文字。导出在后台进行，完成后右上角会有通知，到「导入导出」页面（右上角用户菜单里）下载。一次最多 10 万行。
- 导入：在客户列表点「导入」，先下载模板，填好后上传 .xlsx 文件。模板按当前的自定义字段生成，「填写说明」工作表写了每列怎么填；级别、状态、来源和单选、多选字段填选项的名称，多选用顿号隔开，是/否填“是”或“否”；空着的单元格导入后字段为空（必填字段不能空着）。导入的客户由自己负责。一次最多 5000 行；只要有一行不对，整个文件都不会导入，在「导入导出」页面列出有问题的行和原因，改好后重新上传。
- 导出的文件和导入记录保留 7 天，过期的每天自动清除。导出和导入记在审计日志里（「导出数据」「导入数据」）。

在代码里：`packages/shared/src/spreadsheet.ts` 的 `SPREADSHEET_ENTITIES` 登记能导入导出的模型和对应权限；模块启动时向 `SpreadsheetRegistry` 注册 exporter（列和一批批的行）和 importer（列、整体检查后一次写入），可以照着 `apps/api/src/crm/crm-spreadsheets.ts` 写。导出和导入在后台任务里以发起人的身份运行（`RunAsService`），用的是那时的权限和数据范围。

### 后台任务

定时和耗时的任务用 BullMQ 跑在 API 自己的进程里，任务存在 Redis 里（键以 `fld:jobs` 开头），不用另外部署。开几个 API 实例都行：定时任务每次只在其中一个上跑，失败会自动重试 3 次。

- 现有的：导出和导入；每小时清除删除满 30 天的文件；每天清除过期的审计日志、通知和导入导出记录。
- 加一个：在模块里 `BullModule.registerQueue({ name })` 注册队列，写一个 `@Processor(队列名)` 的类处理任务；定时的在它的 `onApplicationBootstrap()` 里用 `scheduleEvery()` 排上（测试环境不排，测试里自己加任务）。可以照着 `apps/api/src/files/files.processor.ts` 写。

### Logto 登录

登录页可以多一个「使用 Logto 登录」按钮，让用户用 [Logto](https://logto.io) 的账号登录；用户名和密码照常能用。

1. 在 Logto 控制台新建应用，类型选「传统网页应用」（Traditional web，框架选 Express 之类的也是这一类）。只有这一类应用有 App secret，类型建好后不能改。
2. 在应用的 Redirect URIs 里填回调地址：站点地址加 `/api/auth/oidc/logto/callback`，比如 `https://admin.example.com/api/auth/oidc/logto/callback`，本地开发是 `http://localhost:5173/api/auth/oidc/logto/callback`。「平台设置」页面上会给出这个地址。
3. 超级管理员在「平台设置 → Logto 登录」里填 Logto 地址（比如 `https://auth.example.com`）、应用 ID 和应用密钥，也可以写在 `.env` 的 `LOGTO_AUTH_URL`、`LOGTO_APP_ID`、`LOGTO_APP_SECRET` 里（改了 `.env` 要重启 API）。页面上填了的项优先，留空的项用环境变量。这三项加上站点地址都有了，登录页才出现按钮；在页面上取消勾选可以随时关掉。

- 不会自动建账号。第一次用 Logto 登录时，按 Logto 里已验证的邮箱找本系统的账号（不区分大小写），找到就记下两边的对应关系，之后只认 Logto 账号，哪边的邮箱改了都不影响。所以要先在本系统里建好账号并填上邮箱；已有的账号没填邮箱、或者填的不是 Logto 里的那个，本人可以在「个人资料」里改（见上面）。
- 下面几种情况会拒绝登录，回到登录页并提示联系管理员：本系统里没有这个邮箱的账号；Logto 里没有已验证的邮箱；这个账号已经对应了另一个 Logto 账号；账号已停用或已锁定。
- 用 Logto 登录的人不会被要求修改初始密码；用密码登录时照旧要先改。
- 在本系统里退出登录只退出本系统，不退出 Logto。
- 换成另一个 Logto（地址变了）之后，原来的对应关系不再生效，用户下次登录时重新按邮箱对应；换回原来的地址，原来的对应关系照旧有效。
- Logto 地址要用 `https://`，只有本机地址（`localhost`）可以用 `http://`。要在页面上保存应用密钥，同样要先设 `SETTINGS_ENCRYPTION_KEY`（见上面的「邮件」）；不想配密钥，就把应用密钥写在 `LOGTO_APP_SECRET` 里。
- 用 Logto 登录，成功和被拒绝的都记在审计日志里（「通过 Logto 登录」）。

### 审计日志

「系统管理 → 审计日志」记录谁在什么时候做了什么：登录（包括失败的尝试）、改密码和重设密码、修改个人资料；成员、部门、角色、租户和平台设置的管理；删除和转交业务数据，以及文件的删除、恢复版本和分享。新建和普通编辑不记录。每条记录带操作人、IP、浏览器和改动前后的值；密码、密钥和分享链接不会写进去。

- 租户管理员看本租户的记录；超级管理员看平台的记录，以及用不存在的账号尝试登录的记录。一个账号在几个租户里，它的登录、改密码和修改个人资料在这几个租户里都看得到。
- 记录只能查看，不能修改或删除。默认保留 365 天，过期的每天自动清除；用 `AUDIT_RETENTION_DAYS` 调整，最少 180 天。
- 记下的 IP 是否准确取决于 `TRUST_PROXY`：web 容器前面每多一层反向代理就加 1，否则记下的是代理的地址。

## 约定

- 主键使用雪花 ID（数据库 bigint），接口里以字符串传输，避免 JS 数字精度丢失。机器号启动时从 Redis 租用（也可用 `SNOWFLAKE_WORKER_ID` 固定）。
- 接口默认要求登录并拒绝访问：新接口要用 `@RequirePermission('权限码')` 声明所需权限（或 `@Public()` / `@Can.Anyone()`）。权限码统一在 `packages/shared/src/permissions.ts` 里按「目录 → 页面 → 元素」登记，前端用同一份码控制显示。
- 前端：登录后的页面放在 `apps/web/src/routes/_app/` 下，自动要求登录；按钮、列等页面元素用 `<Can code="权限码">` 或 `useCan('权限码')` 控制显示。请求统一走 `src/lib/api.ts` 的 `api()`：它带上当前租户，其他标签页切换了租户时会刷新页面。
- 租户内的数据用注入的 `TENANT_PRISMA` 客户端读写，它自动限定在当前租户；行级数据权限用 `dataScopeWhere(当前用户, { dept, owner })` 生成查询条件。
- 改了角色、成员、部门、租户状态或租户的功能模块后调用 `TenantContextCache.invalidate(租户 ID)`，让该租户所有人的权限缓存失效。
- 功能模块按租户开关：`permissions.ts` 里每个顶层目录就是一个模块，没标 `core: true` 的都能在「租户管理」里按租户关闭。已关闭的模块码存在 `tenants.disabled_modules`（默认空，所以新加的模块对所有租户默认开启）。`grantablePermissions(租户)` 会去掉已关闭模块下的权限码，菜单、页面、按钮、角色编辑和接口都跟着权限走，不用逐处判断；不按权限判断的地方（公开接口、跨模块的读写，比如分享链接、给客户添加附件、文件的「使用位置」）要自己看当前租户的 `disabledModules`。角色里属于已关闭模块的权限不删除：编辑角色时原样保留，分配角色时用 `assertWithinDormantGrant()` 检查，免得模块重新打开后有人拿到分配人自己没有的权限。
- 删除、转交和管理类的操作完成后用 `AuditService.record()` 写审计日志，操作先在 `packages/shared/src/audit.ts` 里登记。改动用 `changesOf()` 写成文字，不要放密码、密钥和链接。
- 表名、字段名用 snake_case，在 Prisma 模型里用 `@map` / `@@map` 映射。
- 本地开发只用根目录一份 `.env`；部署时由容器环境变量提供同名配置。
- 系统的名字由超级管理员在「平台设置」页面的「系统名称」里填，浏览器标签页、登录页、侧边栏和邮件都跟着变（接口文档的标题在 API 启动时取一次，改名后重启才变）；没填就用 `packages/shared/src/app.ts` 里的 `DEFAULT_APP_NAME`。基于本项目的分支要换默认名字，改这一行；README 和 `.env.example` 里的文字要另外改。
- 登录前就要显示的站点信息（现在只有系统名称）走公开接口 `GET /api/site`，结构在 `packages/shared/src/app.ts` 的 `siteSchema` 里；它不用登录，所以只放可以公开的内容。请求可以带 `?tenant=租户ID`，现在各租户拿到的都一样，以后租户有自己的显示内容时按它返回。

## 多语言

前端用 i18next（react-i18next）。现在只有简体中文，界面的公共部分（侧边栏、顶栏和用户菜单、通知、登录和账号相关的页面和对话框、通用的对话框和分页）已经改成用翻译键，业务页面还是直接写的中文，用到时再逐步改。

- 文案在 `apps/web/src/i18n/locales/zh-CN.ts`，按命名空间分组：`common` 是哪里都用的词（取消、保存、加载中…），`layout`、`auth`、`account` 按页面分。组件里 `const { t } = useTranslation('layout')`，再 `t('profile')`；不在组件里的代码用 `i18n.t()`（`import i18n from '@/i18n'`）。动态的部分用插值：`t('total', { count })` 对应 `'共 {{count}} 条'`，整句放在一个键里，方便别的语言调整语序。
- 键有类型检查：写错键名或漏加文案，`pnpm typecheck` 就报错。
- 菜单名用权限码的名称（`packages/shared/src/permissions.ts`），经 `permissionName()` 取当前语言的；中文不用另外写，别的语言在 `LANGUAGES` 里给 `permissions` 补上。
- 日期和数字按当前语言格式化（`currentLocale()`）。
- 加一种语言：在 `apps/web/src/i18n/locales/` 加一个文件，类型标成 `Translation`（键必须和中文的一一对应，少一个类型检查就不通过），再登记到 `apps/web/src/i18n/index.ts` 的 `LANGUAGES`。有两种以上语言时，用户菜单里自动出现「语言」，选择记在浏览器里；没选过时按浏览器的语言选。
- 后端的提示（接口返回的错误信息、邮件模板、权限和审计操作的名称）现在都是中文。前端请求时会带上 `Accept-Language`，以后后端要按语言返回时可以读它。

## 加一个新模块

可以照着客户模块（`crm`）写，按这个顺序改：

1. 数据格式：在 `packages/shared/src/` 里写接口输入输出的 zod schema，从 `index.ts` 导出。
2. 权限：在 `packages/shared/src/permissions.ts` 登记页面和按钮的权限码。内置的管理员角色自动拥有全部权限，其他角色在「角色管理」里勾选。新登记的顶层目录会自动出现在「租户管理」的「功能模块」里，对所有租户默认开启；任何租户都不能缺的目录标上 `core: true`。
3. 数据库：在 `apps/api/prisma/schema.prisma` 里加模型，然后 `pnpm db:migrate`。属于租户的表带 `tenant_id`，并把模型名加进 `apps/api/src/authz/tenant-prisma.ts` 的 `TENANT_MODELS`。不加的话 `TENANT_PRISMA` 不会限定租户，会读写到别的租户的数据。
4. 后端：在 `apps/api/src/<模块>/` 里写 controller、service 和 module，再在 `app.module.ts` 里引入。每个接口用 `@RequirePermission()` 声明权限，删除、转交这类操作写审计日志。
5. 前端：请求函数放在 `apps/web/src/lib/<模块>.ts`；页面放在 `apps/web/src/routes/_app/` 下，内容用 `<RequirePermission code="页面权限码">` 包住；菜单加在 `apps/web/src/components/app-sidebar.tsx`，带上同一个权限码。
6. 测试：单元测试和代码放在一起（`*.spec.ts`）。接口的端到端测试放在 `apps/api/test/`（`*.e2e-spec.ts`），用 `createTestApp()` 启动应用、`seedTenant()` 建租户。
7. 提交前跑 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 和端到端测试，CI 会再跑一遍。
