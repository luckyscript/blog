---
external: false
layout: post
title: 我为什么使用RSS获取信息
date: 2024-05-07 16:00:00
update: 2024-05-07 16:00:00
description: 我为什么使用RSS获取信息
category: Awesome
tags: [Awesome]
toc: true
---

### RSS是什么？

RSS(Really Simple Syndication)是一种基于XML的标准，在互联网上被广泛采用的内容包装和投递协议。RSS是一种描述和同步网站内容的格式，是使用最广泛的XML应用。

RSS的起源可以追溯到1997年互联网发展的早期，其创造出来的目的是可以让用户可以订阅到网站的信息，与现在的微信公众号的逻辑类似。

在早期，互联网的代名词是开放和自由。因此，像类似个人博客、论坛都会开放出来RSS的订阅链接可以供大家直接使用，如阮一峰的博客，我们就可以从右上角点击去查看他的RSS链接。结合一些RSS的客户端就可以直接实现在客户端中查看对应的文章了。
![1711607873690-c24d96c0-649a-4040-9bc4-1f9df98344c5.webp](https://raw.githubusercontent.com/luckyscript/image/master/1711607873690-c24d96c0-649a-4040-9bc4-1f9df98344c5.webp)

![1711608122204-10ccf307-9f7a-46c8-8bd1-15f256a2dd95.webp](https://raw.githubusercontent.com/luckyscript/image/master/1711608122204-10ccf307-9f7a-46c8-8bd1-15f256a2dd95.webp)

### 我为什么使用RSS

![1711607983663-bc267716-0618-4e30-8b26-980b28997b10.webp](https://raw.githubusercontent.com/luckyscript/image/master/1711607983663-bc267716-0618-4e30-8b26-980b28997b10.webp)

现在我们的社交软件，知乎、微博、小红书，99%都采取了Feed流的方式。算法了解我们喜欢看什么，于是就给我们推什么，于是乎信息茧房就这么形成了。作为App的运营人员，这种算法推荐的方式自然能提高软件的留存，但是对于用户来说，我更相信自己的选择。


1. RSS订阅是一种很好的信息聚合的方案，我们通过RSS可以将自己感兴趣的博客、论坛、公众号、微博等任何想关注的信息汇总在一个地方。当我们想获取信息的时候，只需要在一个软件中就可以查看。
2. RSS 公开透明，订阅RSS不需要任何用户信息，是完全单向的订阅方式。并且也不限定任何应用订阅，甚至你可以自己实现一个RSS的订阅应用。
3. RSS是一种拉取机制，对于阅读，我更偏向于拉取，我有时间的时候我会点开软件去看一下更新的数据，然后筛选出自己感兴趣的文章，仔细阅读。推送机制在当前已经被玩坏了，太容易打扰用户。


### 和微信公众号有什么差别？


可以说，微信公众号的订阅的逻辑借鉴了RSS，但是其实还是有很大不同：

1. 微信公众号是一个封闭的生态，虽然有爬虫的方案能从外部获取到公众号的内容，但是难度相当大。而RSS是自由公开的，任何人、爬虫只要能访问到网站，都可以获取到信息。
2. 微信公众号是一种推送机制，微信公众号的文章也是Feed流的形式。

### 和NewsLetter有什么差别

另一种互联网上最常见的订阅信息的方案是 NewsLetter，其订阅的方案是：我们将自己的邮箱地址在网站上提交，当网站有更新的时候，会将更新的内容通过邮件发送到邮箱中。

NewsLetter主要有以下几个问题：

1. Rss的订阅完全不需要平台方的许可，并且也不限定任何订阅的方式，而newsLetter本质上是在平台方许可后，通过特定渠道来发送特定的消息。
2. 隐私问题，将个人邮箱暴露在互联网上，其实是有一定风险的。

### RSSHUB 万物皆可RSS

前文有提到，早期的个人博客、论坛基本都会提供RSS链接订阅。但是随着现在网络越来越封闭，很少有站点会主动提供RSS的订阅，甚至是会对RSS的订阅进行封杀。

RssHub是Github开源出来的一个项目，其本质是一个爬虫，将获取到的信息转成RSS的格式输出。

对于大部分没有主动提供RSS的站点来说，爬虫的实现基本上难度不大，一种方案是获取到了API接口，转换一下格式。另一种方案则是利用python的lxml库来进行页面的HTML的解析和处理。对于一些需要登录态才能查看的网站，用户也可以私有化部署RSSHUB，将自己的cookie配置好来实现上述的功能。

另一种站点就是反爬机制非常严格的网站，例如推特。在马斯克上任以后，为了保障推特APP的活跃度，马斯克下令封杀所有推特的三方客户端，这也对RSS订阅推特带来了很大的挑战。「甚至，有人发现，马斯克会反向DDOS这些第三方的服务」。

### 写在最后
RSS在现在快速发展的互联网中，感觉已经是一个很远古的东西了。我还是很推荐你去尝试一下。也欢迎你通过RSS来订阅我的博客。
