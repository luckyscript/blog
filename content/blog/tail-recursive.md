---
external: false
layout: post
title: 浅谈尾递归
date: 2016-03-17 16:00:00
update: 2016-03-17 16:00:00
description: 第一次接触尾递归（Tail recursion）是在读《SICP》这本书上。第二次是面试的时候，被面试官问到了。
category: 函数式编程
tags: [前端, JavaScript, Lisp, 函数式编程]
draft: true
---

> 第一次接触`尾递归`（Tail recursion）是在读[《SICP》](https://book.douban.com/subject/1148282/)这本书上。第二次是面试的时候，被面试官问到了。

## 递归
```
(define (Fibonacci x)
  (cond (= x 1) 1
    (= x 2) 2
        (else 
              (+ (Fibonacci (- x 2) (Fibonacci (- x 1))))))
```

这是个简单的斐波那契函数，函数的作用就是算出对应的斐波那契值。我们很容易想到，Fibonacci x 的值就是

```
(+ (Fibonacci (- x 2)) (Fibonacci (- x 1))) 
```
的值。

因此以上代码就是对自身的调用，直到满足递归出口，这样的思想叫做递归。

## 性能堪忧

但是，递归的思想虽然简单，计算机可不喜欢这样子。因为每个线程在执行代码的时候，计算机都会分配一定的空间给它。每次方法调用的时候都会堆栈里面存东西，因此，这种方法很容易会导致堆栈溢出。

拿斐波那契函数来说吧。这种递归其实是属于树形递归，假设一个解释器是应用序的，这个递归的运算过程可以展开成一个树形。也就是说，计算f(5)的值我需要计算f(4)和f(3),但是计算f(4)的时候，我需要计算f(3)和f(2)，计算f(3)的时候我们要计算f(1)和f(2)，可以看到我们的计算大多都是重复性的，尤其是到了f(3)这些低级的时候，重复了太多。这还只是f(5)的计算过程。

## 如何优化

采用尾递归的方法，会让这种情况产生缓解。

```
(define (Fibonacci x a b) 
  (if (= n 0)
       a
            (Fibonacci (- x 1) a,a+b)))
(Fibonacci 10 0 1)
```

以上代码就使用了尾递归的思想，那么到底什么是尾递归呢？

> In computer science, a tail call is a subroutine call performed as the final action of a procedure. If a tail call might lead to the same subroutine being called again later in the call chain, the subroutine is said to be tail-recursive, which is a special case of recursion.

这是维基百科的定义，中文意思大概是：

在计算机科学里，尾调用是指一个函数里的最后一个动作是一个函数调用的情形：即这个调用的返回值直接被当前函数返回的情形。这种情形下称该调用位置为尾位置。若这个函数在尾位置调用本身（或是一个尾调用本身的其他函数等等），则称这种情况为尾递归，是递归的一种特殊情形。

讲的过于抽象，很难理解，其实尾递归就是尾调用的一种特殊，尾调用是指函数的最后一个行为是调用函数，所以尾递归，顾名思义就是函数的最后一个行为是调用其本身。所谓最后一个行为，是指除了调用之外不能有其它的附加动作，比如加法之类的。因此，我感觉尾递归是一种长着递归脸的迭代，因为他每次都把数据传递到下一次调用，在SICP中也被认为是迭代。在一些函数式编程语言中，尾递归编译后会被优化成迭代的形式，所以效率才会很高。

和普通递归相比较，由于尾递归的调用处于方法的最后，因此方法之前累积在堆栈中的结果已经对下次递归没有用处，因此可以把留在堆栈中的数据清除，即使是无限递归也不会让堆栈溢出。这也就是尾递归的好处。