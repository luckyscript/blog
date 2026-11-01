# 下雨就像弹钢琴 · 内容后台

Astro 前台与 React 管理后台运行在同一个 Node 服务中。文章正式版本、编辑草稿、分类标签、历史版本、登录会话和媒体索引存入 MySQL；图片与附件继续使用 GitHub 公开图床。碎碎念通过独立同步服务写入 MySQL，前台请求不再访问 Telegram。

## 碎碎念同步

首页、`/moments`、分页、搜索、详情和 `/api/moments.json` 均读取 MySQL。原 `/moments/posts/数字ID` 继续查找默认 Telegram 频道，新链接使用站内 UUID，为多个平台提供独立、无冲突的地址。

三张表分别保存来源、内容和同步执行记录：`blog_moment_sources`、`blog_moments`、`blog_moment_sync_runs`。平台类型预留 `telegram / x / weibo`，内容按“来源 + 平台原始 ID”去重，保留发布时间、原文链接、文本、安全过滤后的 HTML、标签和媒体引用。不同账号或平台的相同 ID 不互相覆盖。重新同步会更新内容，不会把 `trash` 状态恢复为发布；抓取失败或源站缺少某条记录时不删除已有数据。

```sh
npm run db:setup
# 最近内容 + 逐次补抓历史，每次最多 5 页
npm run moments:sync
# 首次补抓：每次最多 100 页，未完成时再次执行会继续
npm run moments:sync -- --backfill
# 常驻服务，默认每 300 秒执行一次
npm run moments:service
npm run moments:health
```

同步使用当前公开 Telegram 频道的网页预览，不需要账号密码或 Bot Token。抓取有超时和响应大小限制，断点保存在数据库；落后多页时继续补齐缺口，避免只检查最近一页而漏掉内容。最近页会重新检查编辑；已补抓的旧历史不会每次全量重扫。网页改版、私密频道、删除及未在预览中提供的内容不保证可获取。媒体只保存原始引用，不代表图片或视频已永久归档；原链接可能过期，图片仓库与媒体归档应单独处理。

`MOMENTS_TELEGRAM_CHANNEL` 默认 `jsjhlkblog`，兼容旧 `CHANNEL` 配置。大陆 ECS 无法直连 Telegram 时，在独立的同步配置中填写服务器可达的 `MOMENTS_HTTP_PROXY`（HTTP/HTTPS），或自己维护的 HTTPS 预览中转 `MOMENTS_TELEGRAM_ORIGIN`。代理凭据不放入网站构建产物或浏览器。没有可用访问通道时，服务会记录失败并每轮重试，页面继续展示已有内容；“进程运行”不等于“同步成功”。后台设置页可查看保存条数、最近尝试/成功时间、历史补抓和错误状态。

ECS 使用 `deploy/rain-blog-moments.service`，独立用户 `rain-blog-moments` 和 `/etc/rain-blog/moments.env`。该文件只配置数据库、频道、同步间隔和必要的访问通道，不复制后台登录、Cloudflare 或 GitHub 凭据。通用数据库备份会自动包含这三张新表。

### 微博两个账号

默认接入 `5351049607`（luckyscript）和 `1562002727`（jsjhlk）。通过微博官方 CLI 服务的 `statuses/user_timeline/biz` 读取各自授权账号，使用官方命令元数据校验参数；没有授权、权限不足、长文不完整或返回异常时明确失败，已有内容保留。X / Twitter 仍待接入。

```sh
# 本地历史文件：先校验，再导入；重复执行只补充新记录。
npm run moments:import-weibo -- --dry-run
npm run moments:import-weibo
# 两个账号分别运行，按提示在微博官方页面完成设备授权。
npm run moments:auth-weibo -- 5351049607
npm run moments:auth-weibo -- 1562002727
```

