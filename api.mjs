// ===== Bog'cha menyu — server (Netlify Functions + Netlify Blobs) =====
// Netlify -> Site configuration -> Environment variables:
//   ADMIN_PASSWORD  (majburiy)  admin panel paroli
//   PRICE, BONUS_EVERY, BONUS_FREE, BONUS_DAYS, FREE_MONTHLY, FILES_MAX  (ixtiyoriy)
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/*" };

const env = (k, d) => {
  try { const v = Netlify.env.get(k); return v == null || v === "" ? d : v; } catch { return process.env[k] ?? d; }
};
const num = (k, d) => { const v = Number(env(k, d)); return Number.isFinite(v) ? v : d; };
const SET = () => ({
  price: num("PRICE", 50000),
  bonusEvery: num("BONUS_EVERY", 10),
  bonusFree: num("BONUS_FREE", 2),
  bonusDays: num("BONUS_DAYS", 60),
  freeMonthly: num("FREE_MONTHLY", 1),
  filesMax: num("FILES_MAX", 30),
});

const db = () => getStore({ name: "menyu", consistency: "strong" });
const files = () => getStore({ name: "menyu-files", consistency: "strong" });

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const E = (m, s = 400, extra = {}) => J({ error: m, ...extra }, s);

const today = () => new Date().toISOString().slice(0, 10);
const month = () => today().slice(0, 7);
const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rnd = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const tsEq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

async function pbkdf(pin, salt) {
  const k = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 100000 }, k, 256));
}

// ---- optimistik yozish (onlyIfMatch + qayta urinish) ----
async function update(store, key, fn, init) {
  for (let i = 0; i < 8; i++) {
    const r = await store.getWithMetadata(key, { type: "json" });
    const cur = r ? r.data : null;
    const next = await fn(cur ?? (init ? init() : null));
    if (next === undefined) return null; // o'zgartirish yo'q
    const opt = r ? { onlyIfMatch: r.etag } : { onlyIfNew: true };
    const w = await store.setJSON(key, next, opt);
    if (!w || w.modified !== false) return next;
  }
  throw new Error("busy");
}

// ---- yordamchilar ----
const normPhone = (p) => {
  let d = String(p || "").replace(/\D/g, "");
  if (d.length === 9) d = "998" + d;
  return /^998\d{9}$/.test(d) ? d : null;
};
const maskPhone = (p) => "+" + p.slice(0, 3) + " ** *** " + p.slice(-4);
const newUser = (phone, salt, hash) => ({
  phone, salt, hash, created: Date.now(),
  credits: [],            // {id,type:'paid'|'bonus',left,exp,src}
  paidCount: 0,           // jami pullik yuklashlar
  bonusGiven: 0,          // berilgan bonus bosqichlari
  freeMonth: "",          // oxirgi oylik bepul ishlatilgan oy
  pending: [],            // {id,kind,t}
  files: [],              // {id,t,kind,n,sum,size}
  sessions: [],           // sha256(token)
  fails: 0, lockUntil: 0, totalPaidUzs: 0,
});

function clean(u) {
  const S = SET(), t = today();
  const cr = u.credits.filter((c) => c.left > 0 && c.exp >= t).sort((a, b) => (a.exp < b.exp ? -1 : 1));
  const paidLeft = cr.filter((c) => c.type === "paid").reduce((s, c) => s + c.left, 0);
  const bonusLeft = cr.filter((c) => c.type === "bonus").reduce((s, c) => s + c.left, 0);
  const freeAvail = S.freeMonthly > 0 && u.freeMonth !== month();
  const toBonus = S.bonusEvery > 0 && S.bonusFree > 0 ? S.bonusEvery - (u.paidCount % S.bonusEvery) : 0;
  return {
    phone: u.phone, freeAvail, paidLeft, bonusLeft, total: paidLeft + bonusLeft + (freeAvail ? 1 : 0),
    paidCount: u.paidCount, bonusEvery: S.bonusEvery, bonusFree: S.bonusFree,
    progress: S.bonusEvery > 0 ? u.paidCount % S.bonusEvery : 0, toBonus,
    nextExp: cr[0] ? cr[0].exp : "", price: S.price,
    pending: u.pending, files: u.files.slice().sort((a, b) => b.t - a.t),
  };
}

async function auth(req) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+([a-f0-9]{64})$/i);
  if (!m) return null;
  const th = await sha(m[1]);
  const idx = await db().get("sess:" + th, { type: "json" });
  if (!idx) return null;
  const u = await db().get("user:" + idx.phone, { type: "json" });
  if (!u || !u.sessions.includes(th)) return null;
  return u;
}
async function isAdmin(req) {
  const pw = env("ADMIN_PASSWORD", "");
  if (!pw) return false;
  const h = (req.headers.get("x-admin") || "");
  return tsEq(await sha(h), await sha(pw));
}
const body = async (req) => { try { return await req.json(); } catch { return {}; } };

// ---- kod ----
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode() {
  const b = crypto.getRandomValues(new Uint8Array(10));
  const c = [...b].map((x) => ALPHA[x % ALPHA.length]).join("");
  return c.slice(0, 5) + "-" + c.slice(5);
}
const normCode = (c) => {
  c = String(c || "").trim();
  const i = c.indexOf("k=");
  if (i >= 0) { try { c = decodeURIComponent(c.slice(i + 2).split(/[&\s]/)[0]); } catch { c = c.slice(i + 2); } }
  c = c.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 10 ? c.slice(0, 5) + "-" + c.slice(5) : "";
};

// ---- yo'nalishlar ----
async function register(req) {
  const b = await body(req), phone = normPhone(b.phone), pin = String(b.pin || "");
  if (!phone) return E("Telefon raqam noto'g'ri. Masalan: 90 123 45 67");
  if (!/^\d{4,8}$/.test(pin)) return E("PIN 4–8 ta raqamdan iborat bo'lsin");
  const salt = rnd(8), hash = await pbkdf(pin, salt);
  const token = rnd(32), th = await sha(token);
  const u0 = newUser(phone, salt, hash); u0.sessions = [th];
  const w = await db().setJSON("user:" + phone, u0, { onlyIfNew: true });
  if (w && w.modified === false) return E("Bu raqam ro'yxatdan o'tgan. \"Kirish\" ni bosing", 409);
  await db().setJSON("sess:" + th, { phone, t: Date.now() });
  return J({ token, me: clean(u0) });
}
async function login(req) {
  const b = await body(req), phone = normPhone(b.phone), pin = String(b.pin || "");
  if (!phone) return E("Telefon raqam noto'g'ri");
  const u = await db().get("user:" + phone, { type: "json" });
  if (!u) return E("Bu raqam topilmadi. Avval ro'yxatdan o'ting", 404);
  if (u.lockUntil > Date.now()) return E("Ko'p marta xato kiritildi. " + Math.ceil((u.lockUntil - Date.now()) / 60000) + " daqiqadan keyin urinib ko'ring", 429);
  const ok = tsEq(await pbkdf(pin, u.salt), u.hash);
  if (!ok) {
    await update(db(), "user:" + phone, (x) => { x.fails = (x.fails || 0) + 1; if (x.fails >= 5) { x.lockUntil = Date.now() + 15 * 60000; x.fails = 0; } return x; });
    return E("PIN noto'g'ri", 401);
  }
  const token = rnd(32), th = await sha(token);
  const nu = await update(db(), "user:" + phone, (x) => { x.fails = 0; x.sessions = [...x.sessions, th].slice(-8); return x; });
  await db().setJSON("sess:" + th, { phone, t: Date.now() });
  return J({ token, me: clean(nu) });
}
async function logout(req, u) {
  const token = (req.headers.get("authorization") || "").slice(7), th = await sha(token);
  await update(db(), "user:" + u.phone, (x) => { x.sessions = x.sessions.filter((s) => s !== th); return x; });
  await db().delete("sess:" + th);
  return J({ ok: true });
}
async function changePin(req, u) {
  const b = await body(req), pin = String(b.pin || ""), old = String(b.old || "");
  if (!/^\d{4,8}$/.test(pin)) return E("Yangi PIN 4–8 ta raqam bo'lsin");
  if (!tsEq(await pbkdf(old, u.salt), u.hash)) return E("Eski PIN noto'g'ri", 401);
  const salt = rnd(8), hash = await pbkdf(pin, salt);
  await update(db(), "user:" + u.phone, (x) => { x.salt = salt; x.hash = hash; return x; });
  return J({ ok: true });
}

async function redeem(req, u) {
  const b = await body(req), code = normCode(b.code);
  if (!code) return E("Kod noto'g'ri. Kod 10 ta harf/raqamdan iborat: XXXXX-XXXXX");
  const cr0 = await db().getWithMetadata("code:" + code, { type: "json" });
  const c = cr0 && cr0.data;
  if (!c) return E("Kod topilmadi. Tekshirib qayta kiriting", 404);
  if (c.revoked) return E("Bu kod bekor qilingan. Admin bilan bog'laning", 410);
  if (c.usedBy) {
    if (c.usedBy === u.phone) return E("Bu kod sizning hisobingizga allaqachon qo'shilgan", 409);
    const d = new Date(c.usedAt).toISOString().slice(0, 10);
    return E("Bu kod ishlatilgan (" + d + "). Boshqa qurilmada yoki boshqa raqamda faollashtirilgan. Yangi kod uchun to'lov qiling", 409);
  }
  if (c.exp < today()) return E("Kodning muddati tugagan (" + c.exp + "). Admin bilan bog'laning", 410);
  if (c.phone && c.phone !== u.phone) return E("Bu kod boshqa raqam uchun berilgan", 403);
  // kodni "band qilish": faqat bitta so'rov o'tadi
  const claimed = { ...c, usedBy: u.phone, usedAt: Date.now() };
  const w = await db().setJSON("code:" + code, claimed, { onlyIfMatch: cr0.etag });
  if (w && w.modified === false) return E("Bu kod hozirgina ishlatildi", 409);
  const S = SET();
  const nu = await update(db(), "user:" + u.phone, (x) => {
    x.credits.push({ id: "c" + rnd(4), type: "paid", left: c.count, exp: c.exp, src: code });
    x.totalPaidUzs = (x.totalPaidUzs || 0) + (c.free ? 0 : c.count * S.price);
    return x;
  });
  return J({ ok: true, added: c.count, me: clean(nu) });
}

// yuklab olishni band qilish: oylik bepul -> bonus -> pullik
async function reserve(req, u) {
  const S = SET();
  let kind = null, id = "d" + rnd(6);
  const nu = await update(db(), "user:" + u.phone, (x) => {
    const t = today();
    x.pending = x.pending || [];
    if (x.pending.length >= 5) { kind = "full"; return undefined; }
    if (S.freeMonthly > 0 && x.freeMonth !== month()) { x.freeMonth = month(); kind = "free"; }
    else {
      const cr = x.credits.filter((c) => c.left > 0 && c.exp >= t).sort((a, b) => {
        if (a.type !== b.type) return a.type === "bonus" ? -1 : 1;
        return a.exp < b.exp ? -1 : 1;
      })[0];
      if (!cr) { kind = null; return undefined; }
      const real = x.credits.find((c) => c.id === cr.id);
      real.left -= 1; kind = cr.type; // 'bonus' | 'paid'
      if (kind === "paid") {
        x.paidCount += 1;
        if (S.bonusEvery > 0 && S.bonusFree > 0 && x.paidCount % S.bonusEvery === 0) {
          x.credits.push({ id: "b" + rnd(4), type: "bonus", left: S.bonusFree, exp: addDays(S.bonusDays), src: "bonus" });
          x.bonusGiven += 1;
        }
      }
    }
    x.credits = x.credits.filter((c) => c.left > 0 || c.exp >= addDays(-30));
    x.pending.push({ id, kind, t: Date.now(), month: month() });
    return x;
  });
  if (kind === "full") return E("Avval oldingi yuklashlarni yakunlang (\"Fayllarim\" bo'limi)", 409);
  if (!kind || !nu) return E("Yuklash huquqi yo'q", 402, { need: "pay" });
  return J({ id, kind, me: clean(nu) });
}
async function cancel(req, u) {
  const b = await body(req), id = String(b.id || "");
  const nu = await update(db(), "user:" + u.phone, (x) => {
    const p = (x.pending || []).find((q) => q.id === id);
    if (!p) return undefined;
    x.pending = x.pending.filter((q) => q.id !== id);
    if (p.kind === "free") { if (x.freeMonth === p.month) x.freeMonth = ""; }
    else {
      if (p.kind === "paid") {
        // pullik hisobni qaytarish (bonus berilgan bo'lsa, uni ham qaytaramiz)
        if (x.paidCount > 0 && x.paidCount % SET().bonusEvery === 0 && SET().bonusEvery > 0) {
          const i = x.credits.map((c) => c.src).lastIndexOf("bonus");
          if (i >= 0) { x.credits.splice(i, 1); x.bonusGiven = Math.max(0, x.bonusGiven - 1); }
        }
        x.paidCount = Math.max(0, x.paidCount - 1);
      }
      x.credits.push({ id: "r" + rnd(4), type: p.kind, left: 1, exp: addDays(p.kind === "bonus" ? SET().bonusDays : 30), src: "refund" });
    }
    return x;
  });
  return J({ ok: true, me: clean(nu || u) });
}
async function commit(req, u) {
  const url = new URL(req.url), id = url.searchParams.get("id") || "";
  const n = +url.searchParams.get("n") || 0, sum = +url.searchParams.get("sum") || 0;
  const buf = await req.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 5.5 * 1024 * 1024) return E("Fayl hajmi noto'g'ri", 413);
  const head = new Uint8Array(buf.slice(0, 2));
  if (head[0] !== 0x50 || head[1] !== 0x4b) return E("Bu Excel fayl emas", 400);
  const fresh = await db().get("user:" + u.phone, { type: "json" });
  const p = (fresh.pending || []).find((q) => q.id === id);
  if (!p) return E("Bunday yuklash topilmadi", 404);
  await files().set("f/" + u.phone + "/" + id, buf);
  const S = SET();
  let removed = [];
  const nu = await update(db(), "user:" + u.phone, (x) => {
    const q = (x.pending || []).find((r) => r.id === id);
    if (!q) return undefined;
    x.pending = x.pending.filter((r) => r.id !== id);
    x.files.push({ id, t: Date.now(), kind: q.kind, n, sum, size: buf.byteLength });
    x.files.sort((a, b) => b.t - a.t);
    removed = x.files.splice(Math.max(1, S.filesMax));
    return x;
  });
  for (const f of removed) await files().delete("f/" + u.phone + "/" + f.id);
  return J({ ok: true, me: clean(nu || fresh) });
}
async function getFile(req, u, id) {
  const f = u.files.find((x) => x.id === id);
  if (!f) return E("Fayl topilmadi", 404);
  const buf = await files().get("f/" + u.phone + "/" + id, { type: "arrayBuffer" });
  if (!buf) return E("Fayl serverda topilmadi", 404);
  return new Response(buf, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "cache-control": "no-store" } });
}
async function delFile(req, u, id) {
  const nu = await update(db(), "user:" + u.phone, (x) => { if (!x.files.some((f) => f.id === id)) return undefined; x.files = x.files.filter((f) => f.id !== id); return x; });
  await files().delete("f/" + u.phone + "/" + id);
  return J({ ok: true, me: clean(nu || u) });
}

// ---- admin ----
async function listAll(store, prefix) {
  const out = [];
  let cursor;
  const { blobs } = await store.list({ prefix });
  for (const b of blobs) { const d = await store.get(b.key, { type: "json" }); if (d) out.push(d); }
  return out;
}
async function adminRoute(req, path) {
  const S = SET();
  if (path === "/admin/ping") return J({ ok: true, settings: S });
  if (path === "/admin/codes/new" && req.method === "POST") {
    const b = await body(req);
    const count = Math.min(Math.max(+b.count || 1, 1), 50), days = Math.min(Math.max(+b.days || 7, 1), 365);
    const qty = Math.min(Math.max(+b.qty || 1, 1), 20);
    const phone = b.phone ? normPhone(b.phone) : null;
    if (b.phone && !phone) return E("Telefon raqam noto'g'ri");
    const made = [];
    for (let i = 0; i < qty; i++) {
      for (let t = 0; t < 5; t++) {
        const code = genCode();
        const rec = { code, count, exp: addDays(days), days, note: String(b.note || "").slice(0, 80), phone: phone || "", free: !!b.free, created: Date.now(), usedBy: "", usedAt: 0, revoked: false };
        const w = await db().setJSON("code:" + code, rec, { onlyIfNew: true });
        if (!w || w.modified !== false) { made.push(rec); break; }
      }
    }
    return J({ codes: made });
  }
  if (path === "/admin/codes") {
    const l = (await listAll(db(), "code:")).sort((a, b) => b.created - a.created).slice(0, 300);
    return J({ codes: l });
  }
  if (path === "/admin/codes/revoke" && req.method === "POST") {
    const b = await body(req), code = normCode(b.code);
    const r = await update(db(), "code:" + code, (c) => { if (!c || c.usedBy) return undefined; c.revoked = true; return c; });
    return r ? J({ ok: true }) : E("Kodni bekor qilib bo'lmadi (ishlatilgan yoki topilmadi)");
  }
  if (path === "/admin/users") {
    const l = (await listAll(db(), "user:")).map((u) => ({ ...clean(u), created: u.created, totalPaidUzs: u.totalPaidUzs || 0, filesCount: u.files.length })).sort((a, b) => b.created - a.created);
    return J({ users: l });
  }
  if (path === "/admin/users/grant" && req.method === "POST") {
    const b = await body(req), phone = normPhone(b.phone), count = Math.min(Math.max(+b.count || 1, 1), 50);
    const type = b.type === "bonus" ? "bonus" : "paid";
    if (!phone) return E("Telefon raqam noto'g'ri");
    const r = await update(db(), "user:" + phone, (u) => {
      if (!u) return undefined;
      u.credits.push({ id: "g" + rnd(4), type, left: count, exp: addDays(type === "bonus" ? S.bonusDays : 30), src: "admin" });
      return u;
    });
    return r ? J({ ok: true }) : E("Bunday foydalanuvchi yo'q. U avval ro'yxatdan o'tishi kerak", 404);
  }
  if (path === "/admin/users/resetpin" && req.method === "POST") {
    const b = await body(req), phone = normPhone(b.phone), pin = String(b.pin || "");
    if (!phone || !/^\d{4,8}$/.test(pin)) return E("Raqam yoki PIN noto'g'ri");
    const salt = rnd(8), hash = await pbkdf(pin, salt);
    const r = await update(db(), "user:" + phone, (u) => { if (!u) return undefined; u.salt = salt; u.hash = hash; u.fails = 0; u.lockUntil = 0; return u; });
    return r ? J({ ok: true }) : E("Foydalanuvchi topilmadi", 404);
  }
  return E("Topilmadi", 404);
}

export default async (req) => {
  try {
    const path = new URL(req.url).pathname.replace(/^\/api/, "") || "/";
    if (path === "/config") { const S = SET(); return J({ price: S.price, bonusEvery: S.bonusEvery, bonusFree: S.bonusFree, freeMonthly: S.freeMonthly }); }
    if (path.startsWith("/admin")) {
      if (!(await isAdmin(req))) return E("Admin paroli noto'g'ri", 401);
      return await adminRoute(req, path);
    }
    if (path === "/register" && req.method === "POST") return await register(req);
    if (path === "/login" && req.method === "POST") return await login(req);
    const u = await auth(req);
    if (!u) return E("Hisobga kiring", 401, { login: true });
    if (path === "/me") return J({ me: clean(u) });
    if (path === "/logout" && req.method === "POST") return await logout(req, u);
    if (path === "/pin" && req.method === "POST") return await changePin(req, u);
    if (path === "/redeem" && req.method === "POST") return await redeem(req, u);
    if (path === "/reserve" && req.method === "POST") return await reserve(req, u);
    if (path === "/cancel" && req.method === "POST") return await cancel(req, u);
    if (path === "/commit" && req.method === "POST") return await commit(req, u);
    const m = path.match(/^\/files\/([a-z0-9]+)$/);
    if (m && req.method === "GET") return await getFile(req, u, m[1]);
    if (m && req.method === "DELETE") return await delFile(req, u, m[1]);
    return E("Topilmadi", 404);
  } catch (e) {
    return E(e && e.message === "busy" ? "Server band, qayta urinib ko'ring" : "Server xatosi", 500);
  }
};
