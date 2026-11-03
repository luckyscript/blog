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

证书首次签发前，使用仅含 80 端口和 ACME 验证目录的临时配置，让 `/.well-known/acme-challenge/` 从 `/var/lib/letsencrypt` 提供文件。域名须解析到 ECS，安全组开放 80/443。Cloudflare 代理可先设为仅 DNS，避免旧站路由影响验证。安装 Ubuntu 官方 certbot 包后执行：

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

迁移前生成数据库备份，执行 `db:setup` 应用 `003_moments.sql`，再从能连接 Telegram 的机器执行 `npm run moments:sync -- --backfill`。发布网站后，安装同步服务的 unit 文件并启用：

```sh
systemctl daemon-reload
systemctl enable --now rain-blog-moments
cd /opt/rain-blog/current
runuser -u rain-blog-moments -- /opt/rain-blog/runtime/bin/node --env-file=/etc/rain-blog/moments.env --import tsx scripts/sync-moments.ts --healthcheck
journalctl -u rain-blog-moments --since '10 minutes ago'
```

每次切换 current 后同时重启该服务。数据库命名锁防止同一来源并发同步；失败会记录到后台设置页，下一轮继续。无可用 Telegram 访问通道时，同步健康检查失败是预期的真实状态；网站仍读取已保存内容。原有备份服务会自动包含新增表，无需更改备份范围。

回滚时将 current 原子切回保留的旧版本，再重启两服务。配置和备份位于发布目录之外，不随版本切换删除。数据库结构变更必须另行确认兼容性。
