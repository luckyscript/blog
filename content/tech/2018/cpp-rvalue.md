---
title: C++中的rvalue
date: 2018-07-24 16:00:00
external: false
permalink: /blog/2018/cpp-rvalue
category: cpp
tags:
  - cpp

---

## 左值和右值

```C
int a = 3;
// a is lvalue, 3 is rvalue
```

学C的时候，对左值的概念是既能出现在表达式等号左边，又能出现在右边的变量；右值是只能出现在等号右边的量。
但是C++中，这两个的定义更加晦涩一点。《C++ primer》中这样定义这两个的差别

> 当一个对象被用作右值得时候，用的是对象的值；当对象被用作左值得时候，用的是对象的身份。

这个定义还是略显抽象，但是我们可以看出，我们往往关注表达式中的左值所代表的内存地址，对于右值，我们更关注这个值是多少。
同样，C++中，左值可以当做右值对象用，但是右值不能当成左值用。当一个左值被当成右值用的时候，实际上是使用的它的值。

```C
int a;
3 = a;
```
这样的定义明显是不合法的。

***

## 差别

提炼出以下差别。
1. 左值指的是可以取地址的变量，左值与右值的根本区别在于能否获取内存地址，而能否赋值不是区分的依据。通常临时量均为右值。
2. 对于基础类型右值是不可以被修改的，对于自定义类型，右值可以通过它的成员函数来修改。
3. 左值具有持久的状态，右值要么是字面常量，要么是在表达式求值过程中的临时对象。

***

## 右值引用

右值引用是C++11中新的特性，C++中用&&来获得右值引用，为了和右值引用区分，我们可以将常规引用称作左值引用。

```c
int i = 10;
int &r = i;
int && rr = i; // error
int && rr1 = i*10;
const int &r3 = i*10; // 我们将一个const引用绑定到一个右值上
```
当一个右值被 const 引用指向时，它的生命周期就被延长了。

### 移动构造函数

移动构造函数是右值引用的一个典型代表了，同时它也是C++11里面的新特性。移动构造函数顾名思义就是将一个东西给转移走，所以它的构造函数参数是一个右值引用。

```cpp
Constructor(Constructor &&c) {
...
}
```

一个典型的利用移动构造函数的例子是stl中的`move`。

```cpp
string st = "Hello world";
vector<string> vc ;
vc.push_back(move(st));
cout<<vc[0]<<endl;
if(!st.empty())
	cout<<st<<endl;
```

运行以上例子，发现只打印了一次。说明st这个字符串在调用move后，已经是空的了。

## xvalue

expiring value, x值，指通过“右值引用”产生的对象。

对于函数调用，根绝返回值类型不同，可以是lvalue、xvalue、prvalue:

* The result of calling a function whose  return type is an lvalue reference is an lvalue.
* The result of calling a function whose return type is an rvalue reference is an xvalue.
* The result of calling a function whose return type is not a reference is a prvalue.

***

#### 参考
* [c++中的左值与右值](http://www.cnblogs.com/catch/p/3500678.html)
* [C++左值与右值？](https://www.zhihu.com/question/26203703)