---
layout: post
title: openSUSE环境配置
date: 2019-04-25 16:00:00
update: 2019-04-25 16:00:00
summary: 最近在看《TLPI》，书里面的习题和例程在mac下不是很好编译，darwin和linux的环境还是有所差异的，所以当选择Linux发行版的时候，我还是首选了大蜥蜴。
categories: Linux
tags: [Linux, Tech]
---

最近在看《TLPI》，书里面的习题和例程在mac下不是很好编译，darwin和linux的环境还是有所差异的，所以当选择Linux发行版的时候，我还是首选了大蜥蜴。

先简要介绍下我的pc，120G的ssd+1T的机械硬盘，我原本将Windows装在ssd上，openSUSE就放在了机械硬盘上，但是用起来体验实在是很差。于是将ssd分出了30G，来装openSUSE，感觉应该也完全足够了。下好了镜像，刻在U盘上，就可以直接安装了。

<!--more-->

## 换源

系统装好后，第一件事情是换源，考虑稳定性和速度，最后选择了中科大的源。openSUSE换源的话也只需要在`YAST`里面设置就好。还是比较容易操作的。换好源，一般会检查一下系统必须的一些软件，比如`vim`、`git`等。

## 科学上网

迫于国内环境，所以科学上网还是需要的。作为一个程序员，我们科学上网的目的并不是去做一些违法的事情，而是在符合国家法律的前提下，去境外正规网站学习提升自己。

### ss
首先安装的软件是`shadowsocks`，这里依赖的软件为`python3`以及`pip3`。

```bash
sudo pip3 install shadowsocks
```
不出意外应该可以成功。

`shadowsocks`分为server端和client端。我们这里肯定就是client端了。具体的配置方法请到github上参考。

```bash
sudo sslocal -c /etc/shadowsocks.json -d start
```

如果这时候启动成功了，恭喜你。如果失败了，请继续看。

```bash
 sudo vim /usr/local/lib/python3.6/dist-packages/shadowsocks/crypto/openssl.py
```

```
# vim中
# 修改地方1， 52行
libcrypto.EVP_CIPHER_CTX_cleanup.argtypes = (c_void_p,) 

libcrypto.EVP_CIPHER_CTX_reset.argtypes = (c_void_p,)

# 修改地方2， 112
libcrypto.EVP_CIPHER_CTX_cleanup(self._ctx) 

libcrypto.EVP_CIPHER_CTX_reset(self._ctx)
```

具体原因应该是openssl的版本所对应的API名称变了。

这时候再次启动，不出意外应该会成功。

### SwitchyOmega

这时候，你用浏览器打开某网站，发现还是打不开。不要心急，因为你还没有配置好。

sslocal只会在本地跑一个`SOCKS5`的服务，而你需要的是`HTTP`代理，所以走不通也很正常。

这里推荐大家一个chrome或者Firefox下的插件`Proxy SwitchyOmega`

Firefox是系统自带的浏览器，并且它并没有被墙，所以一切顺风顺水，去插件中心搜索插件，并安装配置就OK了。

### Chrome + SwitchOmega

但是我日常还是习惯Chrome浏览器。所以折腾到这里并没有结束。因为Firefox这时候已经拥有科学上网的能力了，所以直接去Google那里下载chrome的安装包就ok。如果你并没有搞Firefox，其实google.cn那里也可以下载Chrome。记得，要下`.rpm`的包。

下好后安装就ok

```bash
sudo rpm -ivh chrome.rpm
```

假如报错，应该是缺少依赖导致的，直接用`zypper`安装对应的依赖。

Chrome这时候可以正常打开了，但是它并没有能力科学，所以也就进入不了Chrome的应用商店，所以也就不能科学......

这仿佛是个`悖论`。而且最为可恶的是，google禁止`.crx`的安装包直接拖入安装。这点和几个月之前又有很大不同，几个月前的限制是必须是Google应用商店上架的拓展才能用`.crx`来安装，现在完全限死了。

