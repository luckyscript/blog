---
title: 真的只是随机吗？
date: 2016-04-19 16:00:00
external: false
permalink: /blog/2016/fp
category: ALgorithms
tags:
  - Algorithms
  - Javascript

---

> 这是来百度后的新人技术分享，这是个大体的提纲，分析的比较简单，因为我觉得自己对FP也存在一知半解。
### 什么是函数式编程(What?)

函数式编程中的函数这个术语不是指计算机中的函数（实际上是子程序），而是指数学中的函数，即自变量的映射。也就是说一个函数的值仅决定于函数参数的值，不依赖其他状态。比如sqrt(x)函数计算x的平方根，只要x不变，不论什么时候调用，调用几次，值都是不变的。
### 特点(fectures)

函数是一等公民（first-class），可以在任何地方定义，在函数内或函数外，可以作为函数的参数和返回值，可以对函数进行组合。
### 纯函数（ Pure Function ）
- sin(x)，返回实数x的sin值
- length(s),返回串s的大小
- encrypt(k,d)，运行一个使用key k 关于日期片d的确定加密算法
### 非纯函数 ( Impure Function )
- random()是非纯函数，因为每次调用潜在地产生不同的值。这是因为伪随机数产生器使用和更新了一个全局的“种子”状态。假如我们修改它去拿种子作为参数，例如random(seed)，那么random变为纯函数，因为使用同一种子值的多次调用返回同一随机数。
- printf() 是非纯函数，因为它促使输出到一个I/O装置，产生了副作用。
- 总结：纯函数就是不受外部影响的函数。
### 副作用（side effect）

指当调用函数时，除了返回函数值之外，还对主调用函数产生附加的影响。例如修改全局变量（函数外的变量）或修改参数。

在JavaScript中，引入了函数。但显然JS中的函数可以访问、修改全局变量（或定义在函数外的变量），如下

``` javascript
var a = 5;
function fun(){
    a = 10
}
fun();
```

JS中要想保证函数无副作用这项特性，只能依靠编程人员的习惯，即

1，函数入口使用参数运算，而不修改它

2，函数内不修改函数外的变量，如全局变量

3，运算结果通过函数返回给外部（出口）

``` javascript
var a = 5;
function fun(c){
    return c + 5
}
fun(a);
```
### 引用透明( referential transparent )

引用透明的概念与函数的副作用相关，且受其影响。 如果程序中两个相同值得表达式能在该程序的任何地方互相替换，而不影响程序的动作，那么该程序就具有引用透明性。它的优点是比非引用透明的语言的语义更容易理解，不那么晦涩。纯函数式语言没有变量，所以它们都具有引用透明性。
### 高阶函数（high－order function）

高阶函数应该是指至少满足下列条件之一的函数：
1. 可以接受函数作为输入参数
2. return 一个函数
### 惰性求值（lazy evaluation）

Haskell的精髓
所谓惰性求值就是指“需要的时候再去求”
举个例子：

通过将表达式包装成一个thunk实现的
f(g x)，实际上给f传递的参数就是一个类似于包装成(_ -> (g x))的一个thunk
然后在真正需要计算g x的时候才会调用这个thunk
事实上这个thunk里面还包含一个boolean表示该thunk是否已经被计算过（若已经被计算过，则还包含一个返回值），用来防止重复计算
ES6里面的Generator函数其实就是用了惰性求值。
### 求值策略

如下的函数应该如何求值？    

``` javascript
var x = 1;  
function f(m){
    return m * 2;     
}
f(x + 5)
```

应该先求1＋5  然后求 6_2 
还是先求出式子`（x+5）_2`然后代入1
如果想深究的话 可以在维基百科上搜索求值策略
### trunk

c语言采用第一种
而Haskell采用第二种
所以Haskell中应该是这样的一个过程

``` javascript
var thunk = function () {
    return x + 5;
};
function f(thunk){
    return thunk() * 2;
}
```

trunk其实就是传名调用的一个策略，用来保存表达式。
如果想知道惰性求值的原理可以读一下sicp中关于流式计算的那章
### 模式匹配（pattern match）

``` haskell
equal_list :: [a] -> [a] -> Bool
equal_list list_1 list_2 = case (list_1, list_2) of
    ([], [])       -> False
        ([], _ )       -> False
        (_ , [])       -> False
        (x: xs, y: ys) -> (x == y) && (xs `equal_list` ys)
```

