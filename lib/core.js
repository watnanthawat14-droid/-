// Backend logic ported from Google Apps Script (code.gs.js) to Node (Vercel) + Google Sheets API
const crypto = require('crypto');

const APP = { sheets: { clients: 'Clients', accountants: 'Accountants', auditors: 'Auditors', rateAcct: 'RateAccounting', rateAudit: 'RateAudit', users: 'Users' } };
const AUTH = { ttl: 21600, iterations: 20000, maxFailures: 5, lockMs: 900000 };
const CLIENT_HEAD = ['ClientID','Year','Seq','Name','TaxID','Type','Business','VAT','SS','Stock','Consult','DocVolume','Difficulty','Months','Revenue','Accountant','AdjAccounting','Auditor','AdjAudit','Quoted','Paid','AuditorPaid','Note','Capital','TotalAssets'];

// ---------- helpers ----------
const E = m => { const e = new Error(m); e.user = true; return e; };
const bool_ = v => v === true || String(v).trim().toLowerCase() === 'true';
const authEmail_ = v => String(v || '').trim().toLowerCase();
function numOrText_(v) { if (v === '' || v == null) return ''; if (typeof v === 'number') return v; const t = String(v).trim(); if (t === 'งบเปล่า' || t === 'มีแต่ค่าใช้จ่าย') return t; const n = Number(t.replace(/,/g, '')); return isFinite(n) ? n : ''; }
function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

