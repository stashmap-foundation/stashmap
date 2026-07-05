// CORS proxy for calendar feeds (M8.2): the web app cannot fetch arbitrary
// .ics URLs cross-origin, so it goes through this function. Desktop and CLI
// fetch directly. GET /.netlify/functions/ical-proxy?url=<feed url>.
const MAX_BYTES = 2 * 1024 * 1024;

export default async (request) => {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) {
    return new Response("missing url parameter", { status: 400 });
  }
  const target = raw.replace(/^webcal:\/\//u, "https://");
  let url;
  try {
    url = new URL(target);
  } catch {
    return new Response("invalid url", { status: 400 });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return new Response("unsupported scheme", { status: 400 });
  }
  try {
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { accept: "text/calendar, text/plain, */*" },
    });
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
  } catch {
    return new Response("upstream fetch failed", { status: 502 });
  }
};
