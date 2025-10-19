import prism from 'prismjs'

// 使用 Prism 自带的加载器来加载语言组件
if (typeof window === 'undefined') {
  // 在服务端环境加载语言组件
  try {
    // 加载核心语言
    require('prismjs/components/prism-markup')
    require('prismjs/components/prism-css')
    require('prismjs/components/prism-javascript')
    require('prismjs/components/prism-java')
    
    // 加载其他语言
    require('prismjs/components/prism-c')
    require('prismjs/components/prism-clojure')
    require('prismjs/components/prism-cpp')
    require('prismjs/components/prism-csharp')
    require('prismjs/components/prism-dart')
    require('prismjs/components/prism-docker')
    require('prismjs/components/prism-elixir')
    require('prismjs/components/prism-go')
    require('prismjs/components/prism-json')
    require('prismjs/components/prism-julia')
    require('prismjs/components/prism-kotlin')
    require('prismjs/components/prism-lua')
    require('prismjs/components/prism-markdown')
    require('prismjs/components/prism-pascal')
    require('prismjs/components/prism-php')
    require('prismjs/components/prism-python')
    require('prismjs/components/prism-ruby')
    require('prismjs/components/prism-rust')
    require('prismjs/components/prism-sql')
    require('prismjs/components/prism-typescript')
    require('prismjs/components/prism-yaml')
  } catch (error) {
    console.warn('Failed to load Prism languages:', error)
  }
}

export default prism