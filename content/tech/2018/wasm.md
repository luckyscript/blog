---
title: WASM初体验
date: 2018-05-31 16:00:00
external: false
permalink: /blog/2018/wasm
category: Node.js
tags:
  - Node.js

---

WebAssembly无疑是前端将来一个很重要的发展方向。

在下好编译环境之后，我开始了自己的wasm探索之路。

```c
long fib(int num) {
    if(num == 1)
        return 1;
    if(num == 2)
        return 2;
    return fib(num-1) + fib(num-2);
}
```
写了一个最简单的fib函数，写完后用emcc编译成wasm文件。

```bash
emcc fib.c -O1 -s WASM=1 -s ONLY_MY_CODE=1 -s EXPORTED_FUNCTIONS="['_fib']" -o fib.js
```
<!--more-->
-O1是对代码的优化程度，这个我觉得是和LLVM的静态优化相关？还没有详细了解。
ONLY_MY_CODE 这个是告诉编译器，只输出我们自己的代码，一些库文件中的不输出。
EXPORTED_FUNCTIONS 这个告诉编译器我们想输出的函数。

最后，编译好之后，生成一个`.wasm`和一个`.js`文件。
我们这里只用`.wasm`文件

由于现在js还不能通过模块化的方式加载文件，html也无法通过script标签来引入wasm格式的内容。所以我们只能用ajax或者fetch来取得内容。
```js
// Fetch
fetch('./fib.wasm').then(response => 
    response.arrayBuffer()
).then(bytes =>   {
    return WebAssembly.instantiate(bytes, importObj)
}).then(result => {  
    alert(result.instance.exports._fib(6)
})
```
fetch是一个promise操作 所以我们也可以更优雅的写成async/await这种形式。

当然在js中还是要做一些配置的。
```js
// Memory
const memory = new WebAssembly.Memory({initial: 256, maximum: 256});

const importObj = {
    global: {},
    env: {
        abortStackOverflow: () => { throw new Error('overflow')},
        memory: memory,
        table: new WebAssembly.Table({initial: 0, maximum: 0, element: 'anyfunc'}),
        tableBase: 0,
        memoryBase: 0,
        STACKTOP: 0,
        STACK_MAX: memory.buffer.byteLength
    }
}
```