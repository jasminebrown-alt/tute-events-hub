// Tute Events Hub - data API. Stores everything in Netlify Blobs.
// Passwords come from the site's environment variables:
//   MARKETING_PASSWORD - full Hub, can edit
//   TEAM_PASSWORD      - attendee briefings only, read-only
import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";
import SEED from "./seed.mjs";

const env = (k) => (globalThis.Netlify && Netlify.env ? Netlify.env.get(k) : process.env[k]) || "";
const hash = (s) => createHash("sha256").update(String(s || "")).digest();
const same = (a, b) => !!b && timingSafeEqual(hash(a), hash(b));
const roleOf = (req) => {
  const p = req.headers.get("x-tute-pass") || "";
  if (!p) return null;
  if (same(p, env("MARKETING_PASSWORD"))) return "marketing";
  if (same(p, env("TEAM_PASSWORD"))) return "team";
  return null;
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const store = () => getStore({ name: "tute-hub", consistency: "strong" });

async function ensureSeeded(s) {
  if (await s.get("master/data")) return;
  await s.setJSON("master/data", SEED.master);
  await s.setJSON("state/shared", SEED.state);
  for (const e of SEED.events) await s.setJSON("events/" + e.id, e);
  await s.set("rev", String(Date.now()));
}

async function loadAll(s) {
  const master = await s.get("master/data", { type: "json" });
  const state = (await s.get("state/shared", { type: "json" })) || {};
  const { blobs } = await s.list({ prefix: "events/" });
  const events = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
  const rev = (await s.get("rev")) || "0";
  return { master, events, state, rev };
}

// What the read-only team login is allowed to see: briefing data only.
function forTeam(all) {
  const master = Object.assign({}, all.master, { PIPELINE: [], REQUESTS: [], HISTORY: [] });
  const events = all.events.map((e) => {
    const c = JSON.parse(JSON.stringify(e));
    c.budgetLines = [];
    c.tasks = [];
    if (c.lead) delete c.lead.hubLinks;
    (c.attendees || []).forEach((a) => { a.notes = ""; });
    return c;
  });
  return { master, events, state: all.state, rev: all.rev };
}

function merge(target, patch) {
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (v.__delete__ === true) { delete target[k]; continue; }
      const base = target[k] && typeof target[k] === "object" && !Array.isArray(target[k]) ? target[k] : {};
      target[k] = merge(base, v);
    } else target[k] = v;
  }
  return target;
}

const slug = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
const rowId = (p) => slug(p.name) + "-" + (p.date || "tbc");
const okPath = (p) => p === "state/shared" || p === "master/data" || /^events\/[A-Za-z0-9_-]{1,60}$/.test(p);

