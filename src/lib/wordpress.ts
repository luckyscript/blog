export interface WordPressPost {
  id: number;
  date: string;
  date_gmt: string;
  guid: {
    rendered: string;
  };
  modified: string;
  modified_gmt: string;
  slug: string;
  status: string;
  type: string;
  link: string;
  title: {
    rendered: string;
  };
  content: {
    rendered: string;
    protected: boolean;
  };
  excerpt: {
    rendered: string;
    protected: boolean;
  };
  author: number;
  featured_media: number;
  comment_status: string;
  ping_status: string;
  sticky: boolean;
  template: string;
  format: string;
  meta: any[];
  _links: any;
  categories: number[];
  tags: number[];
}

export interface WordPressCategory {
  id: number;
  count: number;
  description: string;
  link: string;
  name: string;
  slug: string;
  taxonomy: string;
  parent: number;
  meta: any[];
  _links: any;
}

export interface WordPressTag {
  id: number;
  count: number;
  description: string;
  link: string;
  name: string;
  slug: string;
  taxonomy: string;
  meta: any[];
  _links: any;
}

export interface WordPressMedia {
  id: number;
  date: string;
  date_gmt: string;
  guid: {
    rendered: string;
  };
  modified: string;
  modified_gmt: string;
  slug: string;
  status: string;
  type: string;
  link: string;
  title: {
    rendered: string;
  };
  author: number;
  comment_status: string;
  ping_status: string;
  template: string;
  meta: any[];
  description: {
    rendered: string;
  };
  caption: {
    rendered: string;
  };
  alt_text: string;
  media_type: string;
  mime_type: string;
  media_details: {
    width: number;
    height: number;
    file: string;
    sizes: {
      [key: string]: {
        file: string;
        width: number;
        height: number;
        mime_type: string;
        source_url: string;
      };
    };
  };
  post: number;
  source_url: string;
  _links: any;
}

export interface WordPressUser {
  id: number;
  name: string;
  url: string;
  description: string;
  link: string;
  slug: string;
  avatar_urls: {
    [key: string]: string;
  };
  meta: any[];
  _links: any;
}

export interface WordPressApiResponse<T> {
  data: T[];
  total: number;
  totalPages: number;
  currentPage: number;
}

