---
title: 前端路由应用部署的一些看法
date: 2019-02-13 16:00:00
external: false
permalink: /blog/2019/fe-deploy
category: FE
tags:
  - FE
  - Env

---

## 客户端渲染的发展

随着`Angularjs`带入了`MVVM`思想，`React`和`Vue`的兴起，客户端渲染应用在前端开发中变得流行起来。所谓`客户端渲染`，指的是页面的dom结构都由前端js来生成，而服务端只是渲染了一个基础模板，这样大大的减少了服务端的压力。尤其是一些后台管控系统等对`seo`等不敏感的场景下，应用非常广泛。

## 路由

因为面向服务端的只是一个模板文件，所以前端应用的路由都是由前端自己来控制的。而通常前端路由的实现方式一种是hash方式，一种是history方式。我比较推荐history方式。

## 部署

关于客户端渲染应用的部署，我觉得有几点要注意：
1. 前后端分离部署，前端不需要依赖后端。前后端是平等的关系。
2. 机器资源宝贵，要做到合理利用。
3. 访问链路不能过长。

所以我有过几套发布部署的方案，也思考过一些方案的优缺点。

1. 前端部署到有nginx应用的服务器上，后端部署到node服务器上（以node应用为例）。nginx设置反向代理，将需要打给后端的请求配置好。外部请求过来时，先打到nginx服务器上，开始渲染前端页面，页面中的请求再打到nginx服务器上，这时候会被反向代理到node服务器上，node作出响应后，nginx拿到后再返回给客户端。
2. 前端部署到静态资源上，后端部署到node服务器上，nginx根据location来判断是否为前端静态文件，如果发现则直接请求静态资源，否则则打到node服务器上。

两种方案，其实我个人觉得差不多，其实差别也不大。其实无论选择哪种方案，适合自己的才是最好的。我在设想部署这个博客的时候，打算用docker包掉一切，但是最后发现机器带不动～。所以我现在的部署方式类似第二种，本地写了一个脚本，本地编译 + scp至云端dist目录。而后端部分，则是压缩 -> scp上传 -> 执行脚本(解压、npm install、npm start)。

附送上 hash 路由 nginx的配置：

## nginx配置

```nginx

location ~ /admin/ {

 root /Users/user/MySpace/nbook-admin;

 index index.html;

 include /Users/user/Myspace/nbook-admin/admin/.htaccess;

}

```

.htaccess

```nginx

if (!-e $request\_filename){

 rewrite ^/(.\*)$ /admin/index.html?\_ca\_=$1 last;

}

```
