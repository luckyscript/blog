---
external: false
layout: post
title: 后续传递(continuation)和回调(callback)的差别
date: 2016-04-05 16:00:00
update: 2016-04-05 16:00:00
summary: 后续传递与回调是函数式编程中比较重要的一个概念 
category: 函数式编程
tags: [前端, JavaScript, 函数式编程]
---

## 前言

在绝大多数的编程语言中，函数通常返回值给调用它的对象。举个例子:

```
var sum = add(2, 3);
console.log(sum);
function add(x, y) {
    return x + y;
}
```

然而，在现在很多的“函数是一等公民”的语言（函数式编程语言）中，我们也可以把值返回给回调函数，而不是直接返回给调用的那个对象。

```
add(2, 3, function (sum) {
    console.log(sum);
});
function add(x, y, cont) {
    cont(x + y);
}
```

上面的例子可以看出，我们并没有把参数运行后的值返回，而是将它传递给了cont，而cont也就是调用时的那个函数。我们称cont是add的一个传递。

相信大家对回调非常熟悉吧，对于后续传递风格，或许只是喜欢函数式编程的小伙伴可能了解过。那么回调与后续传递的差别是什么呢？

## 中语

我认为后续传递是回调的一种特殊的形式。一个函数可以有许多个回调函数，许多次回调：

```
var array = [1, 2, 3];
forEach(array, function (element, array, index) {
    array[index] = 2 * element;
});
function forEach(array, callback) {
    var length = array.length;
    for (var i = 0; i < length; i++)
        callback(array[i], array, i);
}
```

当一个函数做的最后一件事情是回调另一个函数的时候，我们称第二个函数为第一个函数的后续传递。e.g:

```
var array = [1, 2, 3];
forEach(array, function (element, array, index) {
    array[index] = 2 * element;
});
function forEach(array, callback) {
    var length = array.length;
    // last thing forEach does
    // cont is a continuation of forEach
    cont(0);
    function cont(index) {
        if (index < length) {
            callback(array[index], array, index);
            // last thing cont does
            // cont is a continuation of itself
            cont(++index);
        }
    }
}
```

如果当一个函数的最后一件是是调用另一个函数的时候，我们称这种情况叫做尾调用（参考尾递归#2 ）。一些解释器，比如Scheme语言的解释器会对尾调用进行优化。这样不会导致函数的堆积（比如斐波那契的运算），而将状态层层传递。

## 后话

如果想继续了解后续传递风格请往下读

```
alert(pythagoras(3, 4));
function pythagoras(x, y) {
    return x * x + y * y;
}
```

如果我们将每一种运算，包括加减乘除都写成函数的形式（在函数式编程中，运算符就是函数）。

```
alert(pythagoras(3, 4));
function pythagoras(x, y) {
    return add(square(x), square(y));
}
function square(x) {
    return multiply(x, x);
}
function multiply(x, y) {
    return x * y;
}
function add(x, y) {
    return x + y;
}
```

如果我们不允许返回任何值，我们可以利用后续传递风格来重新改下代码：

```
pythagoras(3, 4, alert);
function pythagoras(x, y, cont) {
    square(x, function (x_squared) {
        square(y, function (y_squared) {
            add(x_squared, y_squared, cont);
        });
    });
}
function square(x, cont) {
    multiply(x, x, cont);
}
function multiply(x, y, cont) {
    cont(x * y);
}
function add(x, y, cont) {
    cont(x + y);
}
```

(面目狰狞，仿佛又看到了node的魔鬼金字塔)

不允许返回任何值，所以你不得不吧这些值或者状态传到下一个函数里面。这种风格叫做后续传递风格(continuation passing style)。
不过仍然存在两个问题需要考虑。

这种风格明显增加了调用栈的大小需求，如果你没有用Scheme或者支持尾调用优化的语言去写代码，很容易就会栈溢出（我也不知道容易不容易。。。）
魔鬼金字塔。
当然，第一个问题其实是好解决的，因为js支持异步编程。异步调用的结果就是，当你调用传递函数的时候，前面的状态已经计算好了。这样就导致堆栈大小并不会增加。

```
Function.prototype.async = async;
pythagoras.async(3, 4, alert);
function pythagoras(x, y, cont) {
    square.async(x, function (x_squared) {
        square.async(y, function (y_squared) {
            add.async(x_squared, y_squared, cont);
        });
    });
}
function square(x, cont) {
    multiply.async(x, x, cont);
}
function multiply(x, y, cont) {
    cont.async(x * y);
}
function add(x, y, cont) {
    cont.async(x + y);
}
function async() {
    //use js setTimeout to implement async
    setTimeout.bind(null, this, 0).apply(null, arguments);
}
```

解决第二个问题的方法通常是利用一个函数callcc，全称是call-with-current-continuation，可惜的是callcc并没有在js里完整的实现。所以我们重写一下

```
pythagoras(3, 4, alert);
function pythagoras(x, y, cont) {
    var x_squared = callcc(square.bind(null, x));
    var y_squared = callcc(square.bind(null, y));
    add(x_squared, y_squared, cont);
}
function square(x, cont) {
    multiply(x, x, cont);
}
function multiply(x, y, cont) {
    cont(x * y);
}
function add(x, y, cont) {
    cont(x + y);
}
function callcc(f) {
    var cc = function (x) {
        cc = x;
    };
    f(cc);
    return cc;
}
```