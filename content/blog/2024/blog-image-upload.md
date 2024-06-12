---
external: false
layout: post
title: 博客图片上传方案-使用PicGo上传图片
date: 2024-06-12 19:19:07
update: 2024-06-12 19:19:07
category: Blog
tags: Blog
---

写博客，上传图片资源是一件很常见的事情。我在去年把博客从自建迁移到Github Pages上，但是总感觉图片上传非常难受。

博客采用Markdown进行编写，需要上传图片时，只能把图片资源放在项目仓库的`Static`之类的文件夹下，然后再在博客内部进行引用。这种方案非常机械且人肉，上传一张图片大概需要花费30秒的操作时间，效率低且容易出错。

---
### PicGo

前一段时间，我在找类似的解决方案，在Github上看到了PicGo这个工具。

[PicGo/PicGo-Core](https://github.com/PicGo/PicGo-Core)

PicGo 基于Typescript编写，本质上是对接了各个图床的API实现了文件上传的功能。PicGo-Core是核心的命令行工具，同时也是插件化的架构设计。

```typescript
/**
   * easily mannually load a plugin
   * if provide plugin name, will register plugin by name
   * or just instantiate a plugin
   */
  use (plugin: IPicGoPlugin, name?: string): IPicGoPluginInterface {
    if (name) {
      this.pluginLoader.registerPlugin(name, plugin)
      return this.pluginLoader.getPlugin(name)!
    } else {
      const pluginInstance = plugin(this)
      return pluginInstance
    }
  }

```


PluginLoader 的实现代码可见：[PluginLoader.ts](https://github.com/PicGo/PicGo-Core/blob/dev/src/lib/PluginLoader.ts)

PicGo的插件本质上就是一个函数，参数为picgo实例，函数的返回值包含了register这个方法，在插件注册后，PicGo这个核心会默认调用register这个方法。我们可以通过getPlugin来获取到插件本身，从而调用插件抛出的其他函数。

代码细节不做过多评价，这套插件的设计值得借鉴，尤其在做一些可扩展性设计的时候，插件式的架构是相对容易的。

我们在Github上，也看到了很多PicGo的插件。[Awesome-PicGo](https://github.com/PicGo/Awesome-PicGo)

---

### Obsidian

Obsidian是我现在常用的Markdown写作工具，也是插件化式的设计，PicGo和Obsidian也有联动的插件。

[Obsidian Image AutoUpload Plugin](https://github.com/renmu123/obsidian-image-auto-upload-plugin)

因此，结合这两个工具，现在可以实现，将图片拷贝至剪贴板，然后直接粘贴进Obsidian中，即可完成图片的上传以及博文的引用。

以上，这是我现在在用的感觉还算比较优雅的图片上传的方案。
