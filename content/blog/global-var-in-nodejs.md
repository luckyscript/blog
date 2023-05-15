---
external: false
draft: false
title: Node.js中的全局变量
date: 2018-10-30
category: Node.js
---

之前在看阮一峰博士的`ES6标准入门`的时候，注意到一句话：
> 全局对象的属性赋值和全局变量的赋值是一回事。（对于Node.js来说，这一条只针对REPL环境适用，环境模块中，全局变量必须显示声明成global对象的属性）

今天在`segmentfault`上看到一个问题：
[node中this的指向](https://segmentfault.com/q/1010000016494413)

>问题描述
node下this的指向问题，其他的我都知道，不过如果直接定义局部变量呢，这个局部变量怎么获取到呢，是存放在哪里的。
相关代码
// 请把代码文本粘贴到下方（请勿用图片代替代码）
```javascript
var name = 1
console.log(name)
console.log(this.name)
console.log(global.name)
```
你期待的结果是什么？实际看到的错误信息又是什么？
1，undefined，undefined

突然就想到了Node.js中的全局变量的问题，于是准备做一下深入的调研。

我们再来看阮博士的那句话，说REPL环境中和环境模块中的表现是不一样的。那么我们就去这两个场景中跑一下这段代码:

```
// REPL中
1
1
1
```

```
// 文件中
1
undefined
undefined
```

果然是不一样的！突然感觉自己这些年的JS是白学了，居然会有这样的情况。
但是仔细想想，Node中的每个文件其实都是用一个自执行函数来包起来的，也就是说这段代码在文件中的表现其实是:
```
(function() {
var name = 1
console.log(name)
console.log(this.name)
console.log(global.name)
})()
```
这样也就瞬间明白了为啥我们直接var一个变量，不会挂到全局上了。不过仔细想想也是，如果随便在js的某个文件中var一个变量，就挂到全局作用域上面也是一件细思极恐的事情了。

想明白了这点,我们再来研究一下为啥在REPL中可以直接打印呢。
我一开始猜想是REPL不会作为模块，所以也不会用自执行函数包起来，所以表现的和浏览器一样。但是猜想终归是猜想，