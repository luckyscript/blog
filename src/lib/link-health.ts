export type LinkHealth = {
  state: string;
  httpStatus: number | null;
  latencyMs: number | null;
  reason: string;
  checkedAt: Date | string;
};
const states: Record<string, { label: string; tone: string; detail: string }> =
  {
    healthy: { label: "可访问", tone: "good", detail: "最近检查可以正常访问" },
    restricted: {
      label: "访问受限",
      tone: "limited",
      detail: "对方站点限制自动访问，可在浏览器中尝试",
    },
    broken: {
      label: "链接失效",
      tone: "bad",
      detail: "对方返回页面不存在或已移除",
    },
    error: {
      label: "服务异常",
      tone: "bad",
      detail: "对方站点返回服务或证书异常",
    },
    unreachable: {
      label: "暂未连通",
      tone: "neutral",
      detail: "最近检查未能连接，可在浏览器中尝试",
    },
    blocked: {
      label: "检查受限",
      tone: "neutral",
      detail: "该目标无法进行公开网站连通性检查",
    },
  };
export function healthDisplay(health?: LinkHealth | null, now = Date.now()) {
  const checked = health ? new Date(health.checkedAt) : null;
  if (!health || !checked || !Number.isFinite(checked.getTime()))
    return {
      label: "待检查",
      tone: "neutral",
      title: "尚未完成访问检查",
      checkedAt: "",
      checkedLabel: "",
    };
  const state = states[health.state] || {
    label: "待检查",
    tone: "neutral",
    detail: "尚未完成访问检查",
  };
  const stale = now - checked.getTime() > 8 * 24 * 3600_000;
  const time = checked.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
  const reason =
    health.reason === "timeout"
      ? "，请求超时"
      : health.reason === "dns"
      ? "，域名暂未解析"
      : health.reason === "tls"
      ? "，证书校验未通过"
      : "";
  return {
    label: stale ? "待复查" : state.label,
    tone: stale ? "neutral" : state.tone,
    title: `${state.detail}${reason}${
      health.httpStatus ? `（HTTP ${health.httpStatus}）` : ""
    }。检查于 ${time}${
      health.latencyMs !== null ? `，耗时 ${health.latencyMs}ms` : ""
    }`,
    checkedAt: checked.toISOString(),
    checkedLabel: checked.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };
}
