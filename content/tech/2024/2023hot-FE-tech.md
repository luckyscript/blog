---
title: 2023热门前端技术
date: 2024-01-01 16:37:10
external: false
permalink: /blog/2024/2023-hot-FE-tech
category: FE
tags: 
  - FE
  - Node.js
author: 
  name: luckyscript
  link: https://github.com/luckyscript
sidebar: auto
---
2024年的第一篇博客，打算和大家分享一下2023年前端比较火的一些技术。我自己的一个感觉是，国内外的前端的发展路径还是有一些差异的，例如今年最火的 `shadcn-ui` 这个项目，是今年JS语言所有的项目中获得Star最多的，但是发现国内鲜有文章讨论。

定时去看看国内外目前比较火的一些项目，看看人家的一些设计思路，避免自己的技术思维太局限。我挑了以下几个比较热门的项目，主要分析其设计思路。

## shadcn/ui

shadcn/ui 是一个基于React的组件库，但是官方网站却明确说自己不是组件库，一方面来说他的UI是基于RadixUI  和 Tailwind CSS的，另一方面是他的组件的分发并不是基于NPM的，而是官方提供了一个命令，通过输入命令会直接将组件的源码直接Copy到当前项目仓库中。

shadcn/ui 的流行于 **Tailwind CSS** 以及 对于**React Server Component**兼容密切相关。我觉得其设计的宗旨是便于进行二次定制开发。通过源码注入的方式相比npm包的引入具有更大的灵活性，RadixUI本身是一个不包含样式的`无头组件库`，shadcn/ui 的本质是帮用户写了一个默认的样式，而这个样式我们可以更灵活的更改。

```
// 依赖tailwindcss
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

npx shadcn-ui@latest init
✔ Would you like to use TypeScript (recommended)? … no / yes
✔ Which style would you like to use? › Default
✔ Which color would you like to use as base color? › Slate
✔ Where is your global CSS file? … app/globals.css
✔ Would you like to use CSS variables for colors? … no / yes
✔ Are you using a custom tailwind prefix eg. tw-? (Leave blank if not) …
✔ Where is your tailwind.config.js located? … tailwind.config.js
✔ Configure the import alias for components: … @/components
✔ Configure the import alias for utils: … @/lib/utils
✔ Are you using React Server Components? … no / yes
✔ Write configuration to components.json. Proceed? … yes

✔ Writing components.json...
✔ Initializing project...
✔ Installing dependencies...

Success! Project initialization completed.

npx shadcn-ui@latest add button

✔ Done
```

自动生成的组件

```
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
```

使用Button

```
import { Button } from "@/components/ui/button"
 
export default function Home() {
  return (
    <div>
      <Button>Click me</Button>
    </div>
  )
}
```


## Bun

Bun 大家应该都很熟悉，按照官方的描述，Bun是一个高性能的Node.js运行时，包管理器，打包器，测试命令，可谓是前端一条龙服务。

在2022年是获得Star最多的项目，在23年，Bun发布了第一个正式版本。

Bun设计思路就是为了替代Node.js的，因此相比于Node.js除去4倍的性能优势外，Bun几户考虑到了现代前端的所有场景。简单举两个例子：

1. 默认可以运行js、ts、jsx等文件，因此不需要依赖babel、tsc、ts-node等编译插件。
2. bun本身就是一个JS打包器，因此也不需要webpack、esbuild这些构建工具了。

```
Bun is a fast JavaScript runtime, package manager, bundler, and test runner. (1.0.14 (d8be3e51))

Usage: bun <command> [...flags] [...args]

Commands:
  run       ./my-script.ts       Execute a file with Bun
            lint                 Run a package.json script
  test                           Run unit tests with Bun
  x         eslint               Execute a package binary (CLI), installing if needed (bunx)
  repl                           Start a REPL session with Bun

  install                        Install dependencies for a package.json (bun i)
  add       next-app             Add a dependency to package.json (bun a)
  remove    @zarfjs/zarf         Remove a dependency from package.json (bun rm)
  update    moment               Update outdated dependencies
  link      [<package>]          Register or link a local npm package
  unlink                         Unregister a local npm package
  pm <subcommand>                Additional package management utilities

  build     ./a.ts ./b.jsx       Bundle TypeScript & JavaScript into a single file

  init                           Start an empty Bun project from a blank template
  create    zod                  Create a new project from a template (bun c)
  upgrade                        Upgrade to latest version of Bun.
  <command> --help               Print help text for command.

Learn more about Bun:            https://bun.sh/docs
Join our Discord community:      https://bun.sh/discord
```

## Tailwind CSS

tailwindcss 我感觉是目前国外最火的项目了，TailwindCSS的核心理念是提供原子化的CSS，每一个类名代表着一个样式。

