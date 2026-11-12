import type { APIRoute } from 'astro';
import { photographyMedia } from '../../../lib/photography/service';
export const prerender = false;
export const GET: APIRoute = photographyMedia;
export const HEAD = GET;
