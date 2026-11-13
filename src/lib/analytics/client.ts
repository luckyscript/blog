import { onCLS, onINP, onLCP, onFCP, onTTFB, type Metric } from "web-vitals";
import {
  analyticsPath,
  campaignValue,
  type AnalyticsEventType,
} from "./shared";

declare global {
  interface Window {
    __inkrainAnalytics?: boolean;
    inkrainTrack?: (
      type: AnalyticsEventType,
      target?: string,
      label?: string,
      value?: number
    ) => void;
  }
}
type TrackedEvent = {
  id: string;
  type: AnalyticsEventType;
  target: string;
  label: string;
  value: number;
};
const allowed =
  !!document.querySelector("[data-analytics-enabled]") &&
  analyticsPath(location.pathname) &&
  navigator.doNotTrack !== "1" &&
  !(navigator as Navigator & { globalPrivacyControl?: boolean })
    .globalPrivacyControl &&
  !navigator.webdriver;
if (allowed && !window.__inkrainAnalytics) {
  window.__inkrainAnalytics = true;
  let viewId = crypto.randomUUID(),
    path = analyticsPath(location.pathname),
    duration = 0,
    scroll = 0,
    interactions = 0;
  let events: TrackedEvent[] = [],
    vitals: Record<string, number> = {},
    lastTick = Date.now(),
    lastActivity = Date.now(),
    hiddenAt = 0;
  let inFlight = false,
    requested = false,
    disabled = false,
    searchTimer: ReturnType<typeof setTimeout> | undefined,
    flushTimer: ReturnType<typeof setTimeout> | undefined;
  const scrollDepth = () => {
    const height =
      Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      ) - innerHeight;
    scroll = Math.max(
      scroll,
      Math.round(
        height <= 1 ? 100 : Math.min(100, Math.max(0, (scrollY / height) * 100))
      )
    );
  };
  const mediaPlaying = () =>
    [...document.querySelectorAll<HTMLMediaElement>("video,audio")].some(
      (media) => !media.paused && !media.ended
    );
  const tick = () => {
    const now = Date.now();
    if (!document.hidden && (now - lastActivity < 60000 || mediaPlaying()))
      duration += Math.min(1500, Math.max(0, now - lastTick));
    lastTick = now;
  };
  const safeReferrer = () => {
    try {
      const url = new URL(document.referrer);
      return url.origin === location.origin
        ? url.origin + analyticsPath(url.pathname)
        : url.origin;
    } catch {
      return "";
    }
  };
  const payload = () => {
    const params = new URLSearchParams(location.search);
    return {
      viewId,
      path,
      referrer: safeReferrer(),
      source: campaignValue(params.get("utm_source")),
      medium: campaignValue(params.get("utm_medium")),
      campaign: campaignValue(params.get("utm_campaign")),
      language: navigator.language,
      width: Math.min(10000, innerWidth),
      height: Math.min(10000, innerHeight),
      duration: Math.min(86400000, Math.round(duration)),
      idle: mediaPlaying()
        ? 0
        : Math.min(1800000, Math.max(0, Date.now() - lastActivity)),
      scroll,
      interactions,
      vitals,
      events: events.slice(0, 20),
    };
  };
  async function flush(leaving = false) {
    if (disabled) return;
    tick();
    scrollDepth();
    if (inFlight) {
      requested = true;
      return;
    }
    inFlight = true;
    requested = false;
    const data = payload(),
      sent = new Set(data.events.map((event) => event.id));
    try {
      const response = await fetch("/api/analytics/collect", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
        keepalive: true,
        priority: "low",
        signal: leaving ? undefined : AbortSignal.timeout(10000),
      });
      if (response.ok) events = events.filter((event) => !sent.has(event.id));
      if ([403, 429].includes(response.status)) disabled = true;
    } catch {
      /* Analytics must never interrupt reading or navigation. */
    } finally {
      inFlight = false;
      if (requested && !disabled) {
        requested = false;
        void flush(document.hidden);
      }
    }
  }
  function schedule() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => void flush(), 1200);
  }
  function track(type: AnalyticsEventType, target = "", label = "", value = 0) {
    if (disabled || !analyticsPath(location.pathname)) return;
    if (type !== "error") {
      activity();
      interactions = Math.min(10000, interactions + 1);
    }
    if (events.length < 100)
      events.push({
        id: crypto.randomUUID(),
        type,
        target: target.slice(0, 2048),
        label: label.slice(0, 80),
        value: Math.min(100000, Math.max(0, Math.round(value))),
      });
    schedule();
  }
  window.inkrainTrack = track;
  function restart() {
    viewId = crypto.randomUUID();
    path = analyticsPath(location.pathname);
    duration = 0;
    scroll = 0;
    interactions = 0;
    events = [];
    vitals = {};
    lastTick = Date.now();
    lastActivity = Date.now();
    hiddenAt = 0;
    disabled = !path;
    void flush();
  }
  function activity() {
    if (Date.now() - lastActivity >= 1800000 && !mediaPlaying()) restart();
    lastActivity = Date.now();
  }
  setInterval(tick, 1000);
  setInterval(() => {
    if (
      !document.hidden &&
      (Date.now() - lastActivity < 90000 || mediaPlaying())
    )
      void flush();
  }, 30000);
  document.addEventListener("visibilitychange", () => {
    tick();
    if (document.hidden) {
      hiddenAt = Date.now();
      queueMicrotask(() => void flush(true));
    } else {
      activity();
      hiddenAt = 0;
      lastTick = Date.now();
    }
  });
  addEventListener("pagehide", () => void flush(true));
  addEventListener("pageshow", (event) => {
    if (event.persisted) restart();
  });
  document.addEventListener("astro:page-load", () => {
    if (analyticsPath(location.pathname) !== path) restart();
  });
  addEventListener("popstate", () => {
    if (analyticsPath(location.pathname) !== path) {
      void flush(true);
      restart();
    }
  });
  for (const type of [
    "pointerdown",
    "pointermove",
    "keydown",
    "touchstart",
    "scroll",
  ])
    addEventListener(type, activity, { passive: true });
  addEventListener("scroll", scrollDepth, { passive: true });
  document.addEventListener(
    "click",
    (event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element) return;
      const image = element.closest<HTMLElement>(
        "[data-photo-open],.moment-photo-button"
      );
      if (image) {
        const id = image.dataset.photoOpen;
        track(
          "image_open",
          id && /^\d+$/.test(id) ? `/photography/works/${id}` : "image",
          "image"
        );
        return;
      }
      if (element.closest("[data-photo-share]")) {
        track("share", "copy_link", "copy_link");
        return;
      }
      const theme = element.closest<HTMLElement>("[data-theme-option]");
      if (theme) {
        track("theme_change", theme.dataset.themeOption, "");
        return;
      }
      if (element.closest(".reading-material-switch")) {
        queueMicrotask(() =>
          track(
            "reading_material",
            document.documentElement.dataset.readingMaterial || "paper"
          )
        );
        return;
      }
      const link = element.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      let url: URL;
      try {
        url = new URL(link.href, location.href);
      } catch {
        return;
      }
      if (!["https:", "http:"].includes(url.protocol)) return;
      if (
        link.hasAttribute("download") ||
        /\.(?:pdf|zip|gz|docx?|xlsx?|pptx?|epub)$/i.test(url.pathname)
      )
        track("download", "file", "file");
      else if (
        url.origin === location.origin &&
        /^\/link\/to\/[a-f0-9-]{36}\/?$/.test(url.pathname)
      )
        track("outbound_click", url.pathname, "link");
      else if (url.origin !== location.origin)
        track("outbound_click", url.origin, "link");
      else if (analyticsPath(url.pathname)) {
        if (
          url.pathname === location.pathname &&
          url.search !== location.search
        )
          track("filter", "platform", "");
        else if (url.pathname !== location.pathname)
          track("navigation", analyticsPath(url.pathname), "navigation");
      }
    },
    true
  );
  const search = (input: HTMLInputElement) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const length = Array.from(input.value.trim()).length;
      if (length) track("search", "search", "search", Math.min(500, length));
    }, 1000);
  };
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      (target.type === "search" || target.name === "q")
    )
      search(target);
  });
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const input = form.querySelector<HTMLInputElement>(
      "input[type=search],input[name=q]"
    );
    if (input) {
      clearTimeout(searchTimer);
      const length = Array.from(input.value.trim()).length;
      if (length) track("search", "search", "search", Math.min(500, length));
    }
  });
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (
      target instanceof HTMLSelectElement &&
      ["category", "year", "camera", "platform"].includes(target.name)
    )
      track("filter", target.name, target.name);
  });
  document.addEventListener(
    "play",
    (event) => {
      if (event.target instanceof HTMLMediaElement)
        track(
          "media_play",
          event.target.tagName.toLowerCase(),
          event.target.tagName.toLowerCase()
        );
    },
    true
  );
  addEventListener(
    "error",
    (event) => {
      const target = event.target;
      track(
        "error",
        target instanceof HTMLImageElement
          ? "image_error"
          : target instanceof HTMLScriptElement
          ? "script_error"
          : target instanceof HTMLLinkElement
          ? "style_error"
          : target === window
          ? "javascript"
          : "resource_error"
      );
    },
    true
  );
  addEventListener("unhandledrejection", () => track("error", "promise"));
  const metric = (metric: Metric) => {
    vitals[metric.name] = Math.min(
      metric.name === "CLS" ? 100 : 120000,
      Math.max(0, metric.value)
    );
    if (document.hidden) queueMicrotask(() => void flush(true));
    else schedule();
  };
  onCLS(metric);
  onINP(metric);
  onLCP(metric);
  onFCP(metric);
  onTTFB(metric);
  void flush();
}
