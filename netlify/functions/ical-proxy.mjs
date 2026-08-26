// CORS proxy for calendar feeds (M8.2): the web app cannot fetch arbitrary
// .ics URLs cross-origin, so it goes through this function. Desktop and CLI
// fetch directly. GET /.netlify/functions/ical-proxy?url=<feed url>.
// Deployed standalone, so the feed-url validation from src/core/ical.ts is
// mirrored here: https only, no credentials, no private hosts, every
// redirect hop revalidated. Hostnames resolving to private addresses are
// not caught here; that hardening is a separate server-side task.
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0"
  ) {
    return true;
  }
  if (host.includes(":")) {
    return host === "::1" || host.startsWith("fe80:") || /^f[cd]/u.test(host);
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/u);
  if (!v4) {
    return false;
  }
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function rejectedFeedUrl(url) {
  if (url.protocol !== "https:") {
    return "unsupported scheme";
  }
  if (url.username || url.password) {
    return "credentials not allowed";
  }
  if (isPrivateHost(url.hostname)) {
    return "private host not allowed";
  }
  return undefined;
}

export default async (request) => {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) {
    return new Response("missing url parameter", { status: 400 });
  }
  let target = raw.replace(/^webcal:\/\//u, "https://");
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const url = new URL(target);
      const rejection = rejectedFeedUrl(url);
      if (rejection) {
        return new Response(rejection, { status: 400 });
      }
      const upstream = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        redirect: "manual",
        headers: { accept: "text/calendar, text/plain, */*" },
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        const location = upstream.headers.get("location");
        if (!location) {
          return new Response(`upstream status ${upstream.status}`, {
            status: 502,
          });
        }
        target = new URL(location, url).toString();
        continue;
      }
      if (!upstream.ok) {
        return new Response(`upstream status ${upstream.status}`, {
          status: 502,
        });
      }
      const body = await upstream.text();
      if (body.length > MAX_BYTES) {
        return new Response("feed too large", { status: 502 });
      }
      return new Response(body, {
        headers: {
          "content-type": "text/calendar; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=300",
        },
      });
    }
    return new Response("too many redirects", { status: 502 });
  } catch {
    return new Response("upstream fetch failed", { status: 502 });
  }
};
