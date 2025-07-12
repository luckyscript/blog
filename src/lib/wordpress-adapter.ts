import { wordpressAPI, type WordPressPost, type WordPressCategory, type WordPressTag } from './wordpress';
import type { z } from 'zod';
import Markdoc from "@markdoc/markdoc";
import { config } from "./markdoc/markdoc.config";

// 适配WordPress数据为Astro现有格式的接口
export interface AdaptedPost {
  slug: string;
  content: any; // Markdoc AST
  brief: any; // 摘要的Markdoc AST
  rawContent: string;
  frontmatter: {
    title: string;
    date: Date;
    update?: Date;
    description?: string;
    category?: string;
    tags?: string[];
    external?: boolean;
    ogImagePath?: string;
  };
  html: string;
}

export interface AdaptedBlog {
  year: string;
  posts: AdaptedPost[];
}

// 将WordPress日期字符串转换为Date对象
function parseWordPressDate(dateString: string): Date {
  return new Date(dateString);
}

// 从WordPress内容中提取摘要
function extractExcerpt(content: string, maxLength: number = 200): string {
  // 移除HTML标签
  const plainText = content.replace(/<[^>]*>/g, '');
  // 截取指定长度
  if (plainText.length <= maxLength) {
    return plainText;
  }
  return plainText.substring(0, maxLength) + '...';
}

// 解析Markdown内容为Markdoc AST
async function parseMarkdownToAST(content: string) {
  try {
    const ast = Markdoc.parse(content);
    const errors = Markdoc.validate(ast, config);
    if (errors.length) {
      console.error('Markdoc validation errors:', errors);
      // 返回简单的AST作为fallback
      return { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', content }] }] };
    }
    return Markdoc.transform(ast, config);
  } catch (error) {
    console.error('Error parsing markdown:', error);
    // 返回简单的AST作为fallback
    return { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', content }] }] };
  }
}

// 将WordPress文章转换为Astro格式
export async function adaptWordPressPost(post: WordPressPost): Promise<AdaptedPost> {
  const markdownContent = wordpressAPI.convertContentToMarkdown(post.content.rendered);
  const excerpt = extractExcerpt(post.excerpt.rendered || post.content.rendered);
  
  // 获取分类和标签
  const categories = wordpressAPI.getCategories(post);
  const tags = wordpressAPI.getTags(post);
  
  // 获取特色图片
  const featuredImageUrl = wordpressAPI.getFeaturedImageUrl(post);
  
  // 解析日期
  const publishDate = parseWordPressDate(post.date);
  const modifiedDate = parseWordPressDate(post.modified);
  
  // 创建frontmatter
  const frontmatter = {
    title: post.title.rendered,
    date: publishDate,
    update: modifiedDate > publishDate ? modifiedDate : undefined,
    description: excerpt,
    category: categories.length > 0 ? categories[0].name : undefined,
    tags: tags.map(tag => tag.name),
    external: false,
    ogImagePath: featuredImageUrl || undefined,
  };

  // 解析Markdown为Markdoc AST
  const content = await parseMarkdownToAST(markdownContent);
  const brief = await parseMarkdownToAST(excerpt);

  return {
    slug: post.slug,
    content,
    brief,
    rawContent: markdownContent,
    frontmatter,
    html: post.content.rendered, // 使用WordPress的HTML输出
  };
}

// 获取所有WordPress文章并按年份分组
export async function getWordPressBlogs(): Promise<AdaptedBlog[]> {
  try {
    const response = await wordpressAPI.getPosts({
      status: 'publish',
      orderby: 'date',
      order: 'desc',
      per_page: 100, // 获取更多文章
    });

    const posts = response.data;
    
    // 按年份分组
    const postsByYear = posts.reduce((acc, post) => {
      const year = parseWordPressDate(post.date).getFullYear().toString();
      if (!acc[year]) {
        acc[year] = [];
      }
      acc[year].push(post);
      return acc;
    }, {} as Record<string, WordPressPost[]>);

    // 转换为AdaptedBlog格式
    const adaptedBlogs: AdaptedBlog[] = [];
    
    for (const [year, yearPosts] of Object.entries(postsByYear)) {
      const adaptedPosts = await Promise.all(
        yearPosts.map(post => adaptWordPressPost(post))
      );
      
      adaptedBlogs.push({
        year,
        posts: adaptedPosts,
      });
    }

    // 按年份降序排列
    return adaptedBlogs.sort((a, b) => parseInt(b.year) - parseInt(a.year));
  } catch (error) {
    console.error('Error fetching WordPress blogs:', error);
    return [];
  }
}

// 获取单个WordPress文章
export async function getWordPressPost(slug: string): Promise<AdaptedPost | null> {
  try {
    const post = await wordpressAPI.getPost(slug);
    return await adaptWordPressPost(post);
  } catch (error) {
    console.error(`Error fetching WordPress post ${slug}:`, error);
    return null;
  }
}

// 获取WordPress分类
export async function getWordPressCategories(): Promise<WordPressCategory[]> {
  try {
    const response = await wordpressAPI.getCategories({ hide_empty: true });
    return response.data;
  } catch (error) {
    console.error('Error fetching WordPress categories:', error);
    return [];
  }
}

// 获取WordPress标签
export async function getWordPressTags(): Promise<WordPressTag[]> {
  try {
    const response = await wordpressAPI.getTags({ hide_empty: true });
    return response.data;
  } catch (error) {
    console.error('Error fetching WordPress tags:', error);
    return [];
  }
}

// 兼容现有readBlog函数的接口
export async function readWordPressBlog<T extends z.ZodTypeAny>({
  frontmatterSchema: schema,
}: {
  frontmatterSchema: T;
}): Promise<AdaptedBlog[]> {
  // 忽略schema参数，因为我们使用WordPress的数据结构
  return getWordPressBlogs();
}

// 兼容现有readOne函数的接口
export async function readWordPressOne<T extends z.ZodTypeAny>({
  directory,
  slug,
  frontmatterSchema: schema,
}: {
  directory: string;
  slug: string;
  frontmatterSchema: T;
}): Promise<AdaptedPost | null> {
  // 忽略directory参数，因为我们直接从WordPress获取
  return getWordPressPost(slug);
} 