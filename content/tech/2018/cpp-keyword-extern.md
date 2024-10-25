---
title: C++中的extern关键字
date: 2018-07-24 16:00:00
external: false
permalink: /blog/2018/cpp-extern
category: cpp
tags:
  - cpp

---

extern关键字在C++中通常有三个作用

### 存储类指定符

extern作为存储类指定符的时候，被声明的对象具有静态存储期。
所谓静态存储期就是和static以及全域变量一样，在程序的运行周期都存在。

```
// extern.h
extern int e;
```

```
// extern.cc
int e = 0;
```

```
//main.cc
#include "extern.h"
void fun()
{
	e++;
	cout << e << endl;
}
int main()
{
	fun();
	fun();
}
```

运行这段代码：
```
$ g++ extern.cc main.cc
$ ./a.out
1
2
```
<!--more-->
可以看到控制台输出1和2。

当然，用extern声明和不用extern有什么差别呢？

```
extern int i;
int j;
```
以上这段代码，声明了i但是未定义，声明了j并且定义了j。

所以 extern常用作文件之间的变量共享。尤其是一些const对象，尤其是一些const对象，它的初始值不是一个常量表达式，但是有需要在文件内共享。这个时候我们就需要用到extern表达式了。

### C++调用C语言的函数

C++作为C语言的超集，应该是可以直接和C语言进行调用的。但是又由于C++和C语言存在诸多不同点，所以在生成对象文件的时候，其符号表(symbol tables)存在一些不同，导致链接失败。

举个例子：
假如有一个函数 
int add(int, int);

在C语言的符号表中我们可以直接叫做`add`，但是如果在C++的符号表中，我们也叫做`add`就会有问题，因为C++是允许函数重载的。所以在C++中符号表很可能就是`addii`。就是因为这种原因，导致我们在C++中调用C语言的函数的时候，会找不到对应的函数。而extern关键字在这里又有一个比较特殊的作用。

我们先不用extern开始实现一个C++调用C的例子：

```
// add.c
int add(int x, int y) {
	return x + y;
}
```

```
//add.h
int add(int x, int y);
```

```
// addp.cc
#include "add.h"
int main () {
	int x = 1;
	int y = 2;
	cout << add(x, y) << endl;
}
```
先编译C语言,再和C++文件一起编译
```
$ gcc -c add.c
$ g++ addp.cc add.o
```
发现编译报错：
```
/tmp/ccX07K44.o: In function `main':
addp.cc:(.text+0x21): undefined reference to `add(int, int)'
collect2: error: ld returned 1 exit status
```

然后我们看一下符号表
```
$ objdump add.o -t
```
![](/public/upload/cppextern1.png)
同理 再看一下C++生成的符号表

![](/public/upload/cppextern2.png)
果然不一样。

于是我们加上extern关键字

```
//add.h
extern "C" {
	int add(int x, int y);
}
```

接着编译运行，一路顺风。

这时候我们看一下C++的符号表：

![](/public/upload/cppextern3.png)
果然一样了呢。

### 模板的实例化控制
在比较大的项目中，对于一些模板的运用比较频繁。如果在多个独立编译的文件中用了相同的模板并且提供了相同的类型参数的时候，每个文件都会生成一个模板的实例，这是我们不愿意看到的。
所以
```
extern template declaration; //实例化声明
template declaration;        //实例化定义
```
extern在这种情况下就显得比较有意义。

以上，欢迎吐槽。