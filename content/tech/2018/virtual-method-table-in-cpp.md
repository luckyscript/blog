---
title: C++中的虚函数表
date: 2018-08-24 00:00:00
external: false
permalink: /blog/2018/virtual-method-table-in-cpp
category: C++
tags:
  - C++

---

最近闲逛v2ex的时候，发现了这么一个帖子：[求助 C++大神看一个问题](https://www.v2ex.com/t/481897)。

点进去一看代码，一脸懵逼，这是啥。。。
```cpp
class B {
public:
    virtual void foo() {}
};
class D: public B {
public:
    D() : mA(0) {}
    virtual void foo() {
        cout<<"D::foo::mA "<<mA<<endl;
    }
    int mA;
};
int main() {
    D d1;
    D* pD = &d1;
    cout<<pD<<endl;
    typedef void (*PFun)();
    PFun fun =  (PFun)((long *)*((long *)*(long*)(pD))); //???
    fun();
    cout<<"D::pD::mA: "<<pD->mA<<endl;
}
```
<!--more-->

`PFun fun =  (PFun)((long *)*((long *)*(long*)(pD)))`看到这行代码的时候，我整个人都是拒绝的。但是当我重新扶扶黑框眼镜的时候，我发现事情并没有这么`复杂`。

首先我们来逐步分析一下这段代码。
1. B是一个基类，并且拥有一个虚函数`foo`

2. D是一个派生类，继承于B。D的构造函数中初始化了成员变量mA。D也有一个虚函数，这个虚函数打印了mA并且由于名称也是`foo`所以会重写基类的虚函数。

3. 在主函数中，我们先实例化了D类的对象d1，取得d1的地址 `pD`,pFun是一个指针函数。

4. 再最长的那一行里，我们将一个void函数fun定义为pD指向的对象的首地址指向的某个东西的首地址。

5. 接着调用fun。然后打印mA。

再来把目光聚焦在`PFun fun =  (PFun)((long *)*((long *)*(long*)(pD)))`这里。
这里我们可以做一些简化，这段代码应该等同于`PFun fun =  (PFun)(*(*(long**)(pD)))`
这样就清晰多了。
我们再不妨再msvc中看看pD的内存分配。
![](/public/upload/cppvmt3.PNG)

这里我们看到`pD`被强制转成一个二级指针。那么问题来了，这个指针指向哪里呢？这就是我们标题谈到的`虚函数表`

关于虚函数的基本概念,可以去 [](https://en.cppreference.com/w/cpp/language/virtual)了解一下。其中最关键的一个概念是`运行时多态`。

我们先来了解一下，类中的内存分布情况。

1. 空的类

```
class A {
};
cout << sizeof(A) << endl; // 1
```

一个空的类，它的大小是1而不是0.
并且以下类的大小也是1

```
class B: public A {
};
class C : public A {
	char x;
};
```

2. 有成员变量的类

```
class A {
	char x;
	int y;
};
```

![](/public/upload/cpp-vmt.png)

但是打印出`sizeof(A)`的时候，结果是8字节而不是想象的5字节。这里 就和内存的字节对齐有关系了，这里不赘述。

3. 有成员函数的类

```
class A {
	char x;
	int y;
	void print() {}
}
```
打印出`sizeof(A)`,结果仍然为8。说明成员函数并没有存在类里面。

4. 有虚函数的类

```
class A {
	char x;
	int y;
	virtual void print() {}
}
```

![](/public/upload/cpp-vmt2.png)
打印出`size(A)`结果为12。是不是很神奇。那么对比上面，多出的4个字节存了什么呢？

答案就是今天的主题`虚函数表`。

可以看到`_vfptr`是一个指向指针数组的指针。而这个指针数组存放的是类里面的虚函数指针。

这也是为啥本文一开始提到的代码可以执行的原因。通过类型转换的手法强行取到虚函数表中的函数执行。这种写法是不可取的，但是我们作为程序员也要能从现象看到本质。

关于虚函数表，本文暂且讲到这里。有关`继承`以及`多继承`中虚函数表的内存表现形式，读者可以自行调试，不再赘述。
