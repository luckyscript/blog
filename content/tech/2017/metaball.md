---
title: Metaball算法的简易实现
date: 2017-10-07 16:00:00
external: false
permalink: /blog/2017/metaball
category: FE
tags:
  - JavaScript

---

记得之前大二的时候，球球大作战这款游戏还比较火。虽然服务器在国外比较炸，但是球与球接触时的动画非常逼真，当时想了好久都不知道怎么做，后来有一次看到了贝塞尔曲线，才明白原来这个东西再工业界早已应用广泛。

metaball算法的实现也是基于贝塞尔曲线，在一些应用，比如qq消息的小红点消除都是用的这个算法。
效果如图：


下面给出算法的实现代码：
```javascript
        var canvas = document.querySelector('#canvas');

        canvas.width = 800;
        canvas.height = 600;

        var ctx = canvas.getContext('2d');
        
        var radius = 50;
        var arc1 = {
            x: 100,
            y: 100
        },
        arc2 = {
            x: 400,
            y: 400
        },
        controlP = {
            x: (arc1.x + arc2.x)/2,
            y: (arc1.y + arc2.y)/2
        }
        var distance = Math.sqrt((arc1.x - controlP.x)*(arc1.x - controlP.x) + (arc2.y - controlP.y)*(arc2.y - controlP.y));
        var angleA = Math.acos(radius/distance);

        var angleB = Math.acos((controlP.x - arc1.x)/distance);
        var off1 = {
            x: (radius * Math.cos(angleA - angleB)),
            y: (radius * Math.sin(angleA - angleB))
        }
        var point1 = {
            x: arc1.x + off1.x,
            y: arc1.y - off1.y
        }

        var angleC = Math.asin((controlP.x - arc1.x)/distance);
        var off2 = {
            x: (radius * Math.sin(angleA - angleC)),
            y: (radius * Math.cos(angleA - angleC))
        }
        var point2 = {
            x: arc1.x - off2.x,
            y: arc1.y + off2.y
        }

        var angleD = Math.acos((arc2.y - controlP.y)/distance);
        var off3 = {
            x: (radius * Math.sin(angleA - angleD)),
            y: (radius * Math.cos(angleA - angleD))
        }
        var point3 = {
            x: arc2.x + off3.x,
            y: arc2.y - off3.y
        }


        var angleE = Math.acos((arc2.x - controlP.x)/distance);
        var off4 = {
            x: radius * Math.cos(angleA - angleE),
            y: radius * Math.sin(angleA - angleE)
        }
        var point4 = {
            x: arc2.x - off4.x,
            y: arc2.y + off4.y
        }


        ctx.beginPath();
        ctx.arc(arc1.x, arc1.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.closePath();

        ctx.beginPath();
        ctx.arc(arc2.x, arc2.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.closePath();

        ctx.beginPath();
        
        ctx.arc(controlP.x, controlP.y, 1, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.closePath();

        ctx.beginPath();
        ctx.moveTo(point1.x, point1.y);
        ctx.quadraticCurveTo(controlP.x, controlP.y, point3.x, point3.y);
        ctx.stroke();
        ctx.closePath();

        ctx.beginPath();
        ctx.moveTo(point2.x, point2.y);
        ctx.quadraticCurveTo(controlP.x, controlP.y, point4.x, point4.y);
        ctx.stroke();
        ctx.closePath();
```

