"use strict";

const LABEL = { in: "במשרד", out: "לא במשרד" };
const AVAIL = { free: "פנוי", busy: "עסוק" };
const IMG = { out: "/img/out-empty-chair.webp", busy: "/img/in-busy-laptop.webp", free: "/img/in-free-coffee.webp" };
const ALT = { out: "כיסא ריק", busy: "עובדת מול המחשב", free: "עם כוס קפה" };
const TOKEN_KEY = "bossStatus.editorToken";
const POLL_MS = 30_000;

const $ = (id) => document.getElementById(id);
const plate = document.querySelector(".plate");
let current = null;
let token = null;
let busy = false;
let pollTimer = null;

Object.values(IMG).forEach((u) => { new Image().src = u; });

// ---------- storage (localStorage can throw in private mode) ----------
function readToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function storeToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch {} }
function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }

// ---------- rendering ----------
function imgKey(c) { return c.state === "out" ? "out" : (c.avail === "busy" ? "busy" : "free"); }
function colors(c) {
  if (c.state === "out") return ["var(--out)", "var(--out-ink)"];
  return c.avail === "busy" ? ["var(--meet)", "var(--meet-ink)"] : ["var(--in)", "var(--in-ink)"];
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "עכשיו";
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? "לפני דקה" : `לפני ${m} דקות`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "לפני שעה" : `לפני ${h} שעות`;
  return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

function render() {
  const lamp = $("lamp");
  if (!current) {
    plate.style.removeProperty("--c");
    plate.style.removeProperty("--ck");
    lamp.style.backgroundImage = "";
    lamp.setAttribute("aria-hidden", "true");
    lamp.removeAttribute("aria-label");
    $("state").textContent = "עוד לא עודכן";
    $("sub").textContent = "";
    $("note").textContent = "";
    $("meta").textContent = "";
  } else {
    const [c, ck] = colors(current);
    plate.style.setProperty("--c", c);
    plate.style.setProperty("--ck", ck);
    const k = imgKey(current);
    lamp.style.backgroundImage = `url(${IMG[k]})`;
    lamp.removeAttribute("aria-hidden");
    lamp.setAttribute("aria-label", ALT[k]);
    $("state").textContent = LABEL[current.state] || "—";
    $("sub").textContent = current.state === "in" ? AVAIL[current.avail] || "" : "";
    $("note").textContent = current.note || "";
    $("meta").textContent = current.updatedAt
      ? `עודכן ${ago(current.updatedAt)}${current.source === "geofence" ? " (אוטומטי)" : ""}`
      : "";
  }
  document.querySelectorAll("button[data-s]").forEach((b) =>
    b.setAttribute("aria-pressed", String(!!current && b.dataset.s === current.state)));
  document.querySelectorAll("button[data-a]").forEach((b) =>
    b.setAttribute("aria-pressed", String(!!current && current.state === "in" && b.dataset.a === current.avail)));
  $("availRow").hidden = !(current && current.state === "in");
  if (current && document.activeElement !== $("noteInput")) $("noteInput").value = current.note || "";
}

function setStatus(s) {
  current = s && s.state ? s : null;
  render();
}

// Relative time refresh: purely local, no network.
setInterval(() => { if (current && current.updatedAt) render(); }, 60_000);

// ---------- live updates: SSE with polling fallback ----------
async function fetchStatus() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (res.status === 204) setStatus(null);
    else if (res.ok) setStatus(await res.json());
  } catch {}
}

function startPolling() {
  if (pollTimer) return;
  fetchStatus();
  pollTimer = setInterval(fetchStatus, POLL_MS);
}
function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function connect() {
  if (!("EventSource" in window)) { startPolling(); return; }
  const es = new EventSource("/api/stream");
  es.addEventListener("status", (e) => {
    try { setStatus(JSON.parse(e.data)); } catch {}
  });
  es.addEventListener("open", stopPolling);
  // EventSource retries on its own; poll meanwhile so the page never goes stale.
  es.addEventListener("error", startPolling);
}

// ---------- editor mode ----------
function showEditor(on) {
  $("controls").hidden = !on;
  $("logout").hidden = !on;
  $("hint").textContent = on
    ? "שינוי כאן מופיע מיד אצל כל מי שפותח את הדף."
    : "הדף מתעדכן אוטומטית.";
}

async function checkAuth() {
  if (!token) { showEditor(false); return; }
  try {
    const res = await fetch("/api/auth/check", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.status === 401) { token = null; clearToken(); }
    showEditor(res.ok);
  } catch {
    showEditor(false);
  }
}

function setButtonsDisabled(d) {
  document.querySelectorAll(".controls button").forEach((b) => { b.disabled = d; });
}

async function write(patch) {
  if (!token || busy) return;
  busy = true;
  $("err").textContent = "";
  setButtonsDisabled(true);
  const before = current;
  // Optimistic: mirror the server's merge rules locally, roll back on failure.
  const base = current || { state: "out", avail: "free", note: "" };
  const arriving = patch.state === "in" && patch.avail === undefined;
  setStatus({
    ...base,
    state: patch.state ?? base.state,
    avail: arriving ? "free" : (patch.avail ?? base.avail),
    note: patch.note ?? (arriving ? "" : base.note),
    updatedAt: new Date().toISOString(),
    source: "manual",
  });
  try {
    const res = await fetch("/api/status", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    });
    if (res.status === 401) {
      token = null;
      clearToken();
      showEditor(false);
      throw new Error("unauthorized");
    }
    if (!res.ok) throw new Error(String(res.status));
    setStatus(await res.json());
  } catch (e) {
    setStatus(before);
    $("err").textContent = e && e.message === "unauthorized"
      ? "אין הרשאה לעדכן."
      : "העדכון לא נשמר. בדוק חיבור ונסה שוב.";
  } finally {
    busy = false;
    setButtonsDisabled(false);
  }
}

document.querySelectorAll("button[data-s]").forEach((b) =>
  b.addEventListener("click", () => {
    write(b.dataset.s === "in"
      ? { state: "in", avail: "free", note: "" }
      : { state: "out", note: $("noteInput").value.trim() });
  }));
document.querySelectorAll("button[data-a]").forEach((b) =>
  b.addEventListener("click", () => write({ state: "in", avail: b.dataset.a })));
$("saveNote").addEventListener("click", () => write({ note: $("noteInput").value.trim() }));
$("noteInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("saveNote").click(); });
$("logout").addEventListener("click", (e) => {
  e.preventDefault();
  token = null;
  clearToken();
  showEditor(false);
});

// ---------- boot ----------
(function boot() {
  const url = new URL(location.href);
  const key = url.searchParams.get("key");
  if (key) {
    storeToken(key);
    url.searchParams.delete("key");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  token = key || readToken();
  fetchStatus();
  connect();
  checkAuth();
})();