export default async (req) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, "");
  if (!env("MARKETING_PASSWORD") || !env("TEAM_PASSWORD")) return json({ error: "Passwords not set up yet. Add MARKETING_PASSWORD and TEAM_PASSWORD in Netlify, then redeploy." }, 503);
  const role = roleOf(req);
  if (!role) { await new Promise((r) => setTimeout(r, 600)); return json({ error: "Wrong password" }, 401); }
  const s = store();
  await ensureSeeded(s);

  if (route === "login") return json({ role });
  if (route === "rev") return json({ rev: (await s.get("rev")) || "0" });
  if (route === "all") { const all = await loadAll(s); return json(role === "marketing" ? all : forTeam(all)); }

  // ---- BD event requests (team or marketing) ----
  if (route === "requests") {
    const all = await loadAll(s);
    const dec = (all.state && all.state.decide) || {}, ps = (all.state && all.state.pipeStatus) || {};
    const out = ((all.master && all.master.REQUESTS) || []).map((r) => {
      const id = rowId(r), d = dec[id] || {};
      let status = ps[id] || r.status || "To decide", why = "";
      if (d.d === "approved") status = "Approved";
      else if (d.d === "declined" || (r.ruledOut && d.d !== "restored")) { status = "Declined"; why = d.why || r.ruledOutWhy || ""; }
      return { name: r.name, date: r.date || "", dateNote: r.dateNote || "", bd: r.bd || "", location: r.location || "", status, why, submittedAt: r.submittedAt || "", submittedBy: r.submittedBy || "" };
    });
    return json({ requests: out });
  }
  if (route === "request") {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const t = (v, n) => String(v || "").trim().slice(0, n);
    const name = t(b.name, 160), by = t(b.by, 10);
    if (!name) return json({ error: "Add the event name." }, 400);
    if (!by) return json({ error: "Pick your name." }, 400);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : "";
    const end = /^\d{4}-\d{2}-\d{2}$/.test(b.end || "") && b.end >= date ? b.end : "";
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(b.deadline || "") ? b.deadline : "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await s.getWithMetadata("master/data", { type: "json" });
      const m = cur && cur.data ? cur.data : {};
      const P = m.PEOPLE || {}; const person = P[by];
      if (!person) return json({ error: "Pick your name from the list." }, 400);
      const reqs = (m.REQUESTS || []).slice();
      if (reqs.some((r) => rowId(r) === rowId({ name, date }))) return json({ error: "That event has already been requested." }, 409);
      const facts = [];
      if (t(b.why, 1500)) facts.push("Why: " + t(b.why, 1500));
      if (deadline) facts.push("Booking deadline: " + deadline);
      facts.push("Requested by " + person.name + " on " + new Date().toISOString().slice(0, 10));
      const rec = { name, date, link: t(b.link, 400), location: t(b.location, 120), region: t(b.region, 40), type: t(b.type, 40), audience: t(b.audience, 80),
        cost: t(b.cost, 80) || null, bd: person.init || by.toUpperCase(), notes: t(b.why, 1500), status: "New request", facts,
        contact: t(b.contact, 200), submittedBy: person.name, submittedAt: new Date().toISOString() };
      if (end) rec.end = end;
      if (deadline) rec.deadline = deadline;
      if (!date) rec.dateNote = "Date TBC";
      reqs.push(rec);
      const next = Object.assign({}, m, { REQUESTS: reqs });
      const res = await s.setJSON("master/data", next, cur && cur.etag ? { onlyIfMatch: cur.etag } : {});
      if (!res || res.modified !== false) { await s.set("rev", String(Date.now())); return json({ ok: true }); }
    }
    return json({ error: "Busy, try again" }, 409);
  }

  if (route === "export") {
    if (role !== "marketing") return json({ error: "Read-only login" }, 403);
    const all = await loadAll(s);
    return json({ kind: "tute-events-hub-backup", exportedAt: new Date().toISOString(), master: all.master, state: all.state, events: all.events });
  }

  // Apply an update file prepared by Claude: { kind: "tute-events-hub-update", updates: [{ op, path, data }] }
  if (route === "import") {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    if (role !== "marketing") return json({ error: "Read-only login" }, 403);
    let body; try { body = await req.json(); } catch { return json({ error: "That file isn’t valid JSON." }, 400); }
    let ups = [];
    if (body && body.kind === "tute-events-hub-update" && Array.isArray(body.updates)) ups = body.updates;
    else if (body && body.kind === "tute-events-hub-backup") {
      ups = [{ op: "set", path: "master/data", data: body.master }, { op: "set", path: "state/shared", data: body.state || {} }]
        .concat((body.events || []).map((e) => ({ op: "set", path: "events/" + e.id, data: e })));
    } else return json({ error: "That isn’t a Tute Events Hub update file." }, 400);
    for (const u of ups) {
      if (!u || !okPath(u.path) || !["set", "update", "delete"].includes(u.op)) return json({ error: "Bad entry in the file: " + JSON.stringify(u && u.path) }, 400);
      if (u.op !== "delete" && (!u.data || typeof u.data !== "object")) return json({ error: "Missing data for " + u.path }, 400);
    }
    await s.setJSON("backup/" + Date.now(), await loadAll(s)); // safety copy before changing anything
    for (const u of ups) {
      if (u.op === "delete") { if (u.path.startsWith("events/")) await s.delete(u.path); continue; }
      const cur = u.op === "update" ? (await s.get(u.path, { type: "json" })) || {} : {};
      await s.setJSON(u.path, u.op === "update" ? merge(cur, u.data) : u.data);
    }
    await s.set("rev", String(Date.now()));
    return json({ ok: true, applied: ups.length });
  }

  if (route === "update" || route === "set") {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    if (role !== "marketing") return json({ error: "Read-only login" }, 403);
    let body; try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const { path, patch } = body || {};
    if (!okPath(path) || !patch || typeof patch !== "object") return json({ error: "Bad request" }, 400);
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await s.getWithMetadata(path, { type: "json" });
      const next = route === "set" ? patch : merge(cur && cur.data ? cur.data : {}, patch);
      const opts = cur && cur.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
      const res = await s.setJSON(path, next, opts);
      if (!res || res.modified !== false) { await s.set("rev", String(Date.now())); return json({ ok: true }); }
    }
    return json({ error: "Busy, try again" }, 409);
  }
  return json({ error: "Not found" }, 404);
};

export const config = { path: "/api/*" };
