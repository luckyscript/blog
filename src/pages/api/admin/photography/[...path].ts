import type { APIRoute } from 'astro';
import { photographyApi } from '../../../../lib/photography/service';
export const prerender = false;
export const ALL: APIRoute = context => photographyApi(context, true);
