// Shared by the viewer page (/) and the boss page (/boss): renders the door plate
// and keeps it live via SSE, falling back to polling.

const LABEL = { in: "במשרד", out: "לא במשרד" };
const AVAIL = { free: "פנוי", busy: "עסוק" };
const IMG = { out: "/img/out-empty-chair.webp", busy: "/img/in-busy-laptop.webp", free: "/img/in-free-coffee.webp" };
const ALT = { out: "כיסא ריק", busy: "עובדת מול המחשב", free: "עם כוס קפה" };
const POLL_MS = 30_000;

export const $ = (id) => document.getElementById(id);
const plate = document.querySelector(".plate");
let current = null;
let pollTimer = null;
const listeners = [];

Object.values(IMG).forEach((u) => { new Image().src = u; });

export function getStatus() { return current; }
export function onRender(fn) { listeners.push(fn); }

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

export function render() {
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
    $("meta").textContent = current.updatedAt ? `עודכן ${ago(current.updatedAt)}` : "";
  }
  listeners.forEach((fn) => fn(current));
}

export function setStatus(s) {
  current = s && s.state ? s : null;
  render();
}

// Relative time refresh: purely local, no network.
setInterval(() => { if (current && current.updatedAt) render(); }, 60_000);

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

export function connect() {
  fetchStatus();
  if (!("EventSource" in window)) { startPolling(); return; }
  const es = new EventSource("/api/stream");
  es.addEventListener("status", (e) => {
    try { setStatus(JSON.parse(e.data)); } catch {}
  });
  es.addEventListener("open", stopPolling);
  // EventSource retries on its own; poll meanwhile so the page never goes stale.
  es.addEventListener("error", startPolling);
}
