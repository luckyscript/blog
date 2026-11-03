import Markdoc from '@markdoc/markdoc';
import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { parseAndTransform, renderHtml } from './render';

type Body = { content: any; brief: any; html: string; bytes: number };
const bodies = new LRUCache<string, Body>({ max: 128, maxSize: 16 * 1024 * 1024, sizeCalculation: body => body.bytes });
const pending = new Map<string, Promise<Body>>();

// Renderers receive independent trees, including Markdoc.Tag prototypes.
function copyTree(value: any): any {
  if (Array.isArray(value)) return value.map(copyTree);
  if (value instanceof Markdoc.Tag) return new Markdoc.Tag(value.name, structuredClone(value.attributes), value.children.map(copyTree));
  return value;
}

/** Cache only compiled content. Publication status and metadata always come from fresh reads. */
export async function renderedBody(markdown: string) {
  const key = createHash('sha256').update(markdown).digest('hex');
  let body = bodies.get(key);
  if (!body) {
    let compiling = pending.get(key);
    if (!compiling) {
      compiling = (async () => {
        const content = await parseAndTransform({ content: markdown });
        const excerpt = markdown.split('<!--more-->')[0];
        const brief = excerpt === markdown ? content : await parseAndTransform({ content: excerpt });
        const html = renderHtml(content);
        return { content, brief, html, bytes: 2048 + 8 * (Buffer.byteLength(markdown) + Buffer.byteLength(html)) };
      })();
      pending.set(key, compiling);
    }
    try { body = await compiling; bodies.set(key, body); }
    finally { if (pending.get(key) === compiling) pending.delete(key); }
  }
  return { content: copyTree(body.content), brief: copyTree(body.brief), html: body.html };
}