class WordPressAPI {
  private baseUrl: string;
  private apiUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiUrl = `${this.baseUrl}/wp-json/wp/v2`;
  }

  private async fetchAPI<T>(endpoint: string, params: Record<string, any> = {}): Promise<T[]> {
    const url = new URL(`${this.apiUrl}${endpoint}`);
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value.toString());
      }
    });

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`WordPress API error: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('WordPress API fetch error:', error);
      throw error;
    }
  }

  private async fetchAPIWithPagination<T>(
    endpoint: string, 
    params: Record<string, any> = {}
  ): Promise<WordPressApiResponse<T>> {
    const allData: T[] = [];
    let page = 1;
    let totalPages = 1;
    let total = 0;

    do {
      const data = await this.fetchAPI<T>(endpoint, { ...params, page, per_page: 100 });
      allData.push(...data);
      
      if (page === 1) {
        // Get pagination info from headers
        const response = await fetch(`${this.apiUrl}${endpoint}?${new URLSearchParams({ ...params, page: '1', per_page: '100' })}`);
        total = parseInt(response.headers.get('X-WP-Total') || '0');
        totalPages = parseInt(response.headers.get('X-WP-TotalPages') || '1');
      }
      
      page++;
    } while (page <= totalPages);

    return {
      data: allData,
      total,
      totalPages,
      currentPage: 1
    };
  }

  // 获取文章列表
  async getPosts(params: {
    page?: number;
    per_page?: number;
    categories?: number[];
    tags?: number[];
    author?: number;
    search?: string;
    orderby?: string;
    order?: 'asc' | 'desc';
    status?: 'publish' | 'draft' | 'private';
  } = {}): Promise<WordPressApiResponse<WordPressPost>> {
    const queryParams: Record<string, any> = {
      ...params,
      _embed: 1 // 包含特色图片等信息
    };

    if (params.categories?.length) {
      queryParams.categories = params.categories.join(',');
    }

    if (params.tags?.length) {
      queryParams.tags = params.tags.join(',');
    }

    return this.fetchAPIWithPagination<WordPressPost>('/posts', queryParams);
  }

  // 获取单篇文章
  async getPost(slug: string): Promise<WordPressPost> {
    const posts = await this.fetchAPI<WordPressPost>('/posts', { slug, _embed: 1 });
    if (posts.length === 0) {
      throw new Error(`Post not found: ${slug}`);
    }
    return posts[0];
  }

  // 根据ID获取文章
  async getPostById(id: number): Promise<WordPressPost> {
    const posts = await this.fetchAPI<WordPressPost>(`/posts/${id}`, { _embed: 1 });
    if (posts.length === 0) {
      throw new Error(`Post not found with ID: ${id}`);
    }
    return posts[0];
  }

  // 获取分类列表
  async getCategories(params: {
    page?: number;
    per_page?: number;
    orderby?: string;
    order?: 'asc' | 'desc';
    hide_empty?: boolean;
    parent?: number;
  } = {}): Promise<WordPressApiResponse<WordPressCategory>> {
    return this.fetchAPIWithPagination<WordPressCategory>('/categories', params);
  }

  // 获取标签列表
  async getTags(params: {
    page?: number;
    per_page?: number;
    orderby?: string;
    order?: 'asc' | 'desc';
    hide_empty?: boolean;
  } = {}): Promise<WordPressApiResponse<WordPressTag>> {
    return this.fetchAPIWithPagination<WordPressTag>('/tags', params);
  }

  // 获取媒体文件
  async getMedia(params: {
    page?: number;
    per_page?: number;
    parent?: number;
    mime_type?: string;
  } = {}): Promise<WordPressApiResponse<WordPressMedia>> {
    return this.fetchAPIWithPagination<WordPressMedia>('/media', params);
  }

  // 获取用户信息
  async getUser(id: number): Promise<WordPressUser> {
    const users = await this.fetchAPI<WordPressUser>(`/users/${id}`);
    if (users.length === 0) {
      throw new Error(`User not found: ${id}`);
    }
    return users[0];
  }

  // 获取网站信息
  async getSiteInfo(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/wp-json`);
    if (!response.ok) {
      throw new Error(`Failed to fetch site info: ${response.status}`);
    }
    return response.json();
  }

  // 转换WordPress内容为Markdown格式（简化版）
  convertContentToMarkdown(content: string): string {
    // 移除WordPress的HTML标签，保留基本格式
    let markdown = content
      .replace(/<h([1-6])>(.*?)<\/h\1>/g, (match, level, text) => {
        return '#'.repeat(parseInt(level)) + ' ' + text + '\n\n';
      })
      .replace(/<p>(.*?)<\/p>/g, '$1\n\n')
      .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
      .replace(/<em>(.*?)<\/em>/g, '*$1*')
      .replace(/<code>(.*?)<\/code>/g, '`$1`')
      .replace(/<pre><code>(.*?)<\/code><\/pre>/gs, '```\n$1\n```\n')
      .replace(/<a href="(.*?)">(.*?)<\/a>/g, '[$2]($1)')
      .replace(/<img[^>]*src="([^"]*)"[^>]*>/g, '![]($1)')
      .replace(/<ul>(.*?)<\/ul>/gs, (match, content) => {
        return content.replace(/<li>(.*?)<\/li>/g, '- $1\n') + '\n';
      })
      .replace(/<ol>(.*?)<\/ol>/gs, (match, content) => {
        let index = 1;
        return content.replace(/<li>(.*?)<\/li>/g, () => `${index++}. $1\n`) + '\n';
      })
      .replace(/<blockquote>(.*?)<\/blockquote>/gs, '> $1\n\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // 清理多余的空行
    markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
    
    return markdown;
  }

  // 获取特色图片URL
  getFeaturedImageUrl(post: WordPressPost): string | null {
    if (post._embedded && post._embedded['wp:featuredmedia']) {
      const media = post._embedded['wp:featuredmedia'][0] as WordPressMedia;
      return media.source_url;
    }
    return null;
  }

  // 获取作者信息
  getAuthor(post: WordPressPost): WordPressUser | null {
    if (post._embedded && post._embedded.author) {
      return post._embedded.author[0] as WordPressUser;
    }
    return null;
  }

  // 获取分类信息
  getCategories(post: WordPressPost): WordPressCategory[] {
    if (post._embedded && post._embedded['wp:term']) {
      return post._embedded['wp:term'].filter((term: any) => term.taxonomy === 'category').flat();
    }
    return [];
  }

  // 获取标签信息
  getTags(post: WordPressPost): WordPressTag[] {
    if (post._embedded && post._embedded['wp:term']) {
      return post._embedded['wp:term'].filter((term: any) => term.taxonomy === 'post_tag').flat();
    }
    return [];
  }
}

// 创建WordPress API实例
export const wordpressAPI = new WordPressAPI(Astro.env.WORDPRESS_URL || 'http://localhost:8080');

// 导出类型
export type { WordPressPost, WordPressCategory, WordPressTag, WordPressMedia, WordPressUser }; 