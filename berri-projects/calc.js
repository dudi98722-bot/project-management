/* =====================================================================
   BERRI — חישובים: תנועות כסף, יתרות קופות, ומצב כל פרוייקט
   ===================================================================== */
'use strict';

function sumOf(list, f) { return list.reduce(function (s, x) { return s + (Number(f ? f(x) : x.amount) || 0); }, 0); }
function regName(id) { var r = findRow('registers', id); return r ? r.name : '—'; }
function projName(id) { var p = findRow('projects', id); return p ? p.name : '—'; }

/* סוגי התנועות — אחידים בכל הדוחות */
var MV = {
  cp:  { t: 'תשלום מלקוח',        i: '📥', table: 'clientPayments' },
  sp:  { t: 'תשלום לקבלן משנה',   i: '👷', table: 'subPayments' },
  pe:  { t: 'הוצאה לפרוייקט',      i: '🧱', table: 'projectExpenses' },
  be:  { t: 'הוצאת עסק',           i: '🧾', table: 'businessExpenses' },
  he:  { t: 'הוצאת בית',           i: '🏠', table: 'homeExpenses' },
  in:  { t: 'כסף נכנס לקופה',      i: '⬇️', table: 'cashMoves' },
  out: { t: 'כסף יצא מקופה',       i: '⬆️', table: 'cashMoves' },
  tr:  { t: 'העברה בין קופות',     i: '⇄',  table: 'cashMoves' }
};

/* כל תנועות הכסף במבנה אחד: קופה, כיוון (+ נכנס / − יוצא), סכום ותיאור.
   העברה בין קופות נרשמת פעמיים — יציאה מקופה אחת וכניסה לשנייה. */
function buildMoves() {
  var out = [];
  function add(k, x, reg, dir, desc, extra) {
    /* שורה מוסתרת (אין הרשאת צפייה באזור שלה) — מופיעה ביתרות, בלי פרטים */
    var m = { k: k, id: x.id, date: x.date, amount: Number(x.amount) || 0, reg: reg, dir: dir,
              desc: x.masked ? 'פרטים מוסתרים' : desc, pid: x.projectId || '', ts: x.createdAt || '', src: x };
    if (extra) for (var e in extra) m[e] = extra[e];
    out.push(m);
  }
  function pdesc(x, more) { return [projName(x.projectId)].concat(more.filter(Boolean)).join(' · '); }
  S.d.clientPayments.forEach(function (x) { add('cp', x, x.registerId, 1, pdesc(x, [x.method, x.reference, x.note])); });
  S.d.subPayments.forEach(function (x) {
    var p = findRow('projects', x.projectId);
    add('sp', x, x.registerId, -1, pdesc(x, [p && p.subName, x.method, x.reference, x.note]));
  });
  S.d.projectExpenses.forEach(function (x) {
    add('pe', x, x.registerId, -1, pdesc(x, [x.category, x.supplier, x.deductSub ? 'מקוזז מהקבלן' : '', x.note]));
  });
  S.d.businessExpenses.forEach(function (x) { add('be', x, x.registerId, -1, [x.category, x.supplier, x.note].filter(Boolean).join(' · ')); });
  S.d.homeExpenses.forEach(function (x) {
    add('he', x, x.registerId, -1, x.masked ? 'הוצאות בית' : [x.category, x.supplier, x.note].filter(Boolean).join(' · '));
  });
  S.d.cashMoves.forEach(function (x) {
    if (x.type === 'transfer') {
      add('tr', x, x.registerId, -1, 'אל ' + regName(x.toRegisterId) + (x.note ? ' · ' + x.note : ''), { half: 'from' });
      add('tr', x, x.toRegisterId, 1, 'מ' + regName(x.registerId) + (x.note ? ' · ' + x.note : ''), { half: 'to' });
    } else {
      add(x.type === 'in' ? 'in' : 'out', x, x.registerId, x.type === 'in' ? 1 : -1, [x.category, x.note].filter(Boolean).join(' · '));
    }
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0); });
  return out;
}

/* יתרת קופה בסוף יום נתון. יתרת הפתיחה נכונה לתאריך שלה, ולכן תנועות
   שלפניו כבר כלולות בה ולא נספרות שוב. */
function regBalance(r, upTo, moves) {
  var b = Number(r.opening) || 0;
  (moves || calc().moves).forEach(function (m) {
    if (m.reg !== r.id || m.date > upTo) return;
    if (r.openingDate && m.date < r.openingDate) return;
    b += m.dir * m.amount;
  });
  return round2(b);
}

/* משך בחודשים בין שני תאריכים (כולל שני הימים) */
function monthsBetween(a, b) {
  var da = parseISO(a), db = parseISO(b);
  if (!da || !db || db < da) return 0;
  /* ספירת ימים לפי UTC: בשעון מקומי מעבר לשעון קיץ מוסיף/מוריד שעה,
     והרווח לחודש יצא עקום בכמה שקלים */
  var days = Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) -
                         Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
  return (days + 1) / 30.4375;
}

/* מצב פרוייקט. הרווח הצפוי: מחיר ללקוח (או מה ששולם בפועל, אם יותר), פחות
   המחיר לקבלן (או מה שכבר יצא אליו, אם יותר), פחות ההוצאות — בפרוייקט פעיל
   הגבוה מבין הצפי לבפועל, ובפרוייקט שהסתיים — מה שהוצא בפועל. */
function projectStats(p, today) {
  var id = p.id;
  var cps = S.d.clientPayments.filter(function (x) { return x.projectId === id; });
  var sps = S.d.subPayments.filter(function (x) { return x.projectId === id; });
  var pes = S.d.projectExpenses.filter(function (x) { return x.projectId === id; });
  var own = pes.filter(function (x) { return !x.deductSub; }), ded = pes.filter(function (x) { return x.deductSub; });
  var ads = S.d.additions.filter(function (x) { return x.projectId === id; });
  var s = {
    p: p, cps: cps, sps: sps, pes: pes, ads: ads,
    basePrice: Number(p.clientPrice) || 0, baseSubPrice: Number(p.subPrice) || 0, expected: Number(p.expected) || 0,
    addClient: round2(sumOf(ads, function (x) { return x.clientAmount; })),
    addSub: round2(sumOf(ads, function (x) { return x.subAmount; })),
    clientPaid: round2(sumOf(cps)), subPaid: round2(sumOf(sps)), ownExp: round2(sumOf(own)), dedExp: round2(sumOf(ded))
  };
  /* המחיר שעליו נסגר החשבון = מה שסוכם בהתחלה + כל התוספות שנרשמו */
  s.clientPrice = round2(s.basePrice + s.addClient);
  s.subPrice = round2(s.baseSubPrice + s.addSub);
  s.clientDue = round2(s.clientPrice - s.clientPaid);
  s.subCovered = round2(s.subPaid + s.dedExp);
  s.subDue = round2(s.subPrice - s.subCovered);
  s.expLeft = round2(s.expected - s.ownExp);
  s.planned = round2(s.clientPrice - s.subPrice - s.expected);
  var revenue = Math.max(s.clientPrice, s.clientPaid), subCost = Math.max(s.subPrice, s.subCovered);
  var expCost = p.active ? Math.max(s.expected, s.ownExp) : s.ownExp;
  s.profit = round2(revenue - subCost - expCost);
  s.margin = revenue > 0 ? s.profit / revenue * 100 : 0;
  s.cashNet = round2(s.clientPaid - s.subPaid - s.ownExp - s.dedExp);
  s.endEst = !p.endDate;
  var end = p.endDate || today;
  s.months = p.startDate ? monthsBetween(p.startDate, end) : 0;
  /* פרוייקט שרץ פחות מחודש: חלוקה בשבר קטן מנפחת את התוצאה פי עשרות
     (פרוייקט שהתחיל היום = חלוקה ב-0.03), ולכן אין מספר להציג. */
  s.monthly = s.months >= 1 ? round2(s.profit / s.months) : null;
  s.plannedMonthly = s.months >= 1 ? round2(s.planned / s.months) : null;
  s.lastDate = [].concat(cps, sps, pes).reduce(function (m, x) { return x.date > m ? x.date : m; }, '');
  s.warns = [];
  if (s.clientPaid > s.clientPrice && s.clientPrice > 0) s.warns.push('הלקוח שילם ' + money(s.clientPaid - s.clientPrice) + ' יותר מהמחיר — אם יש תוספות, עדכן את המחיר');
  if (s.subCovered > s.subPrice) s.warns.push('לקבלן המשנה יצא ' + money(s.subCovered - s.subPrice) + ' יותר מהמחיר שסוכם');
  if (s.ownExp > s.expected && s.expected > 0) s.warns.push('חריגה של ' + money(s.ownExp - s.expected) + ' מצפי ההוצאות');
  if (!p.startDate) s.warns.push('אין תאריך התחלה — אי אפשר לחשב רווח לחודש');
  return s;
}

/* כל החישובים, פעם אחת לכל גרסת נתונים */
var _calc = { ver: -1, v: null };
function calc() {
  if (_calc.ver === S.ver && _calc.v) return _calc.v;
  var today = todayISO(), moves = buildMoves();
  var v = { today: today, moves: moves, proj: {}, bal: {}, future: {} };
  S.d.projects.forEach(function (p) { v.proj[p.id] = projectStats(p, today); });
  var total = 0;
  S.d.registers.forEach(function (r) {
    v.bal[r.id] = regBalance(r, today, moves);
    v.future[r.id] = round2(regBalance(r, '9999-12-31', moves) - v.bal[r.id]);
    total += v.bal[r.id];
  });
  v.totalBalance = round2(total);
  var all = S.d.projects.map(function (p) { return v.proj[p.id]; });
  var act = all.filter(function (s) { return s.p.active; });
  v.clientDebt = round2(sumOf(all, function (s) { return Math.max(0, s.clientDue); }));
  v.subDebt = round2(sumOf(all, function (s) { return Math.max(0, s.subDue); }));
  v.expLeft = round2(sumOf(act, function (s) { return Math.max(0, s.expLeft); }));
  v.projected = round2(v.totalBalance + v.clientDebt - v.subDebt - v.expLeft);
  v.activeProfit = round2(sumOf(act, function (s) { return s.profit; }));
  v.runRate = round2(sumOf(act, function (s) { return s.monthly || 0; }));
  v.activeCount = act.length;
  _calc = { ver: S.ver, v: v };
  return v;
}
function sortedRegisters(includeInactive) {
  return S.d.registers.filter(function (r) { return includeInactive || r.active; })
    .slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name, 'he'); });
}
function sortedProjects() {
  return S.d.projects.slice().sort(function (a, b) {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (b.startDate || '').localeCompare(a.startDate || '') || a.name.localeCompare(b.name, 'he');
  });
}
function catsOf(group) {
  return S.d.categories.filter(function (c) { return c.group === group; })
    .sort(function (a, b) { return (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name, 'he'); });
}
function fmtMonths(n) { return n > 0 ? (Math.round(n * 10) / 10).toLocaleString('he-IL') : '—'; }
