import { describe, expect, it } from "vitest";
import { cleanNote, hookPatch, mergeStatus, parseHookEvent, parsePatch, type Status } from "../src/validate";

const now = new Date("2026-10-06T08:30:00.000Z");
const busyWithNote: Status = {
  state: "in", avail: "busy", note: "בפגישה", updatedAt: "2026-10-06T08:00:00.000Z", source: "manual",
};

describe("parsePatch", () => {
  it("accepts a valid partial body and ignores unknown fields", () => {
    expect(parsePatch({ state: "out", note: "  חוזר ב־14:00 ", by: "x" })).toEqual({
      ok: true, value: { state: "out", note: "חוזר ב־14:00" },
    });
  });

  it.each([
    [{ state: "meeting" }],
    [{ state: 1 }],
    [{ avail: "maybe" }],
    [{ note: 5 }],
    [null],
    [[]],
    ["in"],
  ])("rejects %j", (body) => {
    expect(parsePatch(body).ok).toBe(false);
  });

  it("caps the note at 80 characters", () => {
    const r = parsePatch({ note: "א".repeat(200) });
    expect(r.ok && r.value.note?.length).toBe(80);
  });
});

describe("cleanNote", () => {
  it("does not split emoji when truncating", () => {
    expect(Array.from(cleanNote("😀".repeat(100)))).toHaveLength(80);
  });
});

describe("mergeStatus", () => {
  it("starts from an empty status", () => {
    expect(mergeStatus(null, { state: "out" }, now, "manual")).toEqual({
      state: "out", avail: "free", note: "", updatedAt: now.toISOString(), source: "manual",
    });
  });

  it("choosing in resets avail to free and clears the note", () => {
    const s = mergeStatus(busyWithNote, { state: "in" }, now, "manual");
    expect(s).toMatchObject({ state: "in", avail: "free", note: "" });
  });

  it("choosing out keeps the note when none is sent", () => {
    expect(mergeStatus(busyWithNote, { state: "out" }, now, "manual").note).toBe("בפגישה");
  });

  it("changing avail keeps state and note", () => {
    const s = mergeStatus({ ...busyWithNote, avail: "free" }, { avail: "busy" }, now, "manual");
    expect(s).toMatchObject({ state: "in", avail: "busy", note: "בפגישה" });
  });

  it("stamps time and source", () => {
    const s = mergeStatus(busyWithNote, {}, now, "geofence");
    expect(s.updatedAt).toBe(now.toISOString());
    expect(s.source).toBe("geofence");
  });
});

describe("hooks", () => {
  it("parses events", () => {
    expect(parseHookEvent({ event: "enter" })).toEqual({ ok: true, value: "enter" });
    expect(parseHookEvent({ event: "arrive" }).ok).toBe(false);
    expect(parseHookEvent(undefined).ok).toBe(false);
  });

  it("maps events to patches", () => {
    expect(mergeStatus(busyWithNote, hookPatch("enter"), now, "geofence")).toMatchObject({ state: "in", avail: "free" });
    expect(hookPatch("exit")).toEqual({ state: "out" });
  });
});
