import { getChannelInfo } from '../../lib/telegram'

export const prerender = false

export async function GET(Astro) {
  try {
    const channel = await getChannelInfo(Astro)
    const posts = (channel?.posts ?? []).slice(0, 3).map((post) => ({
      id: post.id,
      datetime: post.datetime,
      content: post.content,
    }))

    return new Response(JSON.stringify({ posts }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }
  catch (error) {
    console.error(error)

    return new Response(JSON.stringify({ posts: [] }), {
      status: 502,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }
}
