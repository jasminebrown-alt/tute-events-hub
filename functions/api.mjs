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
  // Post-event feedback from the BD team lives under feedback/<eventId>/<person>
  const fb = (await s.list({ prefix: "feedback/" })).blobs;
  const fbs = (await Promise.all(fb.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
  events.forEach((e) => { const mine = fbs.filter((f) => f.eventId === e.id); if (mine.length || !e.feedback) e.feedback = mine.sort((a, b) => String(a.at).localeCompare(String(b.at))); });
  const rev = (await s.get("rev")) || "0";
  return { master, events, state, rev };
}

// What the read-only team login is allowed to see: briefing data only.
function forTeam(all) {
  const master = Object.assign({}, all.master, { PIPELINE: [], REQUESTS: [], HISTORY: [] });
  const events = all.events.map((e) => {
    if (!e.briefShared) return { id: e.id, name: e.name, short: e.short, start: e.start, end: e.end, venue: e.venue, city: e.city, type: e.type, region: e.region || "", booking: e.booking || "", noFeedback: !!e.noFeedback, template: e.template, settings: e.settings || [], phases: e.phases || [], logo: e.logo || '', attendees: (e.attendees || []).map((x) => ({ p: x.p })), feedbackBy: (e.feedback || []).map((f) => f.by), briefShared: false };
    const c = JSON.parse(JSON.stringify(e));
    c.budgetLines = [];
    c.tasks = [];
    if (c.lead) delete c.lead.hubLinks;
    (c.attendees || []).forEach((a) => { a.notes = ""; });
    c.feedbackBy = (c.feedback || []).map((f) => f.by); delete c.feedback;
    c.contacts = (c.contacts || []).filter((k) => k.brief);
    delete c.portals;
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
const rowId = (p) => p.rid || (slug(p.name) + "-" + (p.date || "tbc"));
const okPath = (p) => p === "state/shared" || p === "master/data" || /^events\/[A-Za-z0-9_-]{1,60}$/.test(p);

export default async (req) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, "");
  if (!env("MARKETING_PASSWORD") || !env("TEAM_PASSWORD")) return json({ error: "Passwords not set up yet. Add MARKETING_PASSWORD and TEAM_PASSWORD in Netlify, then redeploy." }, 503);
  // Uploaded images and PDFs: served by their random id (hard to guess, so links can sit in <img> tags).
  const fm = route.match(/^file\/([a-f0-9]{24}\.(?:jpg|png|webp|gif|pdf))$/);
  if (fm && req.method === "GET") {
    const got = await store().getWithMetadata("files/" + fm[1], { type: "arrayBuffer" });
    if (!got) return new Response("Not found", { status: 404 });
    return new Response(got.data, { headers: { "content-type": (got.metadata && got.metadata.type) || "application/octet-stream", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
  }
  const role = roleOf(req);
  if (!role) { await new Promise((r) => setTimeout(r, 600)); return json({ error: "Wrong password" }, 401); }
  const s = store();
  await ensureSeeded(s);

  if (route === "login") return json({ role });
  if (route === "upload") {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    if (role !== "marketing") return json({ error: "Read-only login" }, 403);
    const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };
    if (!EXT[type]) return json({ error: "Upload a JPG, PNG, WebP, GIF or PDF." }, 400);
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) return json({ error: "That file is empty." }, 400);
    if (buf.byteLength > 4.5 * 1024 * 1024) return json({ error: "That file is over 4.5 MB. Try a smaller version." }, 413);
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12))).map((x) => x.toString(16).padStart(2, "0")).join("") + "." + EXT[type];
    const name = decodeURIComponent(req.headers.get("x-file-name") || "").slice(0, 160);
    await s.set("files/" + id, buf, { metadata: { type, name, at: new Date().toISOString() } });
    return json({ ok: true, url: "/api/file/" + id, name, type });
  }
  if (route === "rev") return json({ rev: (await s.get("rev")) || "0" });
  if (route === "all") { const all = await loadAll(s); return json(role === "marketing" ? all : forTeam(all)); }

  // ---- BD event requests (team or marketing) ----
  if (route === "requests") {
    const all = await loadAll(s);
    const dec = (all.state && all.state.decide) || {}, ps = (all.state && all.state.pipeStatus) || {};
    const P = (all.master && all.master.PEOPLE) || {};
    const fromPipe = ((all.master && all.master.PIPELINE) || []).filter((r) => r.source === "Partnerships request").map((r) => {
      const who = P[r.bd] || Object.values(P).find((x) => x.init && x.init.toUpperCase() === String(r.bd || "").toUpperCase()) || null;
      return Object.assign({}, r, { bd: who ? who.init : (r.bd || ""), submittedBy: r.submittedBy || (who ? who.name : ""), submittedAt: r.submittedAt || r.addedAt || "" });
    });
    const out = ((all.master && all.master.REQUESTS) || []).concat(fromPipe).map((r) => {
      const id = rowId(r), d = dec[id] || {};
      let status = ps[id] || r.status || "To decide", why = "";
      if (d.d === "approved") status = "Approved";
      else if (d.d === "declined" || (r.ruledOut && d.d !== "restored")) { status = "Declined"; why = d.why || r.ruledOutWhy || ""; }
      return { name: r.name, date: r.date || "", dateNote: r.dateNote || "", bd: r.bd || "", location: r.location || "", status, why, submittedAt: r.submittedAt || "", submittedBy: r.submittedBy || "" };
    });
    return json({ requests: out });
  }
  // ---- Partnerships team: merch they've sent on, or their current count ----
  if (route === "merch") {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const t = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
    const by = t(b.by, 10), act = t(b.act, 10), to = t(b.to, 40), note = t(b.note, 200), q0 = b.q && typeof b.q === "object" ? b.q : {};
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await s.getWithMetadata("master/data", { type: "json" });
      const m = cur && cur.data ? cur.data : {}; const P = m.PEOPLE || {}; const MER = m.MERCH || [];
      if (!P[by]) return json({ error: "Pick your name first." }, 400);
      const q = {}; MER.forEach((x) => { const n = parseInt(q0[x.id], 10); if (!isNaN(n) && n >= 0 && n < 100000) q[x.id] = n; });
      const ST = JSON.parse(JSON.stringify(m.STOCK || { holders: [{ id: "office", name: "Office" }], held: { office: {} }, log: [] }));
      ST.held = ST.held || {}; ST.holders = ST.holders || [];
      const ensure = (id) => { if (!ST.holders.some((h) => h.id === id)) ST.holders.push({ id, name: id === "office" ? "Office" : P[id].name, note: "" }); return ST.held[id] || (ST.held[id] = {}); };
      const mine = ensure(by); const nm = (h) => (h === "office" ? "Office" : P[h] ? P[h].name : h);
      const txt = (o) => MER.filter((x) => o[x.id]).map((x) => o[x.id] + " " + x.name.toLowerCase()).join(", ");
      let text = "";
      if (act === "count") { MER.forEach((x) => { if (q[x.id] !== undefined) mine[x.id] = q[x.id]; }); text = P[by].name + " updated their count: " + MER.map((x) => (Number(mine[x.id]) || 0) + " " + x.name.toLowerCase()).join(", ") + " (their update)"; }
      else if (act === "send") {
        if (!(to === "office" || P[to]) || to === by) return json({ error: "Pick who you sent it to." }, 400);
        const send = {}; MER.forEach((x) => { if (q[x.id] > 0) send[x.id] = q[x.id]; });
        if (!Object.keys(send).length) return json({ error: "Add how many you sent." }, 400);
        const short = MER.filter((x) => send[x.id] > (Number(mine[x.id]) || 0));
        if (short.length) return json({ error: "You’re down as having " + short.map((x) => (Number(mine[x.id]) || 0) + " " + x.name.toLowerCase()).join(", ") + ". Use Update my count first if that’s wrong." }, 400);
        const theirs = ensure(to); MER.forEach((x) => { if (send[x.id]) { mine[x.id] = (Number(mine[x.id]) || 0) - send[x.id]; theirs[x.id] = (Number(theirs[x.id]) || 0) + send[x.id]; } });
        text = txt(send) + ": " + P[by].name + " → " + nm(to) + " (sent, logged by " + P[by].name.split(" ")[0] + ")";
      } else return json({ error: "Bad request" }, 400);
      if (note) text += " · " + note;
      ST.log = (ST.log || []).concat([{ at: new Date().toISOString(), text }]).slice(-60);
      const res = await s.setJSON("master/data", Object.assign({}, m, { STOCK: ST }), cur && cur.etag ? { onlyIfMatch: cur.etag } : {});
      if (!res || res.modified !== false) { await s.set("rev", String(Date.now())); return json({ ok: true }); }
    }
    return json({ error: "Busy, try again" }, 409);
  }
  // ---- Partnerships team: confirm stand kit arrived, or say they've sent it on ----
  if (route === "kit") {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const t = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
    const id = t(b.id, 120), by = t(b.by, 10), act = t(b.act, 10), to = t(b.to, 40), note = t(b.note, 200);
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await s.getWithMetadata("master/data", { type: "json" });
      const m = cur && cur.data ? cur.data : {}; const P = m.PEOPLE || {};
      if (!P[by]) return json({ error: "Pick your name first." }, 400);
      const ST = JSON.parse(JSON.stringify(m.STOCK || {})); const k = (ST.kit || []).find((x) => x.id === id);
      if (!k || k.holder !== by) return json({ error: "That kit isn’t down as being with you. Tell Marketing." }, 400);
      const today = new Date().toISOString().slice(0, 10); const nm = (h) => (h === "office" ? "Office" : P[h] ? P[h].name : h); let text = "";
      if (act === "arrived") { if (!k.transit) return json({ ok: true }); k.transit = false; k.transitFrom = ""; k.since = today; text = k.name + " arrived with " + P[by].name + " (confirmed by them)"; }
      else if (act === "send") { if (!(to === "office" || P[to]) || to === by) return json({ error: "Pick who you sent it to." }, 400); k.transitFrom = by; k.transit = true; k.holder = to; k.since = today; text = k.name + ": " + P[by].name + " → " + nm(to) + " (courier sent, logged by " + P[by].name.split(" ")[0] + ")"; }
      else return json({ error: "Bad request" }, 400);
      if (note) text += " · " + note;
      ST.log = (ST.log || []).concat([{ at: new Date().toISOString(), text }]).slice(-60);
      const next = Object.assign({}, m, { STOCK: ST });
      const res = await s.setJSON("master/data", next, cur && cur.etag ? { onlyIfMatch: cur.etag } : {});
      if (!res || res.modified !== false) { await s.set("rev", String(Date.now())); return json({ ok: true }); }
    }
    return json({ error: "Busy, try again" }, 409);
  }
  if (route === "feedback") {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const t = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
    const num = (v) => { const n = parseInt(String(v || "").replace(/[^0-9]/g, ""), 10); return isNaN(n) ? "" : Math.min(n, 9999); };
    const pick = (v, list) => (list.includes(v) ? v : "");
    const id = t(b.eventId, 60), by = t(b.by, 10);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || !(await s.get("events/" + id))) return json({ error: "Pick the event." }, 400);
    const master = await s.get("master/data", { type: "json" });
    if (!/^[a-z0-9]+$/i.test(by) || !(master && master.PEOPLE && master.PEOPLE[by])) return json({ error: "Pick your name." }, 400);
    const scale = (v) => { const n = num(v); return n ? Math.min(5, Math.max(1, n)) : ""; };
    const SPOKE = ["Headteachers / senior leaders", "SENDCOs / inclusion leads", "Attendance leads", "Local authority / commissioning teams", "Alternative provision leaders", "Teachers / school staff", "MAT / trust leaders", "Other"];
    const rec = { eventId: id, by, at: new Date().toISOString(), form: 2,
      with: t(b.with, 300),
      relevance: scale(b.relevance), spokeTo: (Array.isArray(b.spokeTo) ? b.spokeTo : []).filter((x) => SPOKE.includes(x)), spokeOther: t(b.spokeOther, 200),
      engagement: scale(b.engagement),
      capture: pick(b.capture, ["Badge scanner / digital lead capture", "Printed lead capture forms", "Other"]),
      leads: num(b.leads), hot: num(b.hot),
      promising: pick(b.promising, ["Yes, several", "Yes, one or two", "Not at this event"]),
      rating: scale(b.rating),
      rebook: pick(b.rebook, ["Yes – definitely", "Yes – but with changes", "Maybe – depends on cost/package", "Probably not"]),
      why: t(b.why, 2000), improve: t(b.improve, 2000), competitors: t(b.competitors, 1000), worked: t(b.worked, 2000), missing: t(b.missing, 2000), other: t(b.other, 2000),
      merchSelf: pick(b.merchSelf, ["Yes", "No - managed by Creative Spaces Design"]), kit: t(b.kit, 1000) };
    if (!rec.relevance || !rec.engagement || !rec.rating || !rec.rebook || !rec.capture || !rec.promising || !rec.merchSelf || !rec.spokeTo.length || rec.leads === "" || rec.hot === "" || !rec.why || !rec.improve) return json({ error: "Please answer all the questions marked *." }, 400);
    await s.setJSON("feedback/" + id + "/" + by, rec);
    await s.set("rev", String(Date.now()));
    return json({ ok: true });
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