模式匹配是函数式编程中一个比较重要的概念，这也很方便的使我们做一些操作。
### lambda

lambda比较火，目前很多语言都开始引入lambda的概念。
js的匿名函数（anonymity function） es6的箭头函数（arrow function）
python中的lambda
java8中的lambda
### Monad

个人认为是为了达到纯函数的目的，所采用的方法。
比如，Haskell中实现random函数。计算机中的任何random方法除了unix内核中的random是真随机外，其余的都是伪随机。所谓伪随机，就是要提供一个种子。而如果Haskell中定义了一个种子，那么就明显不是纯函数了。所以Haskell要做的就是把这个种子向下传递，Haskell中的random方法不仅仅返回random的值，同时返回种子（但是不是显式），那么如何将种子传下去呢？这就是monad的作用了。
再比如，io操作是无法避免的会有状态的改变的，所以Haskell中也提供了大量的与io相关的monad。
### 优点(good-part)

由于命令式编程语言也可以通过类似函数指针的方式来实现高阶函数，函数式的最主要的好处主要是不可变性带来的。没有可变的状态，函数就是引用透明（Referential transparency）的和没有副作用（No Side Effect）。

函数即不依赖外部的状态也不修改外部的状态，函数调用的结果不依赖调用的时间和位置，这样写的代码容易进行推理，不容易出错。这样做的好处就是测试和调试的时候就会非常容易。

由于不变性，多个线程之前就不共享状态，不会导致资源的竞争，也就不会出现死锁的情况。所以函数式编程目前广泛被用在并发编程上（concurrency），比如著名的Scala。

由于没有状态的改变，所以纯函数式编程语言无法实现循环（loop）的。我们平时接触的for／while循环都是需要可变的状态作为跳出循环的条件。
所以函数式编程中只能用递归（recursive）来解决迭代（iteration）问题。以阶乘为例

iteration实现阶乘:

``` javascript
function fact(n) {
    var acc = 1;
    for (var i = 1; i <= n; i++) {
        acc = acc * i;
    }
    return acc;
}
fact(10);
```

recursive实现阶乘:

``` javascript
function fact(n) {
    if (n == 1) {
        return 1;
    } else {
        return n*fact(n-1);
    }
}
fact(10);
```

函数式编程是面向数学的抽象，更接近人的语言，代码简洁，更容易被理解。

阶乘的Haskell的实现

``` haskell
fact :: Int -> Int
fact n = case n of
    1 -> 1
    _ -> n * fact (n-1)
```
### 递归带来的问题(recursive's problem)

``` javascript
function fib(n) {
    if (n == 1) {
        return 1;
    } else if (n == 2) {
        return 1;
    } else {
        return fib(n - 1) + fib (n - 2);
    }
}
fib(12);
```

尾递归(tail-recursive)解决
#2

``` javascript
function fib(n, acc1, acc2) {
    if(n == 1) {
        return acc1;
    } else if(n == 2) {
        return acc2 + acc1;
    } else {
        return fib(n-1, acc2 + acc1, acc1)
    }
}
fib(60,1,1);
```
### 缺陷
1. 学术界比较风靡，商业应用不广泛。
2. 国内编程注重c这些图灵机衍生的语言，所以编程思维局限于指令式编程。
### 总结
1. 纯函数并不完美，因为有些东西就不是纯的，副作用这东西是必然存在的。用c语言实现一个随机数发生器多么简单？但是用Haskell就不一样了。（曾经有个学长让我用Haskell写个helloworld，我想了半天,必须得传个helloworld，才能的到helloworld）
2. 纯面向对象也不完美，比如java，由于缺乏函数一等的机制，java完全不允许把函数当作数据来传递。java中可以将函数绑架到对象里面，然后称作方法，然而缺乏一等函数的机制，导致java需要太多的设计模式。

但是，学习FP和OOP的思想是我们每个编程爱好者需要做的。虽然当中有糟粕，但是学习这些还是大有裨益的。
如果你不想去看Haskell的FP，也不想花大精力去研究java的OOP，那么javascript是个不错的选择。

好吧，我想说，php是最好的语言（逃。
