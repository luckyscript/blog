---
external: false
layout: post
title: 从Simple JavaScript Inheritance源码来谈js的原型链
date: 2017-11-15 16:00:00
update: 2017-11-15 16:00:00
summary: 最近写ES6写的比较多，对于面向对象方面用的还是比较顺手的， 但是说到底，ES6的class也就是js的语法糖而已，js的面向对象以及继承，底层的原理还是绕不开原型链。
categories: 前端技术 
tags: [前端, JavaScript]
---

最近写ES6写的比较多，对于面向对象方面用的还是比较顺手的， 但是说到底，ES6的class也就是js的语法糖而已，js的面向对象以及继承，底层的原理还是绕不开原型链。

有人说，谈原型链这些网上早已大篇文章，你写这篇意义又在哪呢?我也思考过这个问题，但是阅读了网上大多数文章，感觉良莠不齐，所以我想借助阅读jQuery作者的一小段源码来讲讲我复习原型链遇到的坑。
由于源码只有20几行（是的，我没有少打一个0），我就直接贴出来了。

```javascript

(function(){
  var initializing = false, fnTest = /xyz/.test(function(){xyz;}) ? /\b_super\b/ : /.*/;

  this.Class = function(){};

  Class.extend = function(prop) {
    var _super = this.prototype;

    initializing = true;
    var prototype = new this();
    initializing = false;

    for (var name in prop) {

      prototype[name] = typeof prop[name] == "function" && 
        typeof _super[name] == "function" && fnTest.test(prop[name]) ?
        (function(name, fn){
          return function() {
            var tmp = this._super;
             
            this._super = _super[name];

            var ret = fn.apply(this, arguments);        
            this._super = tmp;
             
            return ret;
          };
        })(name, prop[name]) :
        prop[name];
    }

    function Class() {

      if ( !initializing && this.init )
        this.init.apply(this, arguments);
    }

    Class.prototype = prototype;

    Class.prototype.constructor = Class;

    Class.extend = arguments.callee;
     
    return Class;
  };
})();
```
整个源代码，在一个自执行函数里。函数中，给window对象定了一个Class属性，并且Class拥有一个extend方法。

解读源码第一步:我们先看看怎么用。

```javascript
    var A = Class.extend({
        init: function () {
            this.name = 'A';
        },
        showName: function () {
            console.log(this.name);
        },
    });

    var B = A.extent({
        init: function () {
            this.name = 'B';
        },
    });

    var b = new B();

    b.showName() // 'B'
```

以上代码很轻易的实现了JavaScript的继承，而且让你摆脱了烦恼的prototype。


我们先来看这个功能：

```javascript
    var A = Class.extend({
        init: function () {
            this.name = 'A';
        },
        showName: function () {
            console.log(this.name);
        },
    });
```

那么我们试着自己来实现一下这个功能。
```javascript
window.Class = function () {}

Class.extend = function () {
    function A() {}
    A.prototype = new this();
    A.prototype.construct = A;
    return A;
}
```

几行代码而已，pofei！

但是我们怎么实现继承呢？
难道又要写一段`A.extent = ...`
？？？
当然不是写一段，而是写一句,对，作者写了一句
`A.extent = arguments.callee`
仔细想想，`arguments.callee`这个指针就代表当前方法，我们在js中写递归的时候会用到这样的方法，这里也是这种思想的提现。

那么，简单的继承和面向对象实现了，我们再来看看作者的源码，看看他还写了哪些东西。

```javascript
 var initializing = false, fnTest = /xyz/.test(function(){xyz;}) ? /\b_super\b/ : /.*/;
```

这个`initializing`先不谈，`fnTest`是啥意思...看了许久，没能明白，因为`/xyz/.test(function(){xyz;})`的返回值一直是true啊，那么这个三元运算符的意义何在？难道是大佬随便写的么？不可能。我去MDN上搜了下`test`方法，发现test的传参只能是`string`，但是我们这里传了一个function，浏览器内部是帮我们做了toString的操作的。那么是否在某些浏览器上不会toString所以返回false呢？我试了下（window7系统）在IE、Firefox、chrome都正常。
google一番后发现，IE6不支持...

心想在2017年应该不会有傻子还在用ie6了，但是同时又对作者心生佩服，写代码如此严谨。毕竟他们那个年代人们,IE的适配是前端的必备技能。

再来看这个`initializing`,
```javascript
 if ( !initializing && this.init )
        this.init.apply(this, arguments);
```
这里的这个判断，是因为我们new 了一个实例来进行继承的。所以父类的构造函数会执行多次，所以作者为什么不用`Object.create`方法呢，我想应该也是由于兼容问题的考虑吧。

以上。