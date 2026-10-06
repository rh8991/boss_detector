import { env, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Status } from "../src/validate";

const BASE = "https://boss.example";
const HOOK = "test-hook-token";

let ipCounter = 0;
let ip = "";

function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", ip);
  return exports.default.fetch(new Request(BASE + path, { ...init, headers }));
}

function post(body: unknown): Promise<Response> {
  return call("/api/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function hook(event: string, token = HOOK): Promise<Response> {
  return call(`/api/hook?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event }),
  });
}

function mainDO() {
  return env.STATUS.get(env.STATUS.idFromName("main"));
}

/** Shift stored timestamps into the past to simulate elapsed time. */
async function ageBy(ms: number) {
  await runInDurableObject(mainDO(), async (_obj, state) => {
    const s = await state.storage.get<Status>("status");
    if (s) await state.storage.put("status", { ...s, updatedAt: new Date(Date.parse(s.updatedAt) - ms).toISOString() });
    const h = await state.storage.get<{ event: string; at: number }>("lastHook");
    if (h) await state.storage.put("lastHook", { ...h, at: h.at - ms });
  });
}

beforeEach(async () => {
  ip = `10.0.0.${++ipCounter}`;
  await runInDurableObject(mainDO(), (_obj, state) => state.storage.deleteAll());
});

describe("GET /api/status", () => {
  it("returns 204 before anything is saved", async () => {
    const res = await call("/api/status");
    expect(res.status).toBe(204);
  });
});

describe("POST /api/status", () => {
  it("needs no sign-in", async () => {
    const res = await post({ state: "in" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "in", source: "manual" });
  });

  it("rejects an invalid state with 400", async () => {
    expect((await post({ state: "meeting" })).status).toBe(400);
    expect((await post({ avail: "sleeping" })).status).toBe(400);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await call("/api/status", {
      method: "POST",
      body: "{oops",
    });
    expect(res.status).toBe(400);
  });

  it("saves, merges and returns the status", async () => {
    const res = await post({ state: "out", note: "  חוזר ב־14:00  ", extra: 1 });
    expect(res.status).toBe(200);
    const s = (await res.json()) as Status;
    expect(s).toMatchObject({ state: "out", note: "חוזר ב־14:00", source: "manual" });
    expect(s).not.toHaveProperty("extra");
    expect(Date.parse(s.updatedAt)).not.toBeNaN();

    const got = await call("/api/status");
    expect(await got.json()).toEqual(s);
  });

  it("choosing in resets avail to free and clears the note", async () => {
    await post({ state: "in" });
    await post({ avail: "busy", note: "בשיחה" });
    const s = (await (await post({ state: "in" })).json()) as Status;
    expect(s).toMatchObject({ state: "in", avail: "free", note: "" });
  });

  it("caps notes at 80 characters", async () => {
    const s = (await (await post({ note: "x".repeat(100) })).json()) as Status;
    expect(s.note).toHaveLength(80);
  });
});

describe("POST /api/hook", () => {
  it("requires the hook token", async () => {
    expect((await hook("enter", "wrong")).status).toBe(401);
  });

  it("rejects unknown events", async () => {
    expect((await hook("teleport")).status).toBe(400);
  });

  it("applies enter/exit with source geofence", async () => {
    const s = (await (await hook("enter")).json()) as Status;
    expect(s).toMatchObject({ state: "in", avail: "free", source: "geofence" });
    const t = (await (await hook("exit")).json()) as Status;
    expect(t).toMatchObject({ state: "out", source: "geofence" });
  });

  it("ignores the same event repeated within 5 minutes", async () => {
    await hook("enter");
    const res = await hook("enter");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });

    await ageBy(5 * 60_000 + 1000);
    expect(await (await hook("enter")).json()).toMatchObject({ state: "in", source: "geofence" });
  });

  it("ignores hooks within 15 minutes of a manual update", async () => {
    await post({ state: "out", note: "ביום חופש" });
    const res = await hook("enter");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
    expect(await (await call("/api/status")).json()).toMatchObject({ state: "out", source: "manual" });

    await ageBy(15 * 60_000 + 1000);
    expect(await (await hook("enter")).json()).toMatchObject({ state: "in", source: "geofence" });
  });
});

describe("rate limiting", () => {
  it("returns 429 after 30 writes per minute from one IP", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await post({ note: String(i) })).status).toBe(200);
    }
    expect((await post({ note: "one too many" })).status).toBe(429);
    expect((await hook("enter")).status).toBe(429);

    ip = "10.9.9.9";
    expect((await post({ note: "other ip" })).status).toBe(200);
  });
});

describe("GET /api/stream", () => {
  async function firstEvent(res: Response): Promise<string> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (!buf.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    return buf;
  }

  it("sends the current status first", async () => {
    const saved = (await (await post({ state: "in", note: "בבוקר" })).json()) as Status;
    const res = await call("/api/stream");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const ev = await firstEvent(res);
    expect(ev.startsWith("event: status\n")).toBe(true);
    const data = ev.split("\n").find((l) => l.startsWith("data: "))!.slice(6);
    expect(JSON.parse(data)).toEqual(saved);
  });

  it("sends null when nothing was saved yet", async () => {
    const ev = await firstEvent(await call("/api/stream"));
    expect(ev).toContain("data: null");
  });

  it("pushes updates to open streams", async () => {
    const res = await call("/api/stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const readUntil = async (n: number) => {
      while (buf.split("\n\n").length - 1 < n) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
      }
    };
    await readUntil(1);
    await post({ state: "out", note: "בפגישה בחוץ" });
    await readUntil(2);
    await reader.cancel();
    expect(buf.split("\n\n")[1]).toContain("בפגישה בחוץ");
  });
});

describe("routing", () => {
  it("returns 405 for wrong methods and 404 for unknown API paths", async () => {
    expect((await call("/api/hook")).status).toBe(405);
    expect((await call("/api/nope")).status).toBe(404);
  });
});

describe("CORS for the GitHub Pages site", () => {
  const PAGES = "https://pages.example";

  it("answers preflight for an allowed origin", async () => {
    const res = await call("/api/status", {
      method: "OPTIONS",
      headers: { origin: PAGES, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(PAGES);
    expect(res.headers.get("access-control-allow-headers")).toContain("content-type");
  });

  it("refuses preflight from other origins", async () => {
    const res = await call("/api/status", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("adds the CORS header to API and stream responses for allowed origins only", async () => {
    const ok = await post({ state: "in" });
    expect(ok.headers.get("access-control-allow-origin")).toBeNull();

    const got = await call("/api/status", { headers: { origin: PAGES } });
    expect(got.headers.get("access-control-allow-origin")).toBe(PAGES);

    const stream = await call("/api/stream", { headers: { origin: PAGES } });
    expect(stream.headers.get("access-control-allow-origin")).toBe(PAGES);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    await stream.body!.cancel();

    const other = await call("/api/status", { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
