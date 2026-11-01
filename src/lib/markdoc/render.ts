import Markdoc from "@markdoc/markdoc";
import sanitizeHtml from "sanitize-html";
import { config } from "./markdoc.config";
import { AppError } from "../server/errors";

function safeTree(node: any): any {
  if (Array.isArray(node)) return node.map(safeTree);
  if (node && typeof node === "object") {
    if (node.attributes) {
      for (const [name, value] of Object.entries(node.attributes)) {
        if (/^on/i.test(name)) delete node.attributes[name];
        if (
          ["href", "src", "url"].includes(name) &&
          typeof value === "string"
        ) {
          const normalized = value.trim();
          const scheme = normalized
            .match(/^([a-z][a-z0-9+.-]*):/i)?.[1]
            ?.toLowerCase();
          node.attributes[name] =
            /[\u0000-\u001f\u007f]/.test(normalized) ||
            (scheme && !["http", "https", "mailto", "tel"].includes(scheme))
              ? "#"
              : normalized;
        }
      }
    }
    if (node.children) node.children = node.children.map(safeTree);
  }
  return node;
}

export async function parseAndTransform({ content }: { content: string }) {
  const ast = Markdoc.parse(content);
  const errors = Markdoc.validate(ast, config);
  if (errors.length)
    throw new AppError(
      400,
      `Markdown 语法有误：${errors
        .slice(0, 3)
        .map((error) => error.error.message)
        .join("；")}`
    );
  return safeTree(Markdoc.transform(ast, config));
}

export function renderHtml(tree: any) {
  function htmlTree(node: any): any {
    if (Array.isArray(node)) return node.map(htmlTree);
    if (!(node instanceof Markdoc.Tag)) return node;
    const attrs = node.attributes ?? {};
    if (node.name === "CodeBlock")
      return new Markdoc.Tag("pre", {}, [
        new Markdoc.Tag(
          "code",
          {
            class: `language-${String(attrs.language ?? "text").replace(
              /[^\w-]/g,
              ""
            )}`,
          },
          [String(attrs.content ?? "")]
        ),
      ]);
    if (node.name === "Heading")
      return new Markdoc.Tag(
        `h${Math.min(6, Math.max(1, Number(attrs.level) || 2))}`,
        {},
        node.children.map(htmlTree)
      );
    if (
      [
        "YouTubeEmbed",
        "TweetEmbed",
        "CodePenEmbed",
        "Notion",
        "GitHubGistEmbed",
        "BilibiliEmbed",
        "Stock",
      ].includes(node.name)
    ) {
      const href =
        node.name === "BilibiliEmbed"
          ? `https://www.bilibili.com/video/${encodeURIComponent(
              attrs.id ?? ""
            )}`
          : attrs.url;
      return new Markdoc.Tag("p", {}, [
        new Markdoc.Tag("a", { href: href || "#" }, [
          attrs.label || "查看嵌入内容 ↗",
        ]),
      ]);
    }
    return new Markdoc.Tag(node.name, attrs, node.children.map(htmlTree));
  }
  return sanitizeHtml(Markdoc.renderers.html(htmlTree(tree)), {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img",
      "details",
      "summary",
      "sup",
      "sub",
      "kbd",
      "mark",
    ],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": ["class", "id"],
      img: ["src", "alt", "width", "height", "loading"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
  });
}