唯一的办法，就是将`.crx`的安装包解压开，直接以dev的形式来安装。方法也很简单，将文件名修改，然后在命令行里面`unzip`就ok。（我发现openSUSE自带的Ark不能解压）。但是这种安装方式有个很大的问题，假如我把本地这些文件删了，我的插件也就没了。

最后，我去Chrome拓展商店找到了某不知名免费科学插件。安装好后，删除本地插件，再借用这个插件下好了`Proxy SwitchOmega`。真的心累。

### 开机启动

但是，当你重启后，你发现,怎么又连不上了。那肯定的，因为`sslocal`并没有在跑。于是，你又敲了一遍命令：

```bash
sudo sslocal -c /etc/shadowsocks.json -d start
```

嗯。好了。

但是总不能每次开机都这样吧？？？你写了个“脚本”，其实就是把这一串命令写到了文件里。

```bash
vim ssstart
......
sudo ./ssstart
```

但你还是不能忍受，这太low了。所以，请继续看。

你修改了脚本。写下了这些bash

```bash
#!/bin/sh
### BEGIN INIT INFO
# Provides:          shadowsocks
# Required-Start:    $remote_fs $syslog
# Required-Stop:     $remote_fs $syslog
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: start or stop shadowsocks 
# Description:       start or stop shadowsocks
### END INIT INFO

start(){
    sslocal -c /etc/shadowsocks.json -d start
}

stop(){
    sslocal -c /etc/shadowsocks.json -d stop
}

case "$1" in
start)
    start
    ;;
stop)
    stop
    ;;
reload)
     stop
     start
     ;;
*)
    echo "Usage: $0 {start|reload|stop}"
    exit 1
    ;;
esac
```

保存后运行。

```bash
sudo ./shadowsocks start
```

跑起来了。但是这个有啥差别呢，只是多了stop和reload而已。

你将它放到了`/etc/init.d/`中。

这样你就可以用service来开启服务了。

```bash
sudo service shadowsocks start
```

如果报错了？

```bash
sudo journalctl  -xe
```

看下错误日志来排查下原因。修改后，没问题了。

然后你输入了:

```bash
chkconfig
```

发现下面列出了

```
shadowsocks off
```
这证明，你的服务已经建立了，但是并没有开机启动。

于是你将它设为开机启动。

```bash
sudo chkconfig -s shadowsocks on
```

这时候在输入`chkconfig`,你会发现，它已经开启了。

如果你修改了配置文件，想要`reload`。也只需要

```bash
sudo service shadowsocks reload
```

同理，想停止：

```bash
sudo service shadowsocks stop
```

## TLPI编译环境

TLPI这本书算是Linux系统编程中的入门书籍。像类似这种经典书籍，通常都有自己的头文件，还有一些辅助函数。所以我们将这些头文件放入系统的include中，并且将辅助函数编译成[静态链接库](https://stackoverflow.com/questions/12237282/whats-the-difference-between-so-la-and-a-library-files)。

源码目录：[http://man7.org/tlpi/code/index.html](http://man7.org/tlpi/code/index.html)

下载好源码后，我们将其解压，进入目录。输入make进行编译。

这时应该会出现一些错误。

```
sudo zypper in  libacl-devel libcap-devel
```

通常都是缺少这两个依赖。其他错误可以查看官网的[FAQ](http://man7.org/tlpi/code/faq.html)

编译没错后，进入lib目录。

拷贝头文件：

```
sudo cp tlpi_hdr.h /usr/local/include/
sudo cp get_num.h /usr/local/include/
sudo cp error_functions.h /usr/local/include/
sudo cp ename.c.inc /usr/local/include/
```


制作dll：

```
gcc -c get_num.c error_functions.c
ar -crv libtlpi.a get_num.o error_functions.o
sudo cp libtlpi.a /usr/local/lib
```

这时候，来到你的目录环境：
```
gcc copy.c -ltlpi
```

环境ok。
