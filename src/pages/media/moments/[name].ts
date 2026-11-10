import type { APIRoute } from 'astro';
import { momentImageResponse } from '../../../lib/moments/media-response';
export const prerender = false;
export const GET: APIRoute = ({ request, params }) => momentImageResponse(request, params.name || '');
export const HEAD = GET;
