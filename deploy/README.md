# ECS 原生部署

适用于 Ubuntu 24.04。网站与备份使用独立用户、配置文件和 systemd 服务；不依赖 Docker，不替换服务器已有的全局 Node。网站只监听 `127.0.0.1:3000`，Nginx 代理公网 HTTP/HTTPS。

目录约定：

| 路径 | 用途 |
| --- | --- |
| `/opt/rain-blog/runtime` | 指向独立 Node 22 运行时 |
| `/opt/rain-blog/releases/<版本>` | 本地构建的 dist、源码和 Linux 依赖 |
| `/opt/rain-blog/current` | 指向当前发布版本，可切回旧版本 |
| `/etc/rain-blog/web.env` | 网站运行配置，root:rain-blog，640 |
| `/etc/rain-blog/backup.env` | 仅含数据库与备份配置，root:rain-blog-backup，640 |
| `/var/lib/rain-blog/backups` | 备份目录，rain-blog-backup，700 |

首次安装创建 `rain-blog`、`rain-blog-backup` 两个系统用户和 `rain-blog-code` 代码只读组。代码由 root 持有，两服务加入代码组，各自只能读取自己的配置。两份 env 文件由安全通道单独传输，不能放在发布包中。网站不需要初始管理员密码、MySQL root 密码或 OSS 备份凭据。

## 发布

在开发机完成检查与构建，构建地址须与本次公开地址一致：

```sh
npm ci
npm run typecheck
npm test
SITE_URL=https://你的域名 npm run build
npm run check:build-secrets
```

发布包只包含 `dist/`、`src/`、`scripts/`、`content/`、`db/`、`deploy/`、`tests/`、`package.json`、`package-lock.json` 和 TypeScript 配置，排除 `.env`、`.local/`、`.git/`、`node_modules/` 和 macOS 元数据。备份脚本用到 tsx，服务器安装依赖时必须包含开发依赖。小内存 ECS 使用开发机构建的产物，服务器无需运行 Astro 构建。

Node 22 从 nodejs.org 官方下载，校验同版本 `SHASUMS256.txt` 后安装到 `/opt/rain-blog/node-<版本>/`，再设置 runtime 符号链接。服务器的 npm 命令需使用该运行时的 PATH：

```sh
cd /opt/rain-blog/releases/版本
PATH=/opt/rain-blog/runtime/bin:$PATH npm ci --include=dev --no-audit --no-fund
chown -R root:rain-blog-code .
chmod -R g+rX,o-rwx .
```

将两个 `.service` 文件安装到 `/etc/systemd/system/`。`nginx.conf` 使用正式域名 `rainonpiano.com`，80 端口保留 ACME 验证目录，其余请求跳转到 HTTPS，443 端口反向代理应用；启用前须完成证书签发。首次安装前检查其他站点和端口占用。Nginx 覆盖转发协议与来源头，防止客户端伪造；Node 端口保持回环监听。

安装性能与代理配置片段，然后在实际反向代理应用的 `server` 中引入性能片段。正式 `nginx.conf` 已包含该引入；仅 HTTP 的临时配置也需要添加。不要给域名跳转或 ACME 专用 server 添加它。

```sh
install -m 644 deploy/nginx-proxy.conf /etc/nginx/snippets/rain-blog-proxy.conf
install -m 644 deploy/nginx-performance.conf /etc/nginx/snippets/rain-blog-performance.conf
# 在代理 server 内添加：include /etc/nginx/snippets/rain-blog-performance.conf;
nginx -t
systemctl reload nginx
```

CSS、JavaScript、JSON、SVG 和 XML 启用 gzip，并返回 `Vary: Accept-Encoding`。带 Vite 指纹的 `/_astro/` 文件缓存一年；无指纹的字体和图片保留 ETag 验证，避免更新后命中旧字集。网页仍实时读取发布状态，后台仍为 `private, no-store`，不启用整页代理缓存。

