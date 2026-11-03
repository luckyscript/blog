# 本站字体

页面只从当前站点加载字体与图标，不依赖 Google Fonts 或正式域名的资源地址。`inkrain.css` 定义字体；首页只预加载轻量的仓耳界面字集，其余字符按 `unicode-range` 下载对应 WOFF2 分片，保留原字体的完整字符覆盖。

- 仓耳今楷：来自本仓库原有 `cang-er-jin-kai.ttf`，原文件保持不变；`cang-er-jin-kai-ui.woff2` 与编号分片由该文件生成。
- Source Serif Pro：`@fontsource/source-serif-pro@5.3.0` 的 Latin 400/600 正体 WOFF2，许可见 `SOURCE-SERIF-PRO-LICENSE.txt`。
- JetBrains Mono：`@fontsource/jetbrains-mono@5.3.0` 的 Latin 400/600 正体 WOFF2，许可见 `JETBRAINS-MONO-LICENSE.txt`。

中文正文仍使用系统宋体等回退字体；拉丁字符使用对应的本站字体。

更新仓耳字体或需要将新增固定界面文案加入首屏字集时，在项目根目录运行：

```sh
python3 -m venv .local/font-tools
.local/font-tools/bin/python -m pip install 'fonttools[woff]'
.local/font-tools/bin/python scripts/build-fonts.py
```

提交生成的 WOFF2 和 `inkrain.css`。正常网站构建与部署直接使用这些文件，不需要 Python 或在线下载字体。
