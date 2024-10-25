---
external: false
title: Evercookie调研小结
date: 2016-01-02 00:00:00
category: FE
tags:
  - Browser

---

### 信息来源:

- https://github.com/samyk/evercookie
- http://samy.pl/evercookie


### 主要实现方式

1. Standard HTTP Cookies
2. Flash Local Shared Objects
3. Silverlight Isolated Storage
4. CSS History Knocking
5. Storing cookies in HTTP ETags (Backend server required)
6. Storing cookies in Web cache (Backend server required)
7. HTTP Strict Transport Security (HSTS) Pinning
8. window.name caching
9. Internet Explorer userData storage
10. HTML5 Session Storage
11. HTML5 Local Storage
12. HTML5 Global Storage
13. HTML5 Database Storage via SQLite
14. HTML5 Canvas - Cookie values stored in RGB data of auto-generated, force-cached PNG images (Backend server required)
15. HTML5 IndexedDB
16. Java JNLP PersistenceService
17. .Java exploit CVE-2013-0422 - Attempts to escape the applet sandbox and write cookie data directly to the user's hard drive.


### 实际实现情况

经过检测主流浏览器可以实现的地方完全相同，之前认为IE应该会在userdata里存储，但是并没有。

1. cookie
2. localstorage
3. sessionstorage
4. window.name
5. png+canvas
6. etag
7. cache
8. dbData
9. flash cookie


### 清除方法

- chrome
  - 设置 window.name
  - 清除所有浏览器数据
- safari
  - 设置 window.name
  - 清除所有浏览器数据
- IE11
  - 关闭浏览器缓存
  - 清除所有浏览器数据
  - 清除window.name
  - 清除localstorage
  - 清除sessionstorage
- firefox
  - 清除所有浏览器数据
  - 清除window.name
  - 清除localstorage
  - 清除sessionstorage


### 其它

- 由于我电脑firefox和Safari的flash是共享的，所以，evercookie在Safari上的时候，也会影响到firefox。
- 在隐私模式下不起作用。
