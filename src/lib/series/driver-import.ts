const slugs: Record<string, string> = {
  被追尾了: "rear-end-collision",
  萧山机场的高速费: "xiaoshan-airport-toll",
  北京的交警很少: "beijing-traffic-police",
};
export function splitDriverNotes(markdown: string) {
  const headings = [...markdown.matchAll(/^##[ \t]+([^\r\n]+)\r?$/gm)];
  if (
    headings.length !== 3 ||
    headings.some((heading) => !slugs[heading[1].trim()])
  )
    throw new Error("原文篇目已变化，请核对后再迁移");
  const chapters = headings.map((heading, index) => {
    const title = heading[1].trim(),
      body = markdown
        .slice(
          heading.index! + heading[0].length,
          headings[index + 1]?.index ?? markdown.length
        )
        .trim();
    const stamp = body.match(
      /^>\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*([^\r\n]*)/m
    );
    if (!stamp) throw new Error(`篇目《${title}》缺少原始日期`);
    const date = `${stamp[1]}-${stamp[2].padStart(2, "0")}-${stamp[3].padStart(
      2,
      "0"
    )}`;
    const publishedAt = new Date(date + "T00:00:00+08:00");
    if (
      !Number.isFinite(publishedAt.getTime()) ||
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
        publishedAt
      ) !== date
    )
      throw new Error("原始日期无效");
    const paragraph =
      body
        .replace(/^>[^\r\n]*(?:\r?\n|$)/gm, "")
        .trim()
        .split(/\n\s*\n/)[0] || "";
    const text = paragraph
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const description =
      Array.from(text).length > 100
        ? Array.from(text).slice(0, 100).join("") + "…"
        : text;
    return {
      title,
      markdown: body,
      context: stamp[4].trim(),
      year: stamp[1],
      slug: slugs[title],
      publishedAt: publishedAt.toISOString(),
      description,
    };
  });
  return { description: markdown.slice(0, headings[0].index).trim(), chapters };
}
