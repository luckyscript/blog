import type { APIRoute } from 'astro';
import { momentPreviewResponse } from '../../../../../../lib/moments/preview';
export const prerender = false;
export const GET: APIRoute = ({ request, params }) => momentPreviewResponse(request, params.width || '', params.name || '');
export const HEAD = GET;
