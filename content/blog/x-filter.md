---
external: false
layout: post
title: X-filter 
date: 2019-04-15 16:00:00
update: 2019-04-15 16:00:00
summary: 之前在次碳酸钴的博客闲逛的时候，发现前辈开发了独特的XEditor，觉得不错，但是貌似没有开源，于是不能拿来主义了，就自己开发了一下。
categories: 前端技术 
tags: [前端, JavaScript]
---

## 思路来源
之前在[次碳酸钴](https://www.web-tinker.com/)的博客闲逛的时候，发现前辈开发了独特的XEditor，觉得不错，但是貌似没有开源，于是不能拿来主义了，就自己开发了一下。

言归正传，评论区有彩蛋，可以使用<x标签>来代替传统的`<img>`、`<code>`、`<span>`、`<a>`这四种常用标签。这个标签不是浏览器的标准的标签，服务器内部把他解析成以上几种标签。最后存入数据库的是标准标签。


## 使用例子
下面是几个使用的例子：

```
<x href="https://www.luckyscript.me">test</x>
```

这个标签会被解析成

```
<a href="https://www.luckyscript.me" target="_blank" rel="nofollow">test</a>
```

效果：
<a href="https://www.luckyscript.me" target="_blank" rel="nofollow">test</a>

由于安全性问题，这种场景下，标签只会对`http(s)`开头的有效链接做解析成`<a>`。如果不是这种情况，会毫不留情的解析成`<span>`

```
<x src="https://www.luckyscript.me/public/upload/article_nblog.png">
```

这个标签会被解析成`img`。

```
<img src="https://www.luckyscript.me/public/upload/article_nblog.png" />
```

效果：
<img src="https://www.luckyscript.me/public/upload/article_nblog.png" />

```
<x code="javascript">var</x>
```

这种场景会被解析成：

```
<code class="language-javascript">var</code>
```

效果：
<code class="language-javascript">var</code>

其余场景，如果是合法标签，则会转为`<span>`，否则则会进行实体化，防止xss的发生。

## 代码实现

parse部分，思路参考了`leizongmin`的`xss`包。实现起来也没多大难度，就不一一分析了。

https://github.com/luckyscript/x-filter