保留 Cloudflare 橙云代理时，可使用 `nginx-cloudflare.conf` 与 Cloudflare Origin CA 源站证书。先在 ECS 的 `/etc/rain-blog/tls/` 生成私钥 `rainonpiano.com.key` 和 CSR `rainonpiano.com.csr`，目录权限 700、文件权限 600，由 root 持有。将 CSR 提交到 Cloudflare 的 **SSL/TLS → 源服务器 → 创建证书 → 使用我的私钥和 CSR**，主机名填写 `rainonpiano.com`。将返回的 PEM 格式 Origin Certificate 保存为 `/etc/rain-blog/tls/rainonpiano.com.pem`（root:root，600）。私钥留在 ECS，不放入 Git、发布包或聊天。

确认签发证书与私钥的公钥相同、有效期和 SAN 正确后，再安装 `nginx-cloudflare.conf`，执行 `nginx -t` 并 reload。之后将 Cloudflare SSL/TLS 模式设为 **Full (strict)**，验证公网 HTTPS、后台验证组件和登录接口。Origin CA 供 Cloudflare 回源使用，需保持橙云；它不受普通浏览器直接信任，也不由 certbot 自动续期，需记录到期时间并在到期前重新签发。Cloudflare 的 **Flexible** 模式配合源站 HTTP 跳转 HTTPS 会造成重定向循环。

也可使用 Let's Encrypt。证书首次签发前，使用仅含 80 端口和 ACME 验证目录的临时配置，让 `/.well-known/acme-challenge/` 从 `/var/lib/letsencrypt` 提供文件。域名须解析到 ECS，安全组开放 80/443。Cloudflare 橙云可保留，前提是验证路径能回到 ECS 且未被重定向或安全规则拦截；必要时临时设为仅 DNS 排查。安装 Ubuntu 官方 certbot 包后执行：

```sh
certbot certonly --non-interactive --agree-tos --register-unsafely-without-email --webroot -w /var/lib/letsencrypt --preferred-challenges http --key-type ecdsa --cert-name rainonpiano.com -d rainonpiano.com
```

签发成功后再启用正式 nginx.conf。启用 `certbot.timer`，并在 `/etc/letsencrypt/renewal-hooks/deploy/` 安装执行 `nginx -t && systemctl reload nginx` 的脚本，使续期证书立即生效；通过 `certbot renew --dry-run --run-deploy-hooks` 验证。Cloudflare 若重新开启代理，SSL/TLS 模式使用 Full (strict)。

```sh
ln -s /opt/rain-blog/releases/版本 /opt/rain-blog/current.next
mv -Tf /opt/rain-blog/current.next /opt/rain-blog/current
systemd-analyze verify /etc/systemd/system/rain-blog*.service
nginx -t
systemctl daemon-reload
systemctl enable --now rain-blog rain-blog-backup nginx
# 更新已有服务时需要重启进程以加载新代码/配置
systemctl restart rain-blog rain-blog-backup
systemctl reload nginx
```

RDS 必须允许 ECS 的网络来源。数据库已有数据时，不重复执行导入；结构升级先备份，再执行适用迁移。

## 验证与运维

```sh
systemctl is-active rain-blog rain-blog-backup nginx
curl --fail http://127.0.0.1:3000/api/health
journalctl -u rain-blog -u rain-blog-backup --since '10 minutes ago'
cd /opt/rain-blog/current
runuser -u rain-blog-backup -- /opt/rain-blog/runtime/bin/node --env-file=/etc/rain-blog/backup.env --import tsx scripts/backup-service.ts --healthcheck
```

`/api/health` 实际执行数据库只读查询，连接失败返回 503，不暴露内部连接信息。备份进程存活与备份成功需分别检查：`status.json` 的 `lastSuccessAt` 必须有效，并检查首份 `manifest.json` 和压缩 SQL 校验结果。每天北京时间 03:00 备份，本地保留 30 天；OSS 未配置时只有 ECS 本地副本。

Cloudflare Turnstile 正式密钥和域名未配置时，登录保持禁用。配置写入 web.env 后重启网站；不使用测试密钥开启生产登录。GitHub 上传还需要单独配置图片仓库令牌。

## 碎碎念服务

`rain-blog-moments.service` 使用独立的系统用户和同名私有组 `rain-blog-moments`，加入只读代码组 `rain-blog-code`。创建 `/etc/rain-blog/moments.env`，权限 `root:rain-blog-moments 640`，只填 `DATABASE_URL`、`MOMENTS_TELEGRAM_CHANNEL`、`MOMENTS_SYNC_INTERVAL_SECONDS` 和需要的 `MOMENTS_HTTP_PROXY` / `MOMENTS_TELEGRAM_ORIGIN`。不要复制网站登录或备份凭据。

