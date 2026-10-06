// Pure validation / merge helpers. No Workers APIs here so they are trivially testable.

export type State = "in" | "out";
export type Avail = "free" | "busy";
export type Source = "manual" | "geofence";

export interface Status {
  state: State;
  avail: Avail;
  note: string;
  updatedAt: string;
  source: Source;
}

export interface Patch {
  state?: State;
  avail?: Avail;
  note?: string;
}

export const NOTE_MAX = 80;

const STATES: readonly string[] = ["in", "out"];
const AVAILS: readonly string[] = ["free", "busy"];

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function cleanNote(note: string): string {
  // Cap by code points so we never split a surrogate pair (emoji).
  return Array.from(note.trim()).slice(0, NOTE_MAX).join("");
}

/** Validates a partial `{state?, avail?, note?}` body. Unknown fields are ignored. */
export function parsePatch(body: unknown): Result<Patch> {
  if (!isObject(body)) return { ok: false, error: "body must be a JSON object" };
  const patch: Patch = {};
  if (body.state !== undefined) {
    if (typeof body.state !== "string" || !STATES.includes(body.state)) {
      return { ok: false, error: "state must be \"in\" or \"out\"" };
    }
    patch.state = body.state as State;
  }
  if (body.avail !== undefined) {
    if (typeof body.avail !== "string" || !AVAILS.includes(body.avail)) {
      return { ok: false, error: "avail must be \"free\" or \"busy\"" };
    }
    patch.avail = body.avail as Avail;
  }
  if (body.note !== undefined) {
    if (typeof body.note !== "string") return { ok: false, error: "note must be a string" };
    patch.note = cleanNote(body.note);
  }
  return { ok: true, value: patch };
}

/**
 * Merges a patch into the current status.
 * Choosing "in" without an explicit `avail` means "just arrived": avail resets to
 * free and the note is cleared (unless the patch sets one). Choosing "out" keeps the note.
 */
export function mergeStatus(current: Status | null, patch: Patch, now: Date, source: Source): Status {
  const base = current ?? { state: "out" as State, avail: "free" as Avail, note: "" };
  const arriving = patch.state === "in" && patch.avail === undefined;
  return {
    state: patch.state ?? base.state,
    avail: arriving ? "free" : (patch.avail ?? base.avail),
    note: patch.note ?? (arriving ? "" : base.note),
    updatedAt: now.toISOString(),
    source,
  };
}
