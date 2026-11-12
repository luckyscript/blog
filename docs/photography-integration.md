# 站内摄影

摄影入口为 `/photography/`，作品档案、主题合集、器材、关于和 `/photography/works/<ID>/` 保留作品编号，使用博客导航、字体与主题。管理入口 `/admin/photography` 共用博客登录及 CSRF 校验。

## 云端运行

- 摄影后端独立运行在阿里云 ECS，由 `rain-blog-photography.service` 管理，仅监听 `127.0.0.1:3009`。博客通过回环连接调用，不需要家中服务器、SSH 隧道或 NAS 在线。
- 代码在 `/opt/rain-blog-photography/releases/`，`current` 指向当前版本；运行时使用 `/opt/rain-blog/runtime/bin/node`。数据目录 `/var/lib/rain-blog-photography` 归专用用户 `rain-blog-photography` 所有，目录 0700。
- 原有阿里云 MySQL/RDS 数据库继续使用，作品、草稿、EXIF、评分、私密笔记、合集、首页设置和修图版本不重建、不重新编号。原片与展示图从原私有 R2 桶复制到 ECS，逐个校验大小及 SHA-256/MD5。R2 原对象保留。
- `/etc/rain-blog/photography-service.env` 为 `root:rain-blog-photography 0640`，保存数据库、AI、异地备份设置及桥接密钥；`/etc/rain-blog/photography.env` 为 `root:rain-blog 0640`，仅保存博客调用地址及同一密钥。切换时更换桥接密钥。私密配置、数据库和照片不进入 Git 或发布包。
- HMAC 绑定方法、路径、公开/管理权限及 60 秒时间窗，只接受回环来源。公开 API 仅代理固定读取接口；管理 API 先验证博客登录。草稿图片由摄影后端检查发布状态。评分、私密笔记、文件名和原始 EXIF 不进入公开初始化数据。
- 后台上传、图片处理、AI 文案、版本管理、母版下载和备份恢复都在云端执行。NAS 中尚未入库的照片按用户选择留在原照片盘；需要时从电脑或挂载的 NAS 选择成品上传。后台“素材导入”说明这一流程，不再发起家中网络请求。历史 NAS 导入记录保留。

## 备份与恢复

`rain-blog-photography-backup.timer` 每天北京时间 04:35 后随机延迟不超过 10 分钟，生成包含数据库、原片、展示图及历史版本的完整备份。成功上传并校验到原私有 R2 桶的 `backups/rain-blog-photography/` 后，保留最近七份本地自动备份；手动备份及恢复前备份不自动删除，异地备份也不自动删除。

手动触发与查看状态：

```sh
systemctl start rain-blog-photography-backup.service
systemctl status rain-blog-photography-backup.timer
journalctl -u rain-blog-photography-backup.service
```

最近成功回执在数据目录的 `cloud-backup-status.json`。后台“存储与备份”可创建本地完整备份和恢复，恢复前会自动备份当前状态。异地备份先下载、验证归档 SHA-256，再解压到新的私密目录；`server/backup.mjs restore` 逐个验证 manifest 中的文件，不覆盖现有目标目录。

## 源码与更新

`services/photography/` 保存来自 `luckyscript/jianshan-portfolio` 的 `c4bfea1af7bf7870a321f4af7fc45eb413bae642` 后端、测试及运行资源，包含 HMAC 桥接、云端迁移、只读预检与异地备份适配。`server/fonts/OFL.txt` 保留字体许可。嵌套 `dist` 是上游自带的静态资源；博客自身的构建输出仍不提交。

博客的纯渲染代码在 `src/lib/photography/vendor/`，浏览器代码和器材图在 `public/photography/`。样式限定于摄影容器。后端依赖由独立的 `package-lock.json` 固定，安装用 `npm ci --prefix services/photography`，测试用 `npm test --prefix services/photography`。

云端部署安装本仓库 `deploy/rain-blog-photography.service` 及备份 service/timer。先以 `PHOTOGRAPHY_READ_ONLY=1`、独立端口预检，禁止写入且不启动导入处理器，避免两个进程同时处理同一作品库。Nginx 的 `deploy/nginx-photography.conf` 为上传保留 100 MB 上限。

## 性能与缓存

作品列表和站点数据按一批读取展示图、文件名、器材及合集关系，不按每张照片重复查询；不缓存作品发布状态。前台为已有的 640/1280/2560 展示图输出 `srcset`，隐藏轮播继续延迟加载，背景氛围图使用小尺寸。档案默认页直接复用 SSR 结果，筛选与翻页仍读取实时接口。

已发布展示图使用 `private, no-cache`、ETag 及 `Vary: Cookie`，每次 304 之前仍核验发布状态。撤回发布不依赖缓存过期；草稿图片与原片下载继续 `no-store`。后台经典脚本并行下载、按原顺序执行，工作室准备完成后启动数据请求。

`deploy/nginx-photography.conf` 只对明确列出的静态脚本启用长缓存，URL 必须携带 `v=perf-YYYYMMDD-N`。修改脚本时同步提升前台与后台的版本参数，摄影图片和管理接口不使用这个共享缓存规则。

## 迁移验证与回滚

迁移记录及切换前数据快照保存在 ECS `/var/lib/rain-blog-photography-migration/`，文件复制 manifest 在数据目录。确认文件校验、作品数量、数据库摘要和权限检查通过后，停止并禁用家中的摄影服务与反向隧道，启动云端正式服务，切换博客配置及 release。

验证包括：家中服务停止后摄影页和图片继续返回 200；匿名管理接口 401、草稿页和图片 404、错误 Origin 写请求 403；上传、版本、备份恢复在云端隔离数据库中完成测试。真实作品库保持原有记录。

切换前保存博客 release、桥接配置及家中服务状态。回滚时先停止云端摄影服务，再恢复旧桥接配置和博客 release，从私密迁移目录恢复专用隧道的 authorized_keys，最后启用原家中服务及专用隧道；不能同时启用两个导入处理器。当前云端写入的数据和原片必须先备份，原 R2 桶只作为迁移前文件来源，不能代替云端切换后的最新文件。


## 博客风格的摄影页面（2026-11-12）

公开页面由 `presentation.ts` 直接渲染当前路由，使用博客字体、纸张和主题变量，不再加载旧站的整套 CSS 与五个浏览脚本。首页展示完整封面与代表作，档案提供题材、年份、器材和关键词筛选；合集保留图文顺序与宽幅设置。作品详情保留真实 EXIF、独立链接和分享，大图浏览按当前筛选或合集的顺序切换。

后台策展预览使用 `/photography/` 图片路径，标题位于照片上方，适配新的公开页面。代表作同序号时以 ID 降序排列，与后台一致。作品列表与设置并行读取后再一起渲染；失败重试重新读取设置，避免沿用失败的初始化结果。

验收包括全部七个后台页及公开路由；在独立临时 SQLite 作品库中实际执行上传、发布、私密笔记、图文合集、策展保存、备份与恢复。测试库不连接线上 RDS。生产验收仅检查读取、权限和跨站写入拒绝，保留原始作品与所有照片文件。
