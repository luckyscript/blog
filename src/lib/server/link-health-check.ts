import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { safeLinkUrl } from "./links";
import type { LinkHealth } from "../link-health";

type Address = { address: string; family: number };
type ProbeResult = { status: number; location?: string };
type Probe = (
  url: URL,
  address: Address,
  method: "HEAD" | "GET",
  signal: AbortSignal
) => Promise<ProbeResult>;
const private4 = new BlockList(),
  private6 = new BlockList(),
  global6 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  private4.addSubnet(address, prefix, "ipv4");
global6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  private6.addSubnet(address, prefix, "ipv6");
export function isPublicAddress(address: string) {
  if (address.includes("%")) return false;
  const family = isIP(address);
  return family === 4
    ? !private4.check(address, "ipv4")
    : family === 6 &&
        global6.check(address, "ipv6") &&
        !private6.check(address, "ipv6");
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
/** Connect to the validated address while preserving the original Host and TLS SNI. */
export const pinnedProbe: Probe = (url, address, method, signal) =>
  new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method,
        agent: false,
        family: address.family,
        signal,
        maxHeaderSize: 16384,
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
        headers: {
          "user-agent": "RainOnPiano-LinkHealth/1.0",
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          ...(method === "GET" ? { range: "bytes=0-1023" } : {}),
        },
      },
      (response) => {
        const result = {
          status: response.statusCode || 0,
          location: response.headers.location,
        };
        // No page content is downloaded or retained; even GET fallback stops at headers.
        response.destroy();
        resolve(result);
      }
    );
    req.once("error", reject);
    req.end();
  });

export async function checkPublicLink(
  value: string,
  options: {
    resolve?: (host: string) => Promise<Address[]>;
    probe?: Probe;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<LinkHealth> {
  const started = Date.now(),
    signal = AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? 12000),
      ...(options.signal ? [options.signal] : []),
    ]);
  const resolve =
      options.resolve ??
      ((host) => lookup(host, { all: true, verbatim: true })),
    probe = options.probe ?? pinnedProbe;
  const finish = (
    state: string,
    httpStatus: number | null = null,
    reason = ""
  ): LinkHealth => ({
    state,
    httpStatus,
    reason,
    latencyMs: Math.max(0, Date.now() - started),
    checkedAt: new Date(),
  });
  const seen = new Set<string>();
  let current = value;
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      let url: URL;
      try {
        url = new URL(safeLinkUrl(current));
        url.hash = "";
      } catch {
        return finish("blocked", null, "address");
      }
      if (seen.has(url.href)) return finish("error", null, "redirect");
      seen.add(url.href);
      const addresses = await abortable(resolve(url.hostname), signal);
      if (!addresses.length) return finish("unreachable", null, "dns");
      if (
        addresses.some(
          (item) =>
            isIP(item.address) !== item.family || !isPublicAddress(item.address)
        )
      )
        return finish("blocked", null, "address");
      const address =
        addresses.find((item) => item.family === 4) || addresses[0];
      let result = await abortable(probe(url, address, "HEAD", signal), signal);
      if ([400, 403, 405, 501].includes(result.status))
        result = await abortable(probe(url, address, "GET", signal), signal);
      if ([301, 302, 303, 307, 308].includes(result.status)) {
        if (!result.location || redirects === 4)
          return finish("error", result.status, "redirect");
        try {
          current = new URL(result.location, url).href;
        } catch {
          return finish("error", result.status, "redirect");
        }
        continue;
      }
      if (result.status >= 200 && result.status < 300)
        return finish("healthy", result.status);
      if ([401, 403, 407, 429, 451].includes(result.status))
        return finish("restricted", result.status);
      if ([404, 410].includes(result.status))
        return finish("broken", result.status);
      return finish("error", result.status || null, "status");
    }
  } catch (error: any) {
    if (
      signal.aborted ||
      error?.name === "TimeoutError" ||
      error?.name === "AbortError"
    )
      return finish("unreachable", null, "timeout");
    if (["ENOTFOUND", "EAI_AGAIN"].includes(error?.code))
      return finish("unreachable", null, "dns");
    if (/CERT|TLS|SSL/.test(error?.code || ""))
      return finish("error", null, "tls");
    return finish("unreachable", null, "network");
  }
  return finish("error", null, "redirect");
}
