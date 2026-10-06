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

function bearer(request: Request): string | null {
  const h = request.headers.get("authorization");
  const m = h?.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
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

export default {
  async fetch(request, env): Promise<Response> {
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

      case "GET /api/auth/check": {
        if (!(await status.hit(ip))) return error(429, "too many requests");
        return (await tokenMatches(bearer(request), env.EDITOR_TOKEN))
          ? json({ ok: true })
          : error(401, "unauthorized");
      }

      case "POST /api/status": {
        if (!(await status.hit(ip))) return error(429, "too many requests");
        if (!(await tokenMatches(bearer(request), env.EDITOR_TOKEN))) return error(401, "unauthorized");
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
      const known = ["/api/status", "/api/stream", "/api/auth/check", "/api/hook"].includes(url.pathname);
      return known ? error(405, "method not allowed") : error(404, "not found");
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