// ---------- Google Sheets ----------
let _api = null, _sheetIds = null;
function api() {
  if (!_api) {
    const { google } = require('googleapis');
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
    if (!creds.client_email) throw new Error('ยังไม่ได้ตั้งค่า GOOGLE_SERVICE_ACCOUNT');
    const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    _api = google.sheets({ version: 'v4', auth });
  }
  return _api;
}
const SID = () => { if (!process.env.SHEET_ID) throw new Error('ยังไม่ได้ตั้งค่า SHEET_ID'); return process.env.SHEET_ID; };
async function readSheet(name) {
  try {
    const r = await api().spreadsheets.values.get({ spreadsheetId: SID(), range: `'${name}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    return r.data.values || [];
  } catch (e) { if (/Unable to parse range|not found/i.test(e.message)) throw E('ไม่พบชีต ' + name + ' (ตรวจชื่อชีตให้ตรงตามคู่มือ)'); throw e; }
}
// คืน {head, rows:[{r:เลขแถวในชีต, v:[...]}]} ; rows ข้ามแถวว่าง
async function table(name) {
  const vals = await readSheet(name);
  const head = (vals[0] || []).map(String);
  const rows = [];
  for (let i = 1; i < vals.length; i++) {
    const v = vals[i] || [];
    if (!v.some(x => x !== '' && x != null)) continue;
    const p = head.map((_, k) => (v[k] === undefined ? '' : v[k]));
    rows.push({ r: i + 1, v: p });
  }
  return { head, rows };
}
const objs = t => t.rows.map(x => { const o = {}; t.head.forEach((k, i) => { o[k] = x.v[i]; }); return o; });
async function sheetId(name) {
  if (!_sheetIds) {
    const r = await api().spreadsheets.get({ spreadsheetId: SID(), fields: 'sheets.properties' });
    _sheetIds = {}; r.data.sheets.forEach(s => { _sheetIds[s.properties.title] = s.properties.sheetId; });
  }
  if (_sheetIds[name] === undefined) throw E('ไม่พบชีต ' + name);
  return _sheetIds[name];
}
async function updateRange(name, a1, values) {
  await api().spreadsheets.values.update({ spreadsheetId: SID(), range: `'${name}'!${a1}`, valueInputOption: 'RAW', requestBody: { values } });
}
async function appendRow(name, row) {
  await api().spreadsheets.values.append({ spreadsheetId: SID(), range: `'${name}'!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [row] } });
}
async function deleteRow(name, row) {
  await api().spreadsheets.batchUpdate({ spreadsheetId: SID(), requestBody: { requests: [{ deleteDimension: { range: { sheetId: await sheetId(name), dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }] } });
}
// หาคอลัมน์จากหัวตาราง ถ้าขาดจะสร้างต่อท้าย
async function headCols(name, need) {
  const vals = await readSheet(name);
  const head = (vals[0] || []).map(String);
  let changed = false;
  need.forEach(n => { if (head.indexOf(n) < 0) { head.push(n); changed = true; } });
  if (changed) await updateRange(name, 'A1:' + colLetter(head.length) + '1', [head]);
  const col = {}; head.forEach((h, i) => { if (h && col[h] === undefined) col[h] = i + 1; });
  return { col, lastCol: head.length, vals };
}
async function listSave(name, head, items) { // เขียนตารางใหม่ทั้งชุด (แทนที่ข้อมูลเดิมตั้งแต่แถว 2)
  await api().spreadsheets.values.clear({ spreadsheetId: SID(), range: `'${name}'!A2:ZZ` });
  if (items.length) await updateRange(name, 'A2:' + colLetter(head.length) + (items.length + 1), items);
}

// ---------- Auth (รหัสผ่านเดิมใช้ได้ต่อ: SHA-256 วนซ้ำ 20000 รอบ แบบเดียวกับ Apps Script) ----------
const b64web = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
function hashPassword(password, salt) {
  let v = b64web(crypto.createHash('sha256').update(salt + ':' + password, 'utf8').digest());
  for (let i = 1; i < AUTH.iterations; i++) v = b64web(crypto.createHash('sha256').update(v, 'ascii').digest());
  return v;
}
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function secret() { const s = process.env.SESSION_SECRET; if (!s || s.length < 32) throw new Error('ตั้งค่า SESSION_SECRET อย่างน้อย 32 ตัวอักษร'); return s; }
function signToken(p) { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', secret()).update(b).digest('base64url'); }
function verifyToken(t) {
  const [b, s] = String(t || '').split('.');
  if (!b || !s) return null;
  if (!safeEq(s, crypto.createHmac('sha256', secret()).update(b).digest('base64url'))) return null;
  try { return JSON.parse(Buffer.from(b, 'base64url').toString()); } catch (e) { return null; }
}
async function findUser(email) {
  const t = await table(APP.sheets.users), em = authEmail_(email);
  for (const x of t.rows) if (authEmail_(x.v[0]) === em) return { row: x.r, values: x.v.slice(0, 5), head: t.head };
  return null;
}
const failMap = new Map(); // จำกัดการเดารหัส (ต่อ instance ของ serverless — ช่วยได้บางส่วน)
const okCache = new Map(); // cache การตรวจสิทธิ์ผู้ใช้ 60 วินาที
async function login(email, password) {
  const em = authEmail_(email); password = String(password || '');
  if (!em || !password || password.length > 200) throw E('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  const f = failMap.get(em);
  if (f && f.n >= AUTH.maxFailures && f.until > Date.now()) throw E('เข้าสู่ระบบไม่สำเร็จหลายครั้ง กรุณารอ 15 นาที');
  const found = await findUser(em), r = found && found.values;
  const user = r ? { email: em, role: String(r[1] || '').trim().toLowerCase(), active: bool_(r[2]), salt: String(r[3] || ''), hash: String(r[4] || '') } : null;
  const valid = user && user.active && user.salt && user.hash && ['admin', 'staff', 'viewer'].includes(user.role);
  const submitted = valid ? hashPassword(password, user.salt) : '';
  if (!valid || !safeEq(submitted, user.hash)) {
    const n = (f && f.until > Date.now() ? f.n : 0) + 1;
    failMap.set(em, { n, until: Date.now() + AUTH.lockMs });
    throw E('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  }
  failMap.delete(em);
  const token = signToken({ email: user.email, role: user.role, exp: Date.now() + AUTH.ttl * 1000 });
  return { token, email: user.email, role: user.role, expiresIn: AUTH.ttl, data: await dataFresh() };
}
async function requireUser(token) {
  if (!token || String(token).length < 30) throw E('กรุณาเข้าสู่ระบบใหม่');
  const s = verifyToken(token);
  if (!s || !(s.exp > Date.now())) throw E('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const ck = s.email + '|' + s.role, hit = okCache.get(ck);
  if (hit && hit > Date.now()) return { email: s.email, role: s.role };
  const found = await findUser(s.email), r = found && found.values;
  if (!r || !bool_(r[2]) || String(r[1]).trim().toLowerCase() !== s.role) throw E('บัญชีถูกปิดหรือสิทธิ์เปลี่ยน กรุณาเข้าสู่ระบบใหม่');
  okCache.set(ck, Date.now() + 60000);
  return { email: s.email, role: s.role };
}
async function needRole(token, roles) { const u = await requireUser(token); if (roles.indexOf(u.role) < 0) throw E('บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้'); return u; }
async function logout() { return { ok: true }; } // token แบบ stateless: ฝั่งเว็บลบ token ทิ้ง (หมดอายุเองใน 6 ชม.)

// ---------- ข้อมูล ----------
function clientOut(o) {
  return { id: String(o.ClientID), year: Number(o.Year) || 0, seq: o.Seq === '' ? '' : Number(o.Seq), name: String(o.Name || ''), taxId: String(o.TaxID || ''), type: String(o.Type || ''), business: String(o.Business || ''),
    vat: bool_(o.VAT), ss: bool_(o.SS), stock: bool_(o.Stock), consult: bool_(o.Consult), doc: bool_(o.DocVolume), diff: bool_(o.Difficulty), months: o.Months === '' ? '' : Number(o.Months), revenue: numOrText_(o.Revenue),
    accountant: String(o.Accountant || ''), adjAcct: Number(o.AdjAccounting) || 0, auditor: String(o.Auditor || ''), adjAudit: Number(o.AdjAudit) || 0, quoted: bool_(o.Quoted), paid: bool_(o.Paid), auditorPaid: bool_(o.AuditorPaid), note: String(o.Note || ''),
    capital: o.Capital === '' || o.Capital == null ? '' : Number(o.Capital), assets: o.TotalAssets === '' || o.TotalAssets == null ? '' : Number(o.TotalAssets) };
}
async function dataFresh() {
  const [cl, ac, ra, ru, au] = await Promise.all([table(APP.sheets.clients), table(APP.sheets.accountants), table(APP.sheets.rateAcct), table(APP.sheets.rateAudit), table(APP.sheets.auditors)]);
  const A = objs(ra).map(o => ({ to: o.To, std: Number(o.Standard) || 0, vat: Number(o.VAT) || 0, ss: Number(o.SS) || 0, stock: Number(o.Stock) || 0, consult: Number(o.Consult) || 0, doc: Number(o.DocVolume) || 0, diff: Number(o.Difficulty) || 0 }));
  const U = objs(ru).map(o => ({ to: o.To, hjkPay: Number(o.HJK_Pay) || 0, hjkCharge: Number(o.HJK_Charge) || 0, bjkPay: Number(o.BJK_Pay) || 0, bjkCharge: Number(o.BJK_Charge) || 0 }));
  const AU = objs(au).filter(o => String(o.Name || '').trim()).map(o => ({ name: String(o.Name).trim(), hjkPay: Number(o.HJK_ExtraPay) || 0, hjkCharge: Number(o.HJK_ExtraCharge) || 0, bjkPay: Number(o.BJK_ExtraPay) || 0, bjkCharge: Number(o.BJK_ExtraCharge) || 0 }));
  return { clients: objs(cl).map(clientOut), accountants: objs(ac).map(o => String(o.Name || '').trim()).filter(Boolean), rates: { acct: A, audit: U, auditors: AU } };
}
async function getData(token) { const u = await requireUser(token), d = await dataFresh(); d.user = { email: u.email, role: u.role }; return d; }

async function saveClient(c, token) {
  await needRole(token, ['admin', 'staff']);
  const name = String(c && c.name || '').trim().replace(/\s+/g, ' ');
  if (!name) throw E('กรุณากรอกชื่อลูกค้า');
  if (name.length > 200 || /^[=+\-@]/.test(name)) throw E('ชื่อลูกค้าไม่ถูกต้อง (ต้องไม่ขึ้นต้นด้วย = + - @)');
  const type = String(c.type || '').trim(); if (['บจก.', 'หจก.'].indexOf(type) < 0) throw E('กรุณาเลือกประเภทนิติบุคคล');
  const year = Number(c.year); if (!(year >= 2500 && year <= 2700)) throw E('ปี พ.ศ. ไม่ถูกต้อง');
  if (/^TA[-\s]/i.test(String(c.auditor || '').trim()) && type === 'บจก.') throw E('ผู้สอบ TA ตรวจสอบได้เฉพาะ หจก. (บจก. ต้องใช้ผู้สอบ CPA)');
  const rev = numOrText_(c.revenue), months = c.months === '' || c.months == null ? '' : Number(c.months);
  if (months !== '' && !(months >= 1 && months <= 12)) throw E('จำนวนเดือนต้องอยู่ระหว่าง 1–12');
  if (typeof rev === 'number' && rev < 0) throw E('รายได้ต้องไม่ติดลบ');
  const txt = v => { const t = String(v == null ? '' : v).trim(); if (/^[=+\-@]/.test(t)) throw E('ข้อความต้องไม่ขึ้นต้นด้วย = + - @'); return t.slice(0, 300); };
  const cap = c.capital === '' || c.capital == null ? '' : Number(c.capital), ast = c.assets === '' || c.assets == null ? '' : Number(c.assets);
  if ((cap !== '' && !(cap >= 0)) || (ast !== '' && !(ast >= 0))) throw E('ทุนจดทะเบียนและสินทรัพย์รวมต้องเป็นตัวเลขไม่ติดลบ');
  const sn = APP.sheets.clients, { col, lastCol, vals } = await headCols(sn, CLIENT_HEAD);
  const data = vals.slice(1).map((v, i) => ({ r: i + 2, v: Array.from({ length: lastCol }, (_, k) => (v && v[k] !== undefined ? v[k] : '')) }));
  let id = String(c.id || '').trim(), found = null;
  if (id) { found = data.find(x => String(x.v[col.ClientID - 1]) === id); if (!found) throw E('ไม่พบลูกค้ารายนี้ (อาจถูกลบไปแล้ว)'); }
  else { let max = 0; data.forEach(x => { const m = /^CL(\d+)$/.exec(String(x.v[col.ClientID - 1])); if (m) max = Math.max(max, Number(m[1])); }); id = 'CL' + String(max + 1).padStart(4, '0'); }
  const row = found ? found.v.slice() : new Array(lastCol).fill('');
  const set = (k, v) => { row[col[k] - 1] = v; };
  set('ClientID', id); set('Year', year); set('Name', name); set('TaxID', txt(c.taxId)); set('Type', type); set('Business', txt(c.business));
  set('VAT', !!c.vat); set('SS', !!c.ss); set('Stock', !!c.stock); set('Consult', !!c.consult); set('DocVolume', !!c.doc); set('Difficulty', !!c.diff);
  set('Months', months); set('Revenue', rev); set('Accountant', txt(c.accountant)); set('AdjAccounting', Number(c.adjAcct) || 0);
  set('Capital', cap); set('TotalAssets', ast);
  set('Auditor', txt(c.auditor)); set('AdjAudit', Number(c.adjAudit) || 0); set('Note', txt(c.note));
  if (!found) {
    let mx = 0; data.forEach(x => { if (Number(x.v[col.Year - 1]) === year) mx = Math.max(mx, Number(x.v[col.Seq - 1]) || 0); });
    set('Seq', mx + 1); set('Quoted', false); set('Paid', false); set('AuditorPaid', false);
    await appendRow(sn, row);
  } else await updateRange(sn, 'A' + found.r + ':' + colLetter(lastCol) + found.r, [row]);
  return { ok: true, message: found ? 'แก้ไขข้อมูลลูกค้าแล้ว' : 'เพิ่มลูกค้าแล้ว', id, data: await dataFresh() };
}
async function deleteClient(id, token) {
  await needRole(token, ['admin']);
  id = String(id || '').trim(); if (!id) throw E('ไม่พบรหัสลูกค้า');
  const sn = APP.sheets.clients, { col, lastCol, vals } = await headCols(sn, CLIENT_HEAD);
  const idx = vals.findIndex((v, i) => i > 0 && String(v[col.ClientID - 1]) === id);
  if (idx < 0) throw E('ไม่พบลูกค้ารายนี้ (อาจถูกลบไปแล้ว)');
  const yr = Number(vals[idx][col.Year - 1]);
  await deleteRow(sn, idx + 1);
  // เรียงลำดับ Seq ของปีนั้นใหม่
  const t = await readSheet(sn), list = [];
  for (let i = 1; i < t.length; i++) if (Number((t[i] || [])[col.Year - 1]) === yr) list.push({ i, s: Number((t[i] || [])[col.Seq - 1]) || 0 });
  list.sort((a, b) => a.s - b.s || a.i - b.i);
  const sq = []; for (let i = 1; i < t.length; i++) sq.push([(t[i] || [])[col.Seq - 1] === undefined ? '' : t[i][col.Seq - 1]]);
  list.forEach((o, k) => { sq[o.i - 1][0] = k + 1; });
  if (sq.length) await updateRange(sn, colLetter(col.Seq) + '2:' + colLetter(col.Seq) + (sq.length + 1), sq);
  return { ok: true, message: 'ลบลูกค้าแล้ว', data: await dataFresh() };
}
async function setClientStatus(id, field, value, token) {
  await needRole(token, ['admin', 'staff']);
  const map = { quoted: 'Quoted', paid: 'Paid', auditorPaid: 'AuditorPaid' }, cn = map[field]; if (!cn) throw E('ฟิลด์สถานะไม่ถูกต้อง');
  const sn = APP.sheets.clients, { col, vals } = await headCols(sn, CLIENT_HEAD);
  const idx = vals.findIndex((v, i) => i > 0 && String(v[col.ClientID - 1]) === String(id));
  if (idx < 0) throw E('ไม่พบลูกค้ารายนี้');
  await updateRange(sn, colLetter(col[cn]) + (idx + 1), [[!!value]]);
  return { ok: true };
}
async function copyYear(fromYear, toYear, token) {
  await needRole(token, ['admin']);
  fromYear = Number(fromYear); toYear = Number(toYear);
  if (!(toYear >= 2500 && toYear <= 2700) || fromYear === toYear) throw E('ปีไม่ถูกต้อง');
  const sn = APP.sheets.clients, { col, lastCol, vals } = await headCols(sn, CLIENT_HEAD);
  const data = vals.slice(1).map(v => Array.from({ length: lastCol }, (_, k) => (v && v[k] !== undefined ? v[k] : ''))).filter(v => v.some(x => x !== ''));
  if (data.some(v => Number(v[col.Year - 1]) === toYear)) throw E('ปี ' + toYear + ' มีข้อมูลอยู่แล้ว ไม่สามารถคัดลอกทับได้');
  let max = 0; data.forEach(v => { const m = /^CL(\d+)$/.exec(String(v[col.ClientID - 1])); if (m) max = Math.max(max, Number(m[1])); });
  const src = data.filter(v => Number(v[col.Year - 1]) === fromYear); if (!src.length) throw E('ไม่พบข้อมูลปี ' + fromYear);
  const out = src.map((v, i) => { const r = v.slice(); r[col.ClientID - 1] = 'CL' + String(max + i + 1).padStart(4, '0'); r[col.Year - 1] = toYear; r[col.Seq - 1] = i + 1; r[col.AdjAccounting - 1] = 0; r[col.AdjAudit - 1] = 0; r[col.Quoted - 1] = false; r[col.Paid - 1] = false; r[col.AuditorPaid - 1] = false; return r; });
  const start = vals.length + 1;
  await updateRange(sn, 'A' + start + ':' + colLetter(lastCol) + (start + out.length - 1), out);
  return { ok: true, message: 'คัดลอก ' + out.length + ' ราย จากปี ' + fromYear + ' ไปปี ' + toYear + ' แล้ว (ล้างสถานะและค่าปรับแล้ว)', data: await dataFresh() };
}

// ---------- ตั้งค่า (admin) ----------
function cleanTo(v, first) { const t = String(v == null ? '' : v).trim(); if (first && t === 'งบเปล่า') return t; const n = Number(t.replace(/,/g, '')); if (!isFinite(n) || n < 0) throw E('ช่วงรายได้ "ถึง" ต้องเป็นตัวเลขไม่ติดลบ'); return n; }
function n_(v) { const n = Number(String(v == null ? '' : v).replace(/,/g, '')); if (!isFinite(n) || n < 0) throw E('จำนวนเงินต้องเป็นตัวเลขไม่ติดลบ'); return n; }
async function adminSaveRates(kind, rows, token) {
  await needRole(token, ['admin']);
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 60) throw E('จำนวนแถวไม่ถูกต้อง');
  if (kind === 'acct') await listSave(APP.sheets.rateAcct, ['To', 'Standard', 'VAT', 'SS', 'Stock', 'Consult', 'DocVolume', 'Difficulty'], rows.map((r, i) => [cleanTo(r.to, i === 0), n_(r.std), n_(r.vat), n_(r.ss), n_(r.stock), n_(r.consult), n_(r.doc), n_(r.diff)]));
  else if (kind === 'audit') await listSave(APP.sheets.rateAudit, ['To', 'HJK_Pay', 'HJK_Charge', 'BJK_Pay', 'BJK_Charge'], rows.map((r, i) => [cleanTo(r.to, i === 0), n_(r.hjkPay), n_(r.hjkCharge), n_(r.bjkPay), n_(r.bjkCharge)]));
  else throw E('ชนิดตารางไม่ถูกต้อง');
  return { ok: true, message: 'บันทึกตารางอัตราแล้ว', data: await dataFresh() };
}
async function adminSaveAccountants(names, token) {
  await needRole(token, ['admin']);
  const list = []; (names || []).forEach(n => { const t = String(n || '').trim(); if (t) { if (/^[=+\-@]/.test(t)) throw E('ชื่อต้องไม่ขึ้นต้นด้วย = + - @'); if (list.indexOf(t) < 0) list.push(t); } });
  await listSave(APP.sheets.accountants, ['Name'], list.map(n => [n]));
  return { ok: true, message: 'บันทึกรายชื่อผู้ทำบัญชีแล้ว', data: await dataFresh() };
}
async function adminSaveAuditors(items, token) {
  await needRole(token, ['admin']);
  const seen = {}, rows = [], opt = v => (v === '' || v == null ? '' : n_(v));
  (items || []).forEach(a => { const t = String(a && a.name || '').trim(); if (!t) return; if (/^[=+\-@]/.test(t)) throw E('ชื่อต้องไม่ขึ้นต้นด้วย = + - @'); if (seen[t]) return; seen[t] = 1; rows.push([t, opt(a.hjkPay), opt(a.hjkCharge), opt(a.bjkPay), opt(a.bjkCharge)]); });
  await listSave(APP.sheets.auditors, ['Name', 'HJK_ExtraPay', 'HJK_ExtraCharge', 'BJK_ExtraPay', 'BJK_ExtraCharge'], rows);
  return { ok: true, message: 'บันทึกรายชื่อผู้สอบแล้ว', data: await dataFresh() };
}

// ---------- บัญชีผู้ใช้ (admin) ----------
async function usersOut() { return objs(await table(APP.sheets.users)).map(x => ({ email: authEmail_(x.Email), name: String(x.FullName || ''), role: String(x.Role || ''), active: bool_(x.Active) })); }
async function adminListUsers(token) { await needRole(token, ['admin']); return { users: await usersOut() }; }
async function adminSaveUser(data, token) {
  const u = await needRole(token, ['admin']);
  const email = authEmail_(data && data.email), role = String(data && data.role || '').toLowerCase(), active = !(data && data.active === false), name = String(data && data.name || '').trim().replace(/\s+/g, ' ');
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email) || ['admin', 'staff', 'viewer'].indexOf(role) < 0) throw E('กรุณาตรวจสอบอีเมลและสิทธิ์');
  if (!name || name.length > 150 || /^[=+\-@]/.test(name)) throw E('กรุณากรอกชื่อให้ถูกต้อง');
  const pw = String(data && data.password || ''), orig = authEmail_(data && data.originalEmail);
  const { col, lastCol } = await headCols(APP.sheets.users, ['Email', 'Role', 'Active', 'PasswordSalt', 'PasswordHash', 'FullName']);
  const sn = APP.sheets.users, found = await findUser(orig || email);
  if (orig && !found) throw E('ไม่พบบัญชีเดิม (อาจถูกลบไปแล้ว)');
  if (orig && orig !== email && await findUser(email)) throw E('อีเมลนี้มีบัญชีอยู่แล้ว');
  if (!found && !pw) throw E('กรุณากรอกรหัสผ่านสำหรับบัญชีใหม่ (อย่างน้อย 12 ตัวอักษร)');
  if (pw && (pw.length < 12 || pw.length > 200)) throw E('รหัสผ่านต้องมีความยาว 12–200 ตัวอักษร');
  if (found && (orig || email) === u.email && (role !== 'admin' || !active)) throw E('ไม่สามารถลดสิทธิ์หรือปิดบัญชีที่คุณกำลังใช้งานอยู่ได้');
  const salt = pw ? crypto.randomUUID() + crypto.randomUUID() : '', hash = pw ? hashPassword(pw, salt) : '';
  if (found) {
    const cur = (await readSheet(sn))[found.row - 1] || [];
    const row = Array.from({ length: lastCol }, (_, k) => (cur[k] === undefined ? '' : cur[k]));
    row[0] = email; row[1] = role; row[2] = active; row[col.FullName - 1] = name;
    if (pw) { row[3] = salt; row[4] = hash; }
    await updateRange(sn, 'A' + found.row + ':' + colLetter(lastCol) + found.row, [row]);
  } else {
    const row = new Array(lastCol).fill(''); row[0] = email; row[1] = role; row[2] = active; row[3] = salt; row[4] = hash; row[col.FullName - 1] = name;
    await appendRow(sn, row);
  }
  okCache.clear();
  return { ok: true, message: found ? 'แก้ไขบัญชีแล้ว' : 'เพิ่มบัญชีแล้ว', users: await usersOut() };
}
async function adminDeleteUser(email, token) {
  const u = await needRole(token, ['admin']);
  email = authEmail_(email); if (!email) throw E('ไม่พบอีเมลบัญชี');
  if (email === u.email) throw E('ไม่สามารถลบบัญชีที่คุณกำลังใช้งานอยู่ได้');
  const found = await findUser(email); if (!found) throw E('ไม่พบบัญชีนี้ (อาจถูกลบไปแล้ว)');
  if (String(found.values[1]).trim().toLowerCase() === 'admin' && bool_(found.values[2])) {
    const others = objs(await table(APP.sheets.users)).filter(x => authEmail_(x.Email) !== email && String(x.Role).trim().toLowerCase() === 'admin' && bool_(x.Active));
    if (!others.length) throw E('ไม่สามารถลบ Admin คนสุดท้ายได้');
  }
  await deleteRow(APP.sheets.users, found.row);
  okCache.clear();
  return { ok: true, message: 'ลบบัญชี ' + email + ' แล้ว', users: await usersOut() };
}

const handlers = { login, logout, getData, saveClient, deleteClient, setClientStatus, copyYear, adminSaveRates, adminSaveAccountants, adminSaveAuditors, adminListUsers, adminSaveUser, adminDeleteUser };
module.exports = { handlers, hashPassword };
