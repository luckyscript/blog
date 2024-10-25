---
title: 从co源码来看Promise
date: 2018-03-12 12:04:41
external: false
permalink: /blog/2018/co-promise
category: FrontEnd
tags:
  - promise
author:
  name: luckyscript
  link: https://github.com/luckyscript
---

co源码库地址：[code](https://github.com/tj/co)

co是著名程序员[TJ](https://github.com/tj)的一个开源库，这个项目的初衷是解决异步回金字塔的问题。我们曾经在[后续传递(continuation)和回调(callback)的差别(https://github.com/luckyScript/blog/issues/7)中，提到过回调金字塔的优化方式，实现callcc函数，其实这种方式就是利用Thunk的方式来进行优化，Thunkify这个库工作原理也是如此。

我们今天谈到的co，在早起的版本也是通过这种方式来进行处理回调的问题，但是当Generator和Promise出现的时候，co便利用这两个特性很好的解决了这些问题。著名框架[koa1](https://github.com/koajs/koa/tree/1.4.1)便是利用了co模块作为解决异步问题的基础来实现的。



> 如果你对nodejs的异步工作原理不是很懂，建议你可以花几分钟先去了解一下，这可能更利于你理解本文的内容。



要阅读源码，我们先来看看它怎么用。

```
co(function* (){
    var fileName = yield readFile('./fileName.txt', 'utf-8');
    var fileContent = yield readFile(fileName, 'utf-8');
    return fileContent
}).then(console.log, console.error);
```

我们看这个代码，首先我们希望从`fileName.txt`中获取到fileName，然后再读名称为fileName这个的文件，最后返回文件内容。

如果不用co模块，我们写出来的代码可能是这样的：

```
content = function () {
    return readFile('./fileName.txt', 'utf-8', function (err, data) {
        return readFile(data, 'utf-8', function (err, data) {
            return data;
        })
    })
}
```
绕来绕去的明显不够直观。相比于co模块的用法，这种传统的代码简直会让人抓狂。

co模块的源码只有短短的240行。让我们就直入正题吧。

```
function co(gen) {
  var ctx = this;
  var args = slice.call(arguments, 1);
  return new Promise(function(resolve, reject) {
    if (typeof gen === 'function') gen = gen.call(ctx); // 如果gen是Generator，则执行
    if (!gen || typeof gen.next !== 'function') return resolve(gen); // 如果不是函数，则直接resolve
  ...
  }
```
co函数接收一个Generator，返回一个Promise对象。所以我们在执行完co之后，可以链式调用then的原因也是如此。

### 自动执行
自动执行Generator是co的重要特点。我们看Promise对象的函数中，执行了`onFulfilled()`。
```
function onFulfilled(res) {
      var ret;
      try {
        ret = gen.next(res); // 这是构造器的next方法
      } catch (e) {
        return reject(e);
      }
      next(ret); // 这个是名字为next的函数调用
      return null;
    }
```
可以看到这个函数调用了gen的next方法之后，调用了next()函数，gen是传入的Generator function，一般执行完gen的next方法，协程会将执行权交出。而next()函数一定就是co自动执行Generator的核心。

```
    function next(ret) {
      if (ret.done) return resolve(ret.value); // 如果gen.next已经执行完了整个构造器，那么直接resolve这个值。
      var value = toPromise.call(ctx, ret.value); 
      if (value && isPromise(value)) return value.then(onFulfilled, onRejected);
      return onRejected(new TypeError('You may only yield a function, promise, generator, array, or object, '
        + 'but the following object was passed: "' + String(ret.value) + '"'));
    }
```
可以看到next函数接收gen.next()的结果，这个结果是一个包含value和done的键值对，不在赘述。函数的第二行开始，给ret.value转化为Promise对象，然后再调用value.then(onFulfilled,onRejected)。问题来了，next函数执行完了，可是哪里调用了gen.next()呢？仔细看看onFulfilled，恩，已经讲过这个函数了。
co通过这种递归的方式，只要gen.next()没有完成就会一直执行下去。
而我们发现，co内部的状态管理，也是通过toPromise来构造成为Promise对象，使得能够处理好异步之间的关系。

我们来看看这个 toPromise方法：
```
function toPromise(obj) {
  if (!obj) return obj;
  if (isPromise(obj)) return obj; // 如果是Promise对象直接返回
  if (isGeneratorFunction(obj) || isGenerator(obj)) return co.call(this, obj); // 如果是generator函数，用co模块来返回Promise对象
  if ('function' == typeof obj) return thunkToPromise.call(this, obj); // Thunk函数
  if (Array.isArray(obj)) return arrayToPromise.call(this, obj); // arrayToPromise方法
  if (isObject(obj)) return objectToPromise.call(this, obj); //objectToPromise
  return obj;
}
```
```
function objectToPromise(obj){
  var results = new obj.constructor();
  var keys = Object.keys(obj);
  var promises = [];
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var promise = toPromise.call(this, obj[key]);
    if (promise && isPromise(promise)) defer(promise, key);
    else results[key] = obj[key];
  }
  return Promise.all(promises).then(function () {
    return results;
  });

  function defer(promise, key) {
    // predefine the key in the result
    results[key] = undefined;
    promises.push(promise.then(function (res) {
      results[key] = res;
    }));
  }
}
```
我们来看看典型的objectToPromise,主要实现方法是对obj的每一个键值对执行toPromise方法，通过Promise.all异步并行，将一个promise数组里的每个promise保存到相应的key里面。
对于co模块的解读，由于本人水平有限，有些地方可能理解的不足，还望指教。

## Promise
对于Promise，我觉得前端程序员应该都已经很熟悉了。promise拥有pending,fulfilled,rejected这几种状态，当执行了resolve或者reject之后，promise的状态会由初始的pending转化为fulfilled或者rejected。当然并不是你想的那样，resolve之后就是fulfilled的状态，当promise resolve一个reject的promise的时候，这时候就是rejected的状态。

同一个promise对象可以有多个then方法，这些then方法会在promise被resolve或者reject的时候，顺序调用。但是这个顺序调用的代码执行还是异步的。

```
const promise = Promise.resolve(1)
promise.then(setTimeout(()=>console.log(1), 100))
promise.then(console.log(2));
```
这段代码的输出为 2 1

Promise的then方法也可以链式调用，因为then方法本身返回一个新的Promise对象，且之前的onFulfilled或onRejected执行后返回值会作为下一个then方法的onFulfilled对象传入。
```javascript
promise.then(setTimeout(v=>console.log('first', v), 100)).then(console.log(2))
```
这段代码输出为2 1
可见.then方法的链式调用也是异步的，那么我们如何才能让其执行了前一个再执行后一个呢？
答案不是很明显么，用Promise或者可以返回then方法的实例
```
// 返回值为promise的实例
Promise.resolve(1)
  .then(v=> new Promise((resolve, reject)=>{
    setTimeout(()=> resolve(v+3), 3000);
  }))
  .then(v=>console.log(v)); //三秒后输出 4

// 返回值为含有then方法的对象
Promise.resolve(1)
  .then(v=>({
    then(resolve, reject){
      setTimeout(()=> resolve(v+2), 2000);
    }
  }))
  .then(v=> console.log(v)); //二秒后输出 3
```