ECS 使用 PopCat 时，登录后运行 `popcat proxy always`、`popcat proxy lan off`、`popcat proxy on`，让混合代理在 `127.0.0.1:23333` 独立运行。将 `rain-blog-moments-popcat.conf` 安装为 `/etc/systemd/system/rain-blog-moments.service.d/popcat.conf`，执行 `systemctl daemon-reload` 并重启同步服务。该配置仅让 Telegram 页面与图片下载使用代理，不设置全局代理或局域网网关。管理界面保持 `127.0.0.1:23380`，远程管理通过 SSH 本地端口转发；账号凭据由 PopCat 保存在其私有状态目录，不放入博客环境文件或仓库。

图片使用独立持久目录，不放在 release 或私有微博凭据目录中。安装两个 unit 前创建只读共享组和目录：

```sh
groupadd --system rain-blog-media
usermod -aG rain-blog-media rain-blog
usermod -aG rain-blog-media rain-blog-moments
install -d -o rain-blog-moments -g rain-blog-media -m 2750 /var/lib/rain-blog-media
```

两个 unit 都设置 `MOMENTS_MEDIA_DIRECTORY=/var/lib/rain-blog-media`；只有同步服务有该目录的写权限，网站只读。保留 `/var/lib/rain-blog-moments` 的 `0700` 权限。备份和恢复时同时保留媒体目录及其 `.refs` 索引；数据库中的图片路径依赖这些文件。

迁移前生成数据库备份，执行 `db:setup` 应用 `003_moments.sql`，再从能连接 Telegram 的机器执行 `npm run moments:sync -- --backfill`。发布网站后，安装同步服务的 unit 文件并启用：

```sh
systemctl daemon-reload
systemctl enable --now rain-blog-moments
cd /opt/rain-blog/current
runuser -u rain-blog-moments -- /opt/rain-blog/runtime/bin/node --env-file=/etc/rain-blog/moments.env --import tsx scripts/sync-moments.ts --healthcheck
journalctl -u rain-blog-moments --since '10 minutes ago'
```

每次切换 current 后同时重启该服务。数据库命名锁防止同一来源并发同步；失败会记录到后台设置页，下一轮继续。无可用 Telegram 访问通道时，同步健康检查失败是预期的真实状态；网站仍读取已保存内容。原有备份服务会自动包含新增表，无需更改备份范围。

同步进程固定使用 IPv4，规避当前 ECS 到微博 / R2 的双栈连接超时。持久图片目录须在部署时设置为 `rain-blog-moments:rain-blog-media`、`2750`；运行时不重新设置目录的 setgid 位，因为 `RestrictSUIDSGID=true` 会拒绝这类操作并返回 `EPERM`。新增图片仍设置为 `0640`，继承目录的共享组。

### 链接健康检查

先备份数据库并运行 `db:setup` 应用 `005_link_health.sql`。创建独立系统用户 `rain-blog-links`，只加入 `rain-blog-code` 只读代码组。`/etc/rain-blog/links.env` 仅保存 `DATABASE_URL`，归 `root:rain-blog-links`、权限 `0640`，不复制其他服务的凭据。

安装 `rain-blog-link-health.service` 和 `.timer` 到 `/etc/systemd/system/`，`systemctl daemon-reload` 后运行 `systemctl enable --now rain-blog-link-health.timer`，首次另行 `systemctl start rain-blog-link-health.service`。定时器每周日北京时间 04:40 后随机延迟至多五分钟执行，停机错过后补跑。服务以三路并发复查已发布链接，数据库命名锁防止重叠运行；旧网址的响应不能覆盖编辑后的新目标。日志只输出数量与状态，不输出页面、Cookie 或凭据。前台只查询保存结果。

### 微博免费网页同步

将 `deploy/rain-blog-moments-weibo.conf` 安装为 `/etc/systemd/system/rain-blog-moments.service.d/weibo.conf`，执行 `systemctl daemon-reload` 并重启同步服务。默认 `MOMENTS_WEIBO_TRANSPORT=web`，不调用付费 API。只有显式设置 `official` 才会使用原有开放平台适配器。

