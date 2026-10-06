import { parseHookEvent, parsePatch } from "./validate";

export { StatusDO } from "./status-do";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function error(status: number, message: string): Response {
  return json({ error: message }, status);
}

const encoder = new TextEncoder();

/** Constant-time comparison: hash both sides so lengths match, then timingSafeEqual. */
async function tokenMatches(given: string | null, expected: string | undefined): Promise<boolean> {
  if (!given || !expected) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function stub(env: Env) {
  return env.STATUS.get(env.STATUS.idFromName("main"));
}

/** Origins (besides the Worker itself) allowed to call the API, e.g. the GitHub Pages site. */
function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function withCors(res: Response, origin: string): Response {
  const out = new Response(res.body, res);
  out.headers.set("access-control-allow-origin", origin);
  out.headers.append("vary", "Origin");
  return out;
}

export default {
  async fetch(request, env): Promise<Response> {
    const origin = allowedOrigin(request, env);
    if (request.method === "OPTIONS" && new URL(request.url).pathname.startsWith("/api/")) {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
          vary: "Origin",
        },
      });
    }
    const res = await handle(request, env);
    return origin ? withCors(res, origin) : res;
  },
} satisfies ExportedHandler<Env>;

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  const status = stub(env);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

  switch (route) {
    case "GET /api/status": {
      const current = await status.getStatus();
      return current ? json(current) : new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    }

    case "GET /api/stream":
      return status.fetch(request);

    case "POST /api/status": {
      // No sign-in: anyone with the boss page can update. Rate limited per IP.
      if (!(await status.hit(ip))) return error(429, "too many requests");
      const patch = parsePatch(await readJson(request));
      if (!patch.ok) return error(400, patch.error);
      return json(await status.update(patch.value));
    }

    case "POST /api/hook": {
      if (!(await status.hit(ip))) return error(429, "too many requests");
      if (!(await tokenMatches(url.searchParams.get("token"), env.HOOK_TOKEN))) return error(401, "unauthorized");
      const event = parseHookEvent(await readJson(request));
      if (!event.ok) return error(400, event.error);
      const result = await status.hook(event.value);
      return json(result.ignored ? result : result.status);
    }
  }

  if (url.pathname.startsWith("/api/")) {
    const known = ["/api/status", "/api/stream", "/api/hook"].includes(url.pathname);
    return known ? error(405, "method not allowed") : error(404, "not found");
  }
  return new Response("Not found", { status: 404 });
}
