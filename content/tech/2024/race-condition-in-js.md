---
title: JavaScript中的竞态问题
date: 2024-07-04 10:18:12
external: false
permalink: /blog/2024/race-condition-in-js
sidebar: auto
category: JavaScript
tags:
  - JavaScript
author:
  name: luckyscript
  link: https://github.com/luckyscript
---

竞态条件问题一般出现在多线程语言中，多线程去操作某个实体的时候，如果没有锁的机制，那么执行相同的代码可能会带来不同的结果。

 JavaScript是一个典型的单线程语言，但是在异步编程中，由于异步方法执行顺序的不可控，仍然会经常碰到竞态条件问题。

## 案例分析

一个很常见的案例是搜索框，假设我们现在需要去搜索`abcd`这个内容，需求是在用户输入后就去调用接口查出结果并且渲染。

因此，如果我们在不做任何节流的情况应该会发出如下四次请求：
1. 用户输入a，请求a的结果，渲染a的结果
2. 用户输入b，请求ab的结果，渲染ab的结果
3. 用户输入c，请求abc的结果，渲染abc的结果
4. 用户输入d，请求abcd的结果，渲染abcd的结果

前端代码应该是类似下面这种：

```javascript
fetch('/search?keyword=abcd').then(res => {
	// render res
})
```
也就是说，当接口返回后，我们的回调执行渲染逻辑，并将结果渲染，而这个回调将会有四次，我们的渲染也会按照最后一次回调的结果。最后一次回调的结果是搜索abcd的结果吗？

显然，不一定。

由于请求本身是异步的，因此我们可以假设一个很特殊的场景，服务端搜索a由于数据量很大需要花10秒时间，但是搜索其他三个只需要花0.1秒的时间。那么在上述场景中，a的结果将是最后一次回调的，我们也很容易就将这个结果作为最终值去渲染了。

另一个很常见的案例是分页列表的操作，在用户迅速点击分页切换按钮的时候，假设这个查询接口延时有一定随机性且较慢的场景，那么很容易也会出现最终选中的分页和正在渲染的分页不一致的场景。

以上这两种case就是很典型的竞态场景，虽然JavaScript是单线程运行，但是由于异步回调顺序的不确定性，如果渲染的正确性依赖回调的返回顺序，那么就很可能渲染bug。

## 如何解决

### 悲观锁策略

悲观锁的策略，简而言之就是我同时只能允许你进行一个请求。也就是说，上一个请求没回调之前我就不发出下一个请求。

我们经常会在点击按钮发出请求后，将这个按钮置为loading态，使得用户在loading态点击时不会触发下一个请求。这个就是悲观锁策略的一个很常见的实现。

```javascript
function ButtonFetch({ children }) {
	const [loading, setLoading] = useState(false);

	const doFetch = useCallback(() => {
		if (loading) {
			return;
		}
		setLoading(true);
		fetch('xxx').finialy(() => {
			setLoading(false);
		})
	}, [loading])
	return (
		<Button onClick={doFetch} loading={loading}>{children}</Button>
	)
}
```


### 乐观锁策略

相较于悲观锁，乐观锁的策略则没那么严格。乐观锁采用一种版本记录的方式，来放弃已经过期无效的请求，我们直接来看下如何实现：

```javascript
const version = 0;
function ButtonFetch({ children }) {
	const doFetch = () => {
		const myVersion = version++;
		fetch('xxx').then(() => {
			if (myVersion === version) {
			 // handler
			} else {
			// 无效请求，放弃就好
			}
		})
	})
	return (
		<Button onClick={doFetch}>{children}</Button>
	)
}
```

无论是乐观锁策略，还是悲观锁策略，都可以解决竞态条件带来的问题。悲观锁策略本质上就认为多次发请求这个行为就是有问题的，因此我要从源头遏制。乐观锁策略则认为，多次发请求是没问题的，我通过一定的手段来避免过期的请求给我造成影响即可。

这两种方案，在不同的交互场景上都会有运用，带来的用户体验也是完全不一样。我们需要根据实际的情况去合理选择。

## 其他实现

### 取消异步操作
虽然原生的Promise并不支持取消，但是我们仍然可以给Promise增加一个cancel的方法，本质上就是让Promise提前reject掉。

另外，在异步场景最多的网络请求场景下，浏览器是有一些取消请求的机制的。因此，在后发出请求之前，我们也可以主动将前置的请求给cancel掉。
浏览器推出的AbortController可以使我们更好的来控制好网络请求。
https://developer.mozilla.org/zh-CN/docs/Web/API/AbortController

### RxJS

switchMap

### Redux saga

redux saga提供了 takeLatest辅助函数来协助我们去处理副作用中的race condition

### ahooks

useRequest

## 思考

节流能否解决这个问题？