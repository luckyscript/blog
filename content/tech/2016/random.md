---
title: 真的只是随机吗？
date: 2016-03-21 16:00:00
external: false
permalink: /blog/2016/random
category: ALgorithms
tags:
  - Algorithms
  - Javascript

---

### 参考资料

[怎样解释伪随机](https://www.zhihu.com/question/23397525)
[由eval生成的代码效率真的很差吗？](http://blog.zhaojie.me/2012/08/js-code-from-eval-benchmark.html)
[如何评价一个伪随机数生成算法的优劣？](https://www.zhihu.com/question/20222653)
[电脑取随机数是什么原理，计算机能产生“真随机数”吗？](https://segmentfault.com/a/1190000000661777)
### 背景

随机数在我们的日常应用中可谓是非常广泛，比如俄罗斯方块的下一个，部落冲突砍树获得的宝石数，DOTA斧王转不转。例子实在不要太多。
### Math.random()

但是说到随机数的生成，我想懂一点编程的人都可以写出来。比如js中，可以用`Math.random()*range+n`来实现。
### 伪随机

然而，你有没有考虑过，计算机所生产的随机数，其实是属于伪随机，那么什么是伪随机呢？伪随机所生产随机数，只是一个重复周期比较大的数列按一定的「算法」和「种子值」生成的。参考：[维基百科](https://zh.wikipedia.org/wiki/随机数生成器)
那么说，如果算法和种子数是一定的，则生成的随机数也是一定的。不过js的方法无法提供种子值，所以我用Java测试了下。

``` java
public class TestRandom {
    public static void main(String[] args) {
        int r1 = new Random(1024).nextInt();
        int r2 = new Random(1024).nextInt();
        System.out.println(r1 + " " + r2);
    }
}
```

结果，意料之中的结果是相等的。
### 真随机

那么问题来了，计算机可以产生所谓的真随机么？真随机，如果非要讲这个真，或许只有量子力学的不确定才算是真的吧，而我们平时所说的随机应该是属于统计学范畴的，也就是具备不确定性，可以被安全的用于金融等领域，德国联邦信息安全办公室给出了随机数发生器质量评判的四个标准：

> K1——相同序列的概率非常低
> K2——符合统计学的平均性，比如所有数字出现概率应该相同，卡方检验应该能通过，超长游程长度概略应该非常小，自相关应该只有一个尖峰，任何长度的同一数字之后别的数字出现概率应该仍然是相等的等等
> K3——不应该能够从一段序列猜测出随机数发生器的工作状态或者下一个随机数
> K4——不应该从随机数发生器的状态能猜测出随机数发生器以前的工作状态

计算机理论上是不能产生真随机数的，像C，MATLAB这些产生的随机数，都是伪随机的，它们的方法无非也是通过可确定的函数比如线性同余，可确定的种子数比如毫秒数，来产生随机数，但是一旦函数和种子数都可知，那么随机数也是可预测的。
但是，我们知道一个典型的计算机体系里面的真随机数发生器，UNIX内核里的`/dev/random`便是一个典型的例子（但是我进去后，发现random是个字符设备，这有点不懂，之后再看一下字符设备和块设备）。它在理论上能产生真随机。即这个随机数的生成，独立于生成函数，或者说这个产生器是非确定的。实现方法呢？简单的讲就是软硬结合，或者说，引入系统外的变量（把软件，代码，算法想象成一个封闭的系统）。
### 其它生成随机的方法
1. (new Date() - 0)%1024
   由时间毫秒数来对你所需要的range进行取余，得到随机。
2. LCG随机数生成器

``` javascript
var nativeRandomLCG = function (seed) {
    return function () {
        seed = (214013 * seed + 2531011) % 0x100000000;
        return seed * (1.0 / 4294967296.0);
    };
};

var evalRandomLCG = function (seed) {
    var randomLCG = eval("(" + nativeRandomLCG.toString() + ")");
    return randomLCG(seed);
};
```