我第一次接触Tailwind CSS的时候，是22年重构了一版本博客，当时选择了Astro + Tailwind CSS的方案。我对Tailwind的第一反应是，这玩意不就是另一种inline css么，按照我之前一贯的想法HTML内应该是干净整洁的。而Tailwind CSS的方案很明显违反了这一原则。


但是一个项目，存在即合理，尤其是当这个项目这么火的时候，一定是有什么优势能让别人忽略掉这个技术所带来的劣势。

```
<figure class="bg-slate-100 rounded-xl p-8 dark:bg-slate-800">
  <img class="w-24 h-24 rounded-full mx-auto" src="/a.jpg" alt="" width="384" height="512">
  <div class="pt-6 space-y-4">
    <blockquote>
      <p class="text-lg">
        “Tailwind CSS is the only framework that I've seen scale
        on large teams. It’s easy to customize, adapts to any design,
        and the build size is tiny.”
      </p>
    </blockquote>
  </div>
</figure>
```

我觉得主要是因为CSS这个东西还是有一些痛点的：

1. CSS的上手成本其实不低，尤其是对于非前端的人员来说，上手CSS的成本比上手JS的成本要高得多。
2. 复杂CSS实现的成本较高，耗费大量的开发时间。例如：复杂动画、响应式设计等。
3. 技术人员用CSS很难写出比较美的样式。
4. 书写样式过的过程需要大量定义class、className
5. HTML、CSS的分离 带来开发过程额外关注点的分离。
6. CSS 打包出来的体积比较大。CSS复用的难度比较高，虽然油Saas的Mixin等方案，但是实现起来也比较繁琐。

Tailwind CSS的设计思想可以最大程度上去复用这些样式，这种原子化的方案也能避免CSS难以维护的问题。它提供的原子化的CSS基本上可以覆盖日常90%的开发所需要的样式，因此也基本不需要再去写CSS。同时还能满足高定制化的诉求。

当然我觉得Tailwind CSS的缺点也比较明显：

1. 如果样式太复杂， 那么dom节点也比较复杂，可读性会极具下降。更别提tailwind css支持的dark、hover的这种模式的样式也需要写在class中。
2. 有一定学习成本，对于熟悉写CSS的人来说，切换到这种形式可能一开始不是很习惯，不过我理解配合一些IDC的插件可以减少这种问题。

## React Server Component

React 在21年年初就发布了服务端组件的草案。React组件本质上就是一个函数，在浏览器的运行时内可以执行，在浏览器端同样也能运行。但是因为运行时存在一些差异性，所以在组件的实现上以及功能点上都有不同。

RSC和我们之前聊的SSR在原理上类似，但是他们的确是两件事情。SSR的本质是将整个页面在服务端计算成HTML，然后由浏览器直接渲染HTML。相比于CSR，SSR主要有以下好处：

1. SEO 【例如一些企业的官网如果完全是CSR，那么搜索引擎可能会一直不收录】
2. 首屏加载速度更快。

但是SSR方案由于每次请求都会需要服务端重新渲染页面，如果是一些千人千面的场景，采用SSR且无法做缓存的场景，对于服务器的开销就会比较大。在应对高并发的场景就会有稳定性风险。

而我们今天提的RSC则和SSR没有太大的关联，按照React的官方的说法，React将组件分为Client Components和Client Compoents，官方推荐服务端组件负责那种轻交互重展示的组件，客户端组件负责那种重交互的场景。

在React团队的官方演示中，服务端组件和客户端组件是可以相互嵌套的。就和我们日常书写React的代码没有差别，只是其中的一部分在客户端执行渲染逻辑，其中一部分在服务端执行渲染逻辑。不过自己去看文档发现还是有一些限制的，这里就不展开了。

大致渲染过程：

1. 服务端接受fetch请求，并将root组件渲染为一棵包含基本的HTML标签和客户端组件的占位符的树。序列化成后发送给浏览器。
2. 浏览器反序列化这颗树，开始重建React树，用真正的客户端组件填充客户端组件占位符，最终渲染出最终的效果。

对于RSC来说，本质上并不是彻底的服务端渲染。页面本身仍然是和CSR一样的最基础的模板，RSC则是通过Fetch请求来获取到序列化后的树。那么这样的好处是什么？

我们在纯Client组件场景下，一些偏展示型的组件中，某些数据依赖于接口，我们过去的逻辑是请求接口获取到数据然后再交给客户端组件进行渲染。而现在的逻辑则是直接从服务端拿到一个可以展示的组件。这个逻辑是好是坏，我觉得这个得分场景。

一个最简单的例子是Markdown，如果有前端进行解析Markdown，则需要在js中引入**Marked**这些包，这些包需要在每一个浏览器中都被下载。而如果利用RSC的方式，则不需要。