需要先在 [微博开放平台](https://open.weibo.com/cli/quickstart) 完成开发者认证和服务开通。授权脚本会读取一次 `users/show/biz` 核对 UID，再将访问/刷新令牌写入私有目录，自动续期时保存轮换后的刷新令牌。不要将令牌发送到聊天、提交 Git 或放入前台环境；不要求微博密码或 Cookie。不同账号的授权不可混用。官方服务可能计费，程序不会购买套餐。默认每账号每小时检查一次，每轮最多 2 页（每页 50 条）；手动 `--backfill` 也遵守此限制。元数据请求和授权时的身份核对另计，以平台实际权限及计费为准。

ECS 的 `moments.env` 增加 `MOMENTS_WEIBO_CREDENTIAL_DIRECTORY=/var/lib/rain-blog-moments/weibo`，凭据归独立同步用户所有。以该用户执行授权：

```sh
cd /opt/rain-blog/current
sudo -u rain-blog-moments /opt/rain-blog/runtime/bin/node --env-file=/etc/rain-blog/moments.env --import tsx scripts/weibo-auth.ts 5351049607
# 第二个账号同样执行，最后一个参数改为 1562002727。
```

本地 451 条带明确微博来源页脚的历史记录可导入到“微博历史存档”；其余普通卡片不混入。存档缺少作者 UID，保留来源未知的状态。后续官方数据确认作者时，按全局微博 ID 认领原记录，保留站内链接和软删除状态，避免历史导入和自动抓取重复。微博短链的 base62 ID 转为无精度损失的十进制字符串，避免大小写被 MySQL 默认排序规则混淆。只保存公开内容及媒体引用，微博图片存在防盗链或源链接失效风险，尚未复制到 GitHub 图床。官方接口可读取的历史范围取决于账号权限，不保证能回溯所有年份。

## 本地启动

需要 Node.js 22。本机 MySQL 方案另外需要可运行的 Docker（例如 OrbStack）；连接阿里云 RDS 等已有 MySQL 时，应用和备份均可直接运行。

```sh
npm ci
cp env.example .env
# 编辑 .env，设置数据库密码和初始管理员账号，DATABASE_URL 密码应与 MYSQL_PASSWORD 一致
docker compose up -d mysql
npm run db:setup
npm run db:import -- --dry-run
npm run db:import
npm run dev -- --host 127.0.0.1
```

前台：`http://127.0.0.1:3000/`；后台：`http://127.0.0.1:3000/admin`。

本次本地实现已经生成忽略提交的 `.env`，并创建了初始管理员。邮箱见 `ADMIN_EMAIL`，密码见 `ADMIN_PASSWORD`。`db:setup` 再次执行会跳过已有管理员，不会重设密码。登录后可在设置页修改密码；修改会注销全部会话。

### Cloudflare 登录验证

后台登录必须通过 Cloudflare Turnstile。请在 Cloudflare 控制台创建 **Managed** 类型的 Turnstile 站点，加入实际后台域名，并在 `.env` 配置：

```dotenv
TURNSTILE_SITE_KEY=站点的公开SiteKey
TURNSTILE_SECRET_KEY=仅服务端使用的SecretKey
TURNSTILE_HOSTNAMES=rainonpiano.com,www.rainonpiano.com
```

`TURNSTILE_HOSTNAMES` 是精确域名白名单，不含协议、路径或端口；留空时使用 `SITE_URL` 的主机名。修改后重启 Node 服务。密钥未配置、配置不完整或当前域名不匹配时，页面禁用登录，接口返回 503。

页面完成验证后，将令牌与邮箱密码一起提交；服务端先请求 Cloudflare Siteverify，确认成功、当前域名与 `admin-login` 用途匹配，再校验密码、限流并创建登录会话。Secret Key 只在服务端读取。绕过页面直接请求登录接口仍须通过验证；网络异常、验证失败、令牌过期或重复使用均会拒绝登录。每次登录失败后页面重新获取令牌。

本地开发可显式使用 Cloudflare 官方公开测试密钥：

```dotenv
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

测试密钥仅在非生产模式、通过 `localhost`、`127.0.0.1` 或 IPv6 回环地址访问时可用，页面会标注测试模式，并仍向 Cloudflare 校验。生产构建与公开域名拒绝测试密钥。不会因为未配置正式密钥而自动关闭验证。实现参考 [Cloudflare 服务端校验文档](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) 与 [官方测试密钥说明](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)。

### 使用已有云数据库

在 `.env` 中设置 `CONTENT_SOURCE=mysql` 和 `DATABASE_URL=mysql://用户名:URL编码后的密码@数据库地址:3306/blog`，然后执行 `db:setup`。密码中的 `@` 等特殊字符需要 URL 编码。数据库连接账号与后台管理员账号分别配置。

当前工作区已切换到用户提供的 RDS，并完整迁移本地数据库。原本机配置保存在忽略提交的 `.local/env.before-rds.env`；迁移前 SQL 快照和迁移后 RDS 备份都在 `.local/backups/`。敏感连接信息只保存在忽略提交的 `.env`，文件权限为 600。

## 数据与发布

- `CONTENT_SOURCE=mysql`：前台通过数据库读取已发布文章。连接失败返回错误，避免把旧文件内容误当成线上正式版本。
- `CONTENT_SOURCE=markdown`：用于核对迁移前的原始页面。后台内容仍写入 MySQL，此模式下发布不会改变文件前台。
- 导入支持 `blog / tech / sight / link / ppt / projects / life / card`。排除模板、提示词、Obsidian 配置和回收站目录。完整预检通过后才开始写入；已导入来源跳过，数据库中的后续编辑不会被导入覆盖。
- 旧版 `content/link/link.md` 的 `draft` 用于隐藏列表入口，正文原本公开嵌入 `/link`。迁移将它识别为页面正文，保持公开展示并隐藏列表入口；其他草稿继续保持私有。后续在后台撤回该正文时，链接列表页仍能正常打开。
- 文章固定路径与发布时间独立保存。年份 `0000` 和原有大小写路径会保留。修改路径时，旧地址通过 301 跳转到新地址。
- 保存与自动保存只写草稿。发布以事务更新正式文章、分类标签和版本记录；恢复历史版本也先写入草稿。
- 第一版支持立即发布、撤回和可恢复的回收站。未来日期会提示调整，定时发布未启用。
- 文章删除仅使用软删除：将 `blog_posts.status` 更新为 `trash`，保留原记录、正文、编辑草稿、历史版本、分类标签和旧路径。前台、RSS、Sitemap 不再展示；恢复后回到草稿，需要手动发布。后台不提供永久删除或清空回收站，重复删除已在回收站的文章不会重复生成删除记录。
- 删除接口 `DELETE /api/admin/posts/:id` 接收 JSON `{ "version": 当前版本号 }`，与 `POST /api/admin/posts/:id/trash` 共用软删除逻辑，均需登录和同源校验；过期版本返回 409。
- 文章编辑包含版本号校验。同一篇文章在多个窗口编辑时，过期窗口会收到冲突提示；浏览器保留未保存内容，重新打开时可恢复。
- 首页、详情、列表、分类、RSS、Sitemap 均在请求时读取数据库。Sitemap 为 `/sitemap.xml`，只包含已发布内容。后台和预览设置 `noindex`、`private, no-store`。
- 历史 Markdown 保留在仓库，切换后以数据库为内容依据；后台可以导出单篇 Markdown 和全部正式内容/草稿 JSON。

## GitHub 图床

在 `.env` 中配置并重启服务：

```dotenv
GITHUB_MEDIA_REPO=luckyscript/image
GITHUB_MEDIA_BRANCH=master
GITHUB_MEDIA_PREFIX=uploads
GITHUB_MEDIA_TOKEN=填写仅有图片仓库权限的服务端令牌
```

使用 GitHub fine-grained token，指定图片仓库并授予 Contents: Read and write。仓库需要公开，文件通过 `raw.githubusercontent.com` 访问。令牌只由服务端读取，不下发浏览器。

后台 JPEG / PNG / WebP 照片会在浏览器生成最长边不超过 2560px 的 WebP 展示图，重新编码移除原始 EXIF；GIF 保留动画，PDF 保持原文件。单份上传文件最多 8 MB。图床用于公开展示素材，原始照片请继续自行留存。路径按月份和 SHA-256 生成，相同文件去重；GitHub 成功但数据库回写中断时，重试会核对仓库文件 SHA，避免重复上传。异常中断的 pending 记录可在两分钟后重新上传。

现有 Markdown 图片地址会建立媒体索引，原地址保持原样。历史源内容中已有部分 `/public/upload/...` 图片路径不对应本地现存文件，媒体导入保留引用，未擅自改写或删除。GitHub 上传令牌未填写时，可查看、编辑说明、插入已有图片；新上传会显示配置提示。

## 数据库迁移与备份

表结构在 `src/db/schema.ts`，SQL 迁移在 `db/migrations/`。`db:setup` 按顺序应用迁移并保存校验和；已应用的文件不能修改，结构调整请添加新迁移。MySQL DDL 使用幂等建表，支持中断后继续执行。

对 `DATABASE_URL` 指向的本机或远程 MySQL 均可执行：

```sh
npm run db:backup
# 恢复验证需要本项目 Docker MySQL；在源内容未变动时执行，完成后删除临时数据库
npm run db:verify-backup -- .local/backups/你的备份文件.sql
```

备份通过当前数据库的只读一致性快照导出建表语句与数据，保存为 `.local/backups/*.sql`，并附带逐表记录数与 SHA-256 清单。包含账号、文章、草稿、历史版本、分类标签、媒体索引及迁移记录；备份文件权限为 600，不提交到 Git。备份连接凭据由 Node 进程读取，不传入子进程命令行。正式使用请定期将备份复制到另一块磁盘或备份服务。GitHub 图片仓库应独立备份。

恢复时使用空数据库，避免覆盖已有数据。托管 MySQL 也可以配合实例自带的备份和恢复工具。

### 独立定时备份服务

备份服务与博客 Web 进程分别运行，直接连接 `BACKUP_DATABASE_URL`，未设置时使用 `DATABASE_URL`。默认每天北京时间 **03:00** 执行；首次启动或错过当日备份时立即补备，服务重启后继续根据磁盘上的成功清单判断。服务对数据库执行只读一致性快照，覆盖全部业务表，包括回收站中的文章、编辑草稿和历史版本。

默认保存到 `.local/backups/service/<数据库标识>/blog-backup-<时间>-<随机值>/`，每份包括 `database.sql.gz` 与 `manifest.json`。清单记录源库、逐表行数与内容指纹、SQL 原文及压缩文件的 SHA-256。压缩后会实际解压校验，目录通过原子重命名发布；目录权限 700、文件权限 600。服务按数据库隔离目录，历史手工生成的 `.sql` 文件不参与自动清理。

```sh
# 本机直接运行常驻进程
npm run db:backup:service

# 独立执行一次压缩备份（与常驻服务共用并发锁）
npm run db:backup:once

# 查询常驻服务健康状况；异常时退出码为 1
npm run db:backup:health

# 校验指定备份目录的 gzip、文件大小与 SHA-256
npm run db:backup:check -- .local/backups/service/数据库标识/备份目录
```

定时任务单次失败后在 1 分钟、5 分钟后重试，共 3 次；全部失败后每 15 分钟再尝试一轮。任务默认 15 分钟超时，可通过 `BACKUP_TIMEOUT_SECONDS` 调整。目录锁防止多个进程同时运行，异常退出留下的锁可在 2 分钟后回收。进程每 30 秒写入心跳，状态文件 `status.json` 包含最近成功时间、下次执行时间、当前状态及脱敏错误；停止、无心跳超过 90 秒、最近成功备份超过 26 小时或重试失败都会令健康检查失败。

`BACKUP_RETENTION_DAYS=30` 控制本地保留天数。只有本次备份在全部已配置目标成功后才清理过期副本；新备份失败时保留旧副本。最新成功副本始终保留。修改 `BACKUP_TIME=03:00` 可调整每日时间，时区固定为 `Asia/Shanghai`，与服务器自身时区无关。

### Docker 部署备份服务

仓库提供独立的 `Dockerfile.backup` 和 `compose.backup.yaml`，可在能连接 RDS 的服务器上运行，不依赖博客 Web 服务或本机 MySQL 容器。

```sh
# 先在服务器 .env 配置数据库与可选 OSS 参数
docker compose -f compose.backup.yaml up -d --build backup
docker compose -f compose.backup.yaml ps
docker compose -f compose.backup.yaml logs --tail=100 backup

# 复制备份到宿主机；容器内路径也可用 health 命令对应的数据库标识定位
docker compose -f compose.backup.yaml cp backup:/var/lib/blog-backups ./downloaded-backups
```

容器以普通用户运行，备份位于持久化命名卷 `blog_backups`，配置了进程退出自动重启与健康检查。`BACKUP_DIRECTORY` 在此部署中固定为 `/var/lib/blog-backups`。容器中的数据库地址须从容器网络可达；备份项目自带的本机 MySQL 时，应使用容器网络中的 MySQL 地址。正常停止容器会保留备份卷。Docker 的健康检查会暴露备份失败状态，生产监控可据此告警。

### 可选 OSS 第二份备份

填写 `.env` 中的 `BACKUP_OSS_BUCKET`、`BACKUP_OSS_REGION`、`BACKUP_OSS_ACCESS_KEY_ID`、`BACKUP_OSS_ACCESS_KEY_SECRET` 后重启服务。Region 示例为 `oss-cn-hangzhou`；可设置 `BACKUP_OSS_STS_TOKEN`。四项配置必须完整，配置不全会明确报错。

服务要求私有 Bucket，通过 HTTPS 上传，显式设置对象私有 ACL 和 AES256 服务端加密。对象路径为 `BACKUP_OSS_PREFIX/<数据库标识>/<备份标识>/`。先上传压缩 SQL 并核对远端大小、SHA-256 元数据和加密状态，再上传完成清单。OSS 失败时保留本地副本并复用它重试，重启后优先补传最新的待上传副本。

OSS 账号需要目标 Bucket 的 `oss:GetBucketAcl`，以及备份前缀内的 `oss:PutObject`、`oss:GetObject` 权限。OSS 副本的到期清理由 Bucket 生命周期规则管理，可按上述专用前缀配置保留周期。上传配置依据 [OSS Node.js SDK 文档](https://www.alibabacloud.com/help/en/oss/developer-reference/upload-a-local-file) 和 [服务端加密说明](https://www.alibabacloud.com/help/en/oss/user-guide/server-side-encryption-8)。

### 从压缩备份恢复

先执行 `db:backup:check` 校验备份目录，再将 `database.sql.gz` 解压得到 SQL。恢复到新建空数据库，恢复后核对 `manifest.json` 中的各表记录数及内容，再切换应用连接。

```sh
gunzip -c 备份目录/database.sql.gz > .local/backups/restore-check.sql
# 当前源数据未变动时，可使用本机 Docker MySQL 验证恢复与逐表校验
npm run db:verify-backup -- .local/backups/restore-check.sql
```

gzip 和 SHA-256 校验只验证文件完整性，实际恢复演练通过 `db:verify-backup` 完成。备份服务不依赖本机 MySQL 客户端；恢复验证工具需要项目的 Docker MySQL。

## 运行与部署

ECS 的 Node + systemd + Nginx 部署与运维命令见 [deploy/README.md](deploy/README.md)。`/api/health` 会实际检查 MySQL 连接；部署包上传前运行 `npm run check:build-secrets`，确认构建产物未包含本地凭据。

```sh
npm run build
HOST=127.0.0.1 PORT=3000 npm run serve
```

线上配置真实 `SITE_URL=https://你的域名` 与 `DATABASE_URL`，通过 HTTPS 反向代理访问 Node 服务。代理保留 Host / Origin，数据库端口仅向应用开放。Docker Compose 中 MySQL 仅绑定本机 `127.0.0.1:13306`，数据位于命名卷 `blog_mysql`。停止容器保留数据卷；不要用 `docker compose down -v` 删除正式数据。

此版本使用 Node 运行时与 MySQL TCP 连接，原来 Cloudflare Pages 静态部署方式需要改为 Node 服务部署。

## 验证

```sh
npm run typecheck
npm test
# 先启动本机 MySQL；测试连接需有创建、删除临时数据库的权限
# .env 为 RDS 时，通过 TEST_DATABASE_URL 指定本机测试库连接
npm run test:integration
npm run test:site
npm run build
```

类型检查覆盖新后台、服务层、API、脚本和测试。单元测试覆盖原文导入、路径兼容、Markdown 安全渲染、密码散列与 GitHub 上传协议；集成测试会创建独立临时数据库和本机服务，验证草稿隔离、发布、版本冲突、路径跳转、软删除保留全文与关联数据、撤回恢复、分类、导出和会话注销。测试结束后停止服务并销毁整个临时库，不在应用数据库清理文章，也不调用文章物理删除。测试不会向真实 GitHub 仓库上传文件；真实上传需配置令牌后验证。

`test:integration` 使用 `TEST_DATABASE_URL`，未指定时使用 `DATABASE_URL`，并拒绝远程数据库连接；连接账号需有创建和删除临时数据库的权限，现有应用库不会写入测试数据。它自行启动和停止独立服务，无需预先启动预览。`test:site` 只读取已发布数据，可检查当前云数据库对应的本地前台。
