import React, { useEffect, useState } from "react";
import type { SeriesSummary } from "../../lib/server/series";
import type { PostInput } from "../../lib/server/content-input";
type Props = {
  input: PostInput;
  postId?: string | null;
  request: (path: string, options?: RequestInit) => Promise<any>;
  onChange: (metadata: Record<string, unknown>) => void;
};
export default function SeriesFields({
  input,
  postId,
  request,
  onChange,
}: Props) {
  const [items, setItems] = useState<SeriesSummary[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request("series")
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [request]);
  const root = postId
      ? items.find((item) => item.rootPostId === postId)
      : undefined,
    selected =
      typeof input.metadata.seriesId === "string"
        ? input.metadata.seriesId
        : "";
  if (root)
    return (
      <section className="panel property-panel">
        <h2>系列入口</h2>
        <p className="field-hint">
          这篇原稿保留在数据库中，前台显示为《{root.title}》系列目录。
        </p>
        <a href={"/admin/series/" + root.id}>管理系列和篇目 →</a>
      </section>
    );
  return (
    <section className="panel property-panel">
      <h2>系列手记</h2>
      {error ? (
        <p className="notice error" role="alert">
          系列暂时无法读取：{error}
        </p>
      ) : (
        <>
          <label>
            所属系列
            <select
              value={selected}
              onChange={(event) => {
                const metadata = { ...input.metadata };
                if (event.target.value) metadata.seriesId = event.target.value;
                else {
                  delete metadata.seriesId;
                  delete metadata.seriesContext;
                }
                onChange(metadata);
              }}
            >
              <option value="">独立文章，不加入系列</option>
              {items
                .filter(
                  (item) =>
                    item.section === input.section || item.id === selected
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                    {item.status === "draft" ? "（系列草稿）" : ""}
                    {item.section !== input.section ? "（栏目不一致）" : ""}
                  </option>
                ))}
            </select>
          </label>
          {selected && (
            <label>
              场景 / 行程（可选）
              <input
                value={
                  typeof input.metadata.seriesContext === "string"
                    ? input.metadata.seriesContext
                    : ""
                }
                maxLength={200}
                onChange={(event) =>
                  onChange({
                    ...input.metadata,
                    seriesContext: event.target.value,
                  })
                }
                placeholder="例如：杭州 · 萧山机场 → 家"
              />
            </label>
          )}
          <small className="field-hint">
            发布后自动加入目录；草稿修改不会提前改变前台归属。
          </small>
          <a href="/admin/series">管理系列 →</a>
        </>
      )}
    </section>
  );
}
