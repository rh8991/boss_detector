import { DurableObject } from "cloudflare:workers";
import { mergeStatus, type Patch, type Status } from "./validate";

export const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const PING_MS = 25_000;

const encoder = new TextEncoder();

/** Single instance ("main") holding the current status and fanning changes out over SSE. */
export class StatusDO extends DurableObject<Env> {
  private clients = new Set<WritableStreamDefaultWriter<Uint8Array>>();
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private hits = new Map<string, { windowStart: number; count: number }>();

  async getStatus(): Promise<Status | null> {
    return (await this.ctx.storage.get<Status>("status")) ?? null;
  }

  /** Counts a write attempt for `ip`; returns false once the per-minute budget is spent. */
  hit(ip: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(ip);
    if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
      this.hits.set(ip, { windowStart: now, count: 1 });
      if (this.hits.size > 1000) this.pruneHits(now);
      return true;
    }
    entry.count++;
    return entry.count <= RATE_LIMIT;
  }

  async update(patch: Patch): Promise<Status> {
    const next = mergeStatus(await this.getStatus(), patch, new Date(), "manual");
    await this.save(next);
    return next;
  }

  /** Only used for GET /api/stream: returns a Server-Sent Events response. */
  async fetch(_request: Request): Promise<Response> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    this.clients.add(writer);
    this.send(writer, statusEvent(await this.getStatus()));
    this.ensurePing();
    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      },
    });
  }

  private async save(status: Status): Promise<void> {
    await this.ctx.storage.put("status", status);
    this.broadcast(statusEvent(status));
  }

  private broadcast(chunk: string): void {
    for (const w of this.clients) this.send(w, chunk);
  }

  private send(writer: WritableStreamDefaultWriter<Uint8Array>, chunk: string): void {
    // Not awaited: a slow reader must not block everyone else. A failed write means the
    // client went away, so drop it.
    writer.write(encoder.encode(chunk)).catch(() => this.drop(writer));
  }

  private drop(writer: WritableStreamDefaultWriter<Uint8Array>): void {
    if (!this.clients.delete(writer)) return;
    writer.abort().catch(() => {});
    if (this.clients.size === 0 && this.pingTimer !== undefined) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  private ensurePing(): void {
    if (this.pingTimer !== undefined) return;
    this.pingTimer = setInterval(() => this.broadcast(": ping\n\n"), PING_MS);
  }

  private pruneHits(now: number): void {
    for (const [ip, e] of this.hits) if (now - e.windowStart >= RATE_WINDOW_MS) this.hits.delete(ip);
  }
}

function statusEvent(status: Status | null): string {
  return `event: status\ndata: ${JSON.stringify(status)}\n\n`;
}