两个账号各自扫码登录；扫码辅助程序使用隔离的 `/opt/rain-blog/weibo-runtime` Python 环境，依赖见 `deploy/requirements-weibo.txt`。辅助页只监听服务器回环地址，通过 SSH 本地转发访问，授权后关闭辅助服务与转发。同步本身使用 Node.js，只发送固定微博网页地址的读取请求，不需要 Python 常驻。辅助程序入口为 `scripts/weibo-web-login.py`，以同步用户运行，仅监听 `127.0.0.1:23383`。例如：

```sh
systemd-run --unit=rain-blog-weibo-login --property=User=rain-blog-moments --property=Group=rain-blog-moments --property=SupplementaryGroups=rain-blog-code --property=NoNewPrivileges=true /opt/rain-blog/weibo-runtime/bin/python /opt/rain-blog/current/scripts/weibo-web-login.py
# 在自己的电脑建立转发，然后打开 http://127.0.0.1:23383/
ssh -L 127.0.0.1:23383:127.0.0.1:23383 root@YOUR_ECS
# 两个账号都显示“已登录并保存”后关闭辅助服务与 SSH 转发
systemctl stop rain-blog-weibo-login
```

扫码通过后先写入私有临时会话，再从微博首页解析登录配置核对 UID；网络失败可重试校验，避免重新扫码。校验通过才生成正式 UID 文件。临时文件不被同步器读取，不把辅助页面的“已扫码”误当作同步成功。


登录文件位于 `/var/lib/rain-blog-moments/weibo-web/<UID>.json`，目录 `0700`、文件 `0600`，均归 `rain-blog-moments` 所有。保存前必须核对实际登录 UID，两个会话不可混用。网站进程不能读取该私有目录。微博图片默认直接连接新浪 CDN，并带微博 Referer；需要代理时单独配置 `MOMENTS_WEIBO_HTTP_PROXY`。Telegram / X 继续使用原有代理。

迁移前将 `blog_moments`、`blog_moment_sources` 完整快照写入私有备份。先验证每个账号首个分页，再以小批次调用 `syncMomentSource('weibo:UID', {maxPages:5})` 续跑，直到来源 `backfillComplete` 为真。旧的官方数字游标不可直接用于网页分页；更换通道前备份并重置相应来源的同步状态，不动历史存档。全程保留未返回的旧记录；图片下载失败不推进该批游标。完成后核对来源条数、时间范围、原记录状态及所有站内图片，不能仅以进程存活判断成功。

### X / Twitter

`deploy/rain-blog-moments-x.conf` 为 `rainonpiano`、`raininpiano` 配置每小时读取。安装为 `/etc/systemd/system/rain-blog-moments.service.d/x.conf` 后执行 `systemctl daemon-reload` 并重启同步服务。适配器通过 `scripts/x-read.py` 调用固定版本 `twitter-cli==0.8.5` 的只读请求；Python 环境位于 `/opt/rain-blog/x-runtime`，依赖见 `deploy/requirements-x.txt`，不使用付费 X API。

凭据仅在用户明确授权后，经 SSH 直接保存到 `/var/lib/rain-blog-moments/x/session.json`，包含 `auth_token`、`ct0`，可选 `cookie_string`。目录归 `rain-blog-moments` 所有且为 `0700`，文件为 `0600`；不放入仓库、博客环境文件、命令行参数或日志。更新凭据后下一轮重新读取。未登录、受限流、返回缺失或账号非公开时明确失败，不将失败误报为空历史。

X 按独立原始推文 ID 保存；保留转推外层 ID、原作者署名和发布时间。长文优先读取完整正文，截断而没有全文时停止推进游标；仅接收配置账号的公开内容。历史游标与增量检查点可续跑，常规每轮最多 2 页；补历史可以单独调用 `syncMomentSource('x:用户名', {maxPages:100})`，不会触发其他平台同步。历史完整范围取决于 X 实际返回的数据。`pbs.twimg.com` 图片和视频封面进入现有持久图片缓存，视频内容仍通过源站地址播放。

回滚时将 current 原子切回保留的旧版本，再重启两服务。配置和备份位于发布目录之外，不随版本切换删除。数据库结构变更必须另行确认兼容性。
