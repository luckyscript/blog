import { momentChannel } from '../../lib/moments/store'

export const prerender = false

export async function GET(Astro) {
  try {
    const channel = await momentChannel({ limit: 3 })
    const posts = (channel?.posts ?? []).slice(0, 3).map((post) => ({
      id: post.id,
      datetime: post.datetime,
      title: post.title,
      text: post.text,
      platform: post.platform,
      sourceUrl: post.sourceUrl,
    }))

    return new Response(JSON.stringify({ posts }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }
  catch (error) {
    return new Response(JSON.stringify({ posts: [] }), {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }
}
