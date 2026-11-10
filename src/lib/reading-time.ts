// Markdoc's visible text lives in children; attributes contain URLs and embeds.
export function estimateReadingMinutes(content: unknown): number {
  const parts: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node === "string") parts.push(node);
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object" && "children" in node) visit(node.children);
  };
  visit(content);
  const text = parts.join(" ");
  const characters = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const words = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return Math.max(1, Math.ceil(characters / 400 + words / 220));
}
