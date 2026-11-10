# 下雨就像弹钢琴 · 内容后台

Astro 前台与 React 管理后台运行在同一个 Node 服务中。文章正式版本、编辑草稿、分类标签、历史版本、登录会话和媒体索引存入 MySQL；线上文章与碎碎念图片使用 Cloudflare R2，并保留 ECS 持久副本。碎碎念通过独立同步服务写入 MySQL，前台请求不再访问 Telegram。

## 外观主题

文章阅读区的「书写载体」按钮单击即依次切换宣纸、竹简、青铜、甲骨，选择保存在当前浏览器，跨文章与刷新继续生效。四种表面使用独立的细节纹理与装帧，沿用宋体和相同的正文宽度，图片、代码、表格保持可读。打印使用白纸样式。纹理原图、网页编码及提示词见 `docs/reading-surfaces.md`。

页眉的外观按钮依次切换「宣纸 → 月白 → 鸣沙 → 玄墨」。选择会在当前浏览器保存，刷新和打开其他前台页面时继续使用。「鸣沙」以[中国传统色](https://cht-colors.pages.dev/)中的牙色、枯黄浅阶为底，搭配赭色、褐色与煤黑；正文、链接、代码块和首页水墨图一起适配暖砂色调。

## 碎碎念同步

后台 `/admin/moments` 可发布「本站」碎碎念：文字、最多九张图片、发布时间、草稿、编辑和可恢复回收站。图片上传和剪贴板粘贴复用 R2 上传通道；上传完成后才可保存或发布。自写内容使用 `local:manual` 来源，不参与外站同步。旧的本地存档继续展示，后台标为历史随记；外站原文不能经本站发布接口改写。前台单图高度限制为桌面 260px、手机 220px，多图以三列正方形缩略图展示，点击查看完整大图。

原“旧碎片”已合并到 `/moments`，按原始发布时间与各平台内容混排。451 条微博存档复用已入库记录，34 条本地随记通过 `npm run moments:import-local` 一次性补齐；可先加 `-- --dry-run` 预检。导入是事务内仅新增操作，重复执行不覆盖已有内容或恢复回收站记录，来源标记为“本站”。原 `/moments/archive` 及其分页永久跳转到统一时间线。

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

同步使用当前公开 Telegram 频道的网页预览，不需要账号密码或 Bot Token。抓取有超时和响应大小限制，断点保存在数据库；落后多页时继续补齐缺口，避免只检查最近一页而漏掉内容。最近页会重新检查编辑；已补抓的旧历史不会每次全量重扫。网页改版、私密频道、删除及未在预览中提供的内容不保证可获取。图片会进入下述持久缓存；视频文件仍引用源站，未在预览中提供的媒体无法归档。

`MOMENTS_TELEGRAM_CHANNEL` 默认 `jsjhlkblog`，兼容旧 `CHANNEL` 配置。大陆 ECS 无法直连 Telegram 时，在独立的同步配置中填写服务器可达的 `MOMENTS_HTTP_PROXY`（HTTP/HTTPS），或自己维护的 HTTPS 预览中转 `MOMENTS_TELEGRAM_ORIGIN`。代理凭据不放入网站构建产物或浏览器。没有可用访问通道时，服务会记录失败并每轮重试，页面继续展示已有内容；“进程运行”不等于“同步成功”。后台设置页可查看保存条数、最近尝试/成功时间、历史补抓和错误状态。

ECS 使用 `deploy/rain-blog-moments.service`，独立用户 `rain-blog-moments` 和 `/etc/rain-blog/moments.env`。该文件只配置数据库、频道、同步间隔和必要的访问通道，不复制后台登录、Cloudflare 或 GitHub 凭据。通用数据库备份会自动包含这三张新表。

碎碎念图片在同步入库前保存到 `MOMENTS_MEDIA_DIRECTORY`（本机默认 `.local/moments-media`，ECS 为 `/var/lib/rain-blog-media`），使用内容 SHA-256 命名，通过 `/media/moments/<hash>.<ext>` 提供同源访问。缓存没有过期清理，不随版本发布替换；URL 索引可在来源离线时复用已有图片。下载失败不更新该页内容和同步位置。只接受 Telegram / 新浪 / X 图片 CDN 的 HTTPS 图片，限制跳转、大小和超时，校验图片格式，不开放任意 URL 代理。`MOMENTS_HTTP_PROXY` 用于 Telegram / X 的读取与图片下载；微博图片默认直连，可单独设置 `MOMENTS_WEIBO_HTTP_PROXY`。已经保存的图片不依赖 Telegram 连通性，新内容抓取仍需可用访问通道。

修复历史失效图片时，在能连接来源的机器运行 `npm run moments:cache-images -- stage --manifest .local/moments-media-repair.json`，重新获取 Telegram 图片地址并保存所有历史图片。先把缓存目录（含 `.refs`）复制到服务器的持久目录，再运行 `npm run moments:cache-images -- apply --manifest /path/manifest.json --backup /private/path/before-images.json`。应用前验证每张图片的 SHA-256、锁定来源并核对原内容指纹，生成修复前快照；仅更换图片引用，保留内容、发布时间和回收站状态。数据库备份之外，还需保留媒体目录备份。

### 微博两个账号

默认接入 `5351049607`（luckyscript）和 `1562002727`（jsjhlk）。`MOMENTS_WEIBO_TRANSPORT=web` 为默认免费方案，只读取微博网页接口，不调用付费开放平台。两个账号分别扫码登录，经登录身份核验后，将各自会话保存到 `MOMENTS_WEIBO_WEB_CREDENTIAL_DIRECTORY/<UID>.json`。目录归同步用户所有且权限为 `0700`，文件为 `0600`，格式为 `{ "account": "UID", "cookies": { "SUB": "..." } }`。会话不进入仓库、前台产物、命令参数或日志；会话过期后重新扫码更新。

网页适配器核对当前登录账号和目标主页 UID，逐页获取历史，补齐长文、图片元数据及转载中的图片；无法确认身份、长文缺失、图片缺失、限流或异常分页会停止，不将错误当作空历史。默认每账号每小时检查一次，每轮最多 2 页；手动 `--backfill` 最多 100 页，可重复执行续跑。历史范围以微博实际开放的公开内容为准，私密、已删除或账号可见范围以外的内容不发布。

```sh
# 本地历史文件：先校验，再导入；重复执行只补充新记录。
npm run moments:import-weibo -- --dry-run
npm run moments:import-weibo
```

本地 451 条带明确微博来源页脚的记录导入“微博历史存档”，缺少作者 UID 的记录保留来源未知状态。后续经核验的网页数据按全局微博 ID 认领原记录，保留站内链接、首次保存时间和软删除状态。微博 ID 使用无精度损失的十进制字符串。图片入库前下载至持久媒体目录，原始微博链接保留，既有记录原版保存在迁移前快照中；抓取失败或未返回的记录不会被删除。同步迁移前应备份数据库与媒体目录。

原有官方接口仅在明确设置 `MOMENTS_WEIBO_TRANSPORT=official` 时启用，需要另行开通微博开放平台服务，可能计费。`moments:auth-weibo` 是该可选付费通道的授权命令，不用于免费网页方案；该通道每轮及手动补历史均限制为 2 页。

### R2 图片转存

可将碎碎念图片同时保存到 Cloudflare R2 标准存储。`MOMENTS_R2_CREDENTIAL_FILE` 指向同步用户独有的 `0600` JSON 文件，包含 `accountId`、`bucket`、`accessKeyId`、`secretAccessKey`；令牌只授予该桶的对象读写权限，不放入环境变量、仓库或浏览器产物。同步先保存 ECS 文件，再上传 R2 并核对内容摘要，任一环节失败都不发布该页。已缓存的源站图片也会补传，既有对象不重复上传。

`npm run moments:mirror-images -- --dry-run` 生成公开记录的图片迁移清单；`--upload` 并发补传；`--verify` 逐张校验 S3 对象及自定义域名的内容摘要。先完成迁移与核验，再给网站设置 `MOMENTS_MEDIA_PUBLIC_ORIGIN=https://images.rainonpiano.com`。页面及 API 在输出时使用 R2 图片域名，数据库仍保留原站内图片路径；ECS 副本和旧链接继续可用。R2 接入只处理已转存的图片，不上传凭据、媒体索引或其他文件。

## 本地启动

首页只查询最新 3 篇文章的列表字段，不编译整个栏目的 Markdown，也不在首屏额外刷新一次碎碎念。文章正文按内容指纹复用编译结果（最多 128 条、估算内存上限 16MiB）；每次请求仍查询 MySQL 发布状态与元信息，编辑正文、撤回或软删除均即时生效。返回给页面的 Markdoc 树各自独立，后台预览和管理接口不使用这份正文缓存。正文图片默认延迟加载并异步解码。

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

`TURNSTILE_HOSTNAMES` 是精确域名白名单，不含协议、路径或端口；留空时使用 `SITE_URL` 的主机名。修改后重启 Node 服务。密钥未配置、配置不完整或当前域名不匹配时，页面禁用登录，接口返回 503。通过 ECS IP 访问时，即使密钥已配置，也会提示当前地址未绑定验证；请先将域名接入 ECS 并配置 HTTPS，再通过域名后台登录。`SITE_URL` 为白名单内的 HTTPS 地址时，页面会提供该域名的后台入口。

页面完成验证后，将令牌与邮箱密码一起提交；服务端先请求 Cloudflare Siteverify，确认成功、当前域名与 `admin-login` 用途匹配，再校验密码、限流并创建登录会话。Secret Key 只在服务端读取。绕过页面直接请求登录接口仍须通过验证；网络异常、验证失败、令牌过期或重复使用均会拒绝登录。每次登录失败后页面重新获取令牌。

Siteverify 使用独立连接池，将地址切换等待时间设为 1.5 秒，以适应 ECS 的跨境连接延迟。临时连接错误、HTTP 429/5xx 和 `internal-error` 最多尝试三次，共用一个十秒总时限和 Cloudflare 幂等键；密钥错误、无效或过期令牌直接拒绝。重试耗尽时仍禁止登录，并在服务端输出 `turnstile_siteverify_unavailable` 诊断事件，日志只含错误代码和尝试次数。

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

### 链接收藏

`blog_links` 独立保存收藏链接、分类、介绍、排序、点击次数、发布状态和版本。发布前运行 `npm run db:setup` 应用 `004_curated_links.sql`；`npm run db:import-links` 只预检，追加 `-- --apply` 将原链接文章中的公开网址一次性归档，重复执行保留后台修改和回收站状态。原文章与 Markdown 不变，专题页中的外链在渲染时映射到固定 UUID。

后台 `/admin/links` 负责录入、编辑、发布和回收站，前台 `/link` 只展示、分类筛选和搜索。`/link/to/<完整 UUID v4>` 只读取已发布的登记目标，拒绝查询参数、无效 UUID、未发布或已下线链接。保存和跳转时均校验 HTTP/HTTPS 公开网址，拒绝其他协议、凭据、控制字符、IP、内网主机、端口与二次跳转路径；修改目标保持 UUID 不变。数据库自动备份会包含此表。

链接页可切换卡片与列表视图，选择保存在当前浏览器，并由 `view=list` 参数分享或保留筛选、搜索、分页。访问状态从 `blog_link_health` 读取，显示最近检查时间；前台加载不访问对方网站。状态区分可访问、访问受限、页面失效、服务异常、暂未连通和检查受限，不把反爬或网络超时报成页面不存在，也不自动下线链接。修改目标网址后旧健康结果立即失效。

`npm run links:check` 检查未检查、目标已变更或超过七天的公开链接；追加 `-- --force` 全部复查。每条最多 12 秒、最多四次重定向、并发三条，只请求响应头；HEAD 被拒绝时使用 GET 并在响应头后关闭。每跳解析并核验全部 DNS 地址，将连接固定到核验后的公网地址，保留原始 Host 与 TLS 校验，拒绝内网、回环、云元数据及保留地址。定时部署见 `deploy/rain-blog-link-health.service` / `.timer`，每周日北京时间 04:40 后五分钟内复查一次；首次上线先执行一次。

`/ppt` 以演示卡片展示全部已发布文稿：有封面时显示封面，没有封面时生成主题色的标题页。保留原文稿链接、摘要与日期。

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

## 后台图片上传

线上设置 `MEDIA_STORAGE_PROVIDER=r2`，使用 `deploy/rain-blog-article-media-r2.conf` 配置独立的上传目录、私有凭据文件和公开图片域名。后台用户只看到存储服务、域名和就绪状态；凭据不会下发浏览器。`ARTICLE_R2_CREDENTIAL_FILE` 必须为运行网站用户拥有的 `0600` 文件，格式与碎碎念 R2 配置相同。服务器先写入持久目录，再上传并校验 R2 内容摘要，成功后才返回图片地址。`/media/articles/<hash>.<ext>` 继续提供 ECS 副本访问。

在正文编辑框直接粘贴剪贴板中的图片，会自动上传到 R2 并在光标处插入 Markdown。上传期间可以继续编辑文字，保存和发布会等待图片完成；失败会移除占位文字并提示重试。普通文本粘贴沿用编辑器行为。媒体库也使用同一上传通道。

历史 GitHub 图片按原文件内容转存，不重新压缩；数据库迁移前保存私有快照，并把受影响文章及草稿的原版写入历史版本。迁移只更新图片引用和媒体索引，不删除 GitHub 原文件。

### 兼容 GitHub 图床

未设置 `MEDIA_STORAGE_PROVIDER` 时保留 GitHub 上传兼容能力。在 `.env` 中配置并重启服务：

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
