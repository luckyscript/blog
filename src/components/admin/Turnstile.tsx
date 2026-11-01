import { useEffect, useRef, useState } from "react";

export type TurnstileSettings = {
  siteKey: string;
  configured: boolean;
  testing: boolean;
};
type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
let loading: Promise<TurnstileApi> | undefined;
function loadApi() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      const fail = () => {
        clearTimeout(timeout);
        script.remove();
        loading = undefined;
        reject(new Error("验证组件加载失败"));
      };
      const timeout = setTimeout(fail, 15_000);
      script.onload = () => {
        clearTimeout(timeout);
        if (window.turnstile) resolve(window.turnstile);
        else fail();
      };
      script.onerror = fail;
      document.head.append(script);
    });
  }
  return loading;
}

export default function Turnstile({
  siteKey,
  resetKey,
  onToken,
}: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string>();
  const tokenCallback = useRef(onToken);
  tokenCallback.current = onToken;
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState("正在加载 Cloudflare 安全验证…");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let api: TurnstileApi | undefined;
    tokenCallback.current("");
    setFailed(false);
    setMessage("正在加载 Cloudflare 安全验证…");
    loadApi()
      .then((loaded) => {
        if (disposed || !container.current) return;
        api = loaded;
        let size = "";
        const render = () => {
          if (!container.current || disposed) return;
          const nextSize =
            container.current.clientWidth < 300 ? "compact" : "flexible";
          if (size === nextSize) return;
          size = nextSize;
          tokenCallback.current("");
          if (widget.current !== undefined) loaded.remove(widget.current);
          widget.current = loaded.render(container.current, {
            sitekey: siteKey,
            action: "admin-login",
            theme: "light",
            size,
            "response-field": false,
            retry: "never",
            "refresh-expired": "auto",
            callback: (token: string) => {
              if (!disposed) {
                tokenCallback.current(token);
                setFailed(false);
                setMessage("安全验证已通过");
              }
            },
            "expired-callback": () => {
              if (!disposed) {
                tokenCallback.current("");
                setMessage("验证已过期，正在重新验证…");
              }
            },
            "error-callback": () => {
              if (!disposed) {
                tokenCallback.current("");
                setFailed(true);
                setMessage("安全验证暂不可用，请重试。");
              }
            },
            "timeout-callback": () => {
              if (!disposed) {
                tokenCallback.current("");
                setFailed(true);
                setMessage("安全验证超时，请重试。");
              }
            },
          });
          setMessage("请完成安全验证。");
        };
        render();
        observer = new ResizeObserver(render);
        observer.observe(container.current);
      })
      .catch(() => {
        if (!disposed) {
          setFailed(true);
          setMessage("安全验证加载失败，请检查网络后重试。");
        }
      });
    return () => {
      disposed = true;
      observer?.disconnect();
      if (widget.current !== undefined) api?.remove(widget.current);
      widget.current = undefined;
    };
  }, [siteKey, resetKey, retry]);
  return (
    <div className="login-verification">
      <div ref={container} className="turnstile-widget" />
      <p
        className={failed ? "verification-status error" : "verification-status"}
        role={failed ? "alert" : "status"}
      >
        {message}
      </p>
      {failed && (
        <button
          type="button"
          className="text-button"
          onClick={() => setRetry((value) => value + 1)}
        >
          重新验证
        </button>
      )}
    </div>
  );
}
