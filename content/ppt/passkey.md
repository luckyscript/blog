---
external: false
title: "无密码登录时代到来！"
description: "webAuthN is comming！"
date: 2024-05-29
category: Tech
---

# 无密码登录时代到来！

互联网发展了二三十年，我们现在的各种交互和早起其实都有挺大的变化，但是在用户登录这块，这三十年的方案基本没变

`用户输入用户名和密码来进行登录验证。`

传统的登录验证的问题很大!

传统的密码模式在登录的时候，我们的用户名和密码会发送到服务端进行做对比认证，这种认证是基于对称密码的验证。

脱库、撞库、暴力破解 我们的密码无时无刻不处在泄漏的边缘，而一旦泄漏，其他人就可以完全替代我们的身份。

![password-chrome](/images/ppt/passkey/20240529194637.jpg)

## 二次验证【Two-Factor Authentication】

密码不再是认证用户的唯一手段，用户输入密码后，还需要输入一串设备端的随机密钥，这种随机密钥大多采用OTP（One-Time Password，一次性密码算法）根据用户的账号随着时间变化。其他人没有用户的设备，因此就算拿到密码也无法登录。

但是，二次验证本身，仍然是基于`用户名&密码`这套古老的机制进行的补丁行为，并不是全新的设计。尽管一定程度上提升了安全性，然而在实现成本、用户登录流程的复杂度上都大大提高了。

是否存在什么方案能既简单，又安全的登录认证呢？

# WebAuthn

`WebAuthn`是`Web Authentication`的缩写，是`W3C`发布的Web标准，webAuthn是`FIDO联盟`的`FIDO 2项目`的核心组成部分。

`FIDO`是`Fast Identity Online`的缩写，由苹果、谷歌、联想、英特尔、微软等大型公司牵头的，旨在解决快速线上认证标准化统一化的联盟。FIDO2则是一个包含了从客户端、验证器、Web、服务端的统一的解决方案。核心包含了`WebAuthn`和`CTAP(客户端到验证器协议)`

WebAuthn标准在2016年推出，近期已经逐渐普及：
1. Apple于WWDC 2022宣布推出Passkeys技术，可以用作WebAuthn的认证端；
2. Google和微软也在2023年宣布支持Passkeys技术。

从底层原理上来讲，webAuthn并不是一个新的事物。

webAuthn标准：
* 服务端存储用户信息及其公钥列表
* 认证端保存了用户的唯一id、及其私钥列表
  * 认证端可以是浏览器自行实现的，例如`Chrome`也通过调用MacOS的指纹认证来实现了Passkeys
  * 也可以是第三方的设备，例如iPhone或者YubiKey等认证器
* 浏览器负责桥接认证端和服务端

[Show Code Time!](https://github.com/luckyscript/webauthn-demo)

Thank You!
