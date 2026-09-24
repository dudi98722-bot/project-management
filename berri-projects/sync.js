/* =====================================================================
   BERRI — שמירה ברקע.
   השינוי מופיע במסך מיד, ונשלח לשרת בתור אחד לפי הסדר.

   למה זה בטוח:
   - לכל שורה יש מזהה קבוע שנוצר בדפדפן. אם התשובה מהשרת לא מגיעה
     (נפל חיבור, סינון, איטיות) — שולחים שוב את אותה בקשה. השרת מזהה את
     המזהה ומעדכן את אותה שורה, כך שאין כפילויות. זה גם מה שמונע את
     ההודעה המטעה "אין תקשורת" אחרי שהשורה בעצם כבר נשמרה.
   - התור נשמר בדפדפן: סגירת הדף או ניתוק לא מאבדים שינוי שעוד לא נשלח.
   - אם השרת דוחה שינוי (למשל שם קופה שכבר קיים) — המסך חוזר למצב
     הקודם, ומופיעה הודעה עם כפתור לפתוח ולתקן.
   ===================================================================== */
'use strict';

var Q = { items: [], busy: false, tries: 0, timer: null, done: {} };
var LS_Q = 'berri_queue';

function qStored() { try { return JSON.parse(lsGet(LS_Q) || '[]') || []; } catch (e) { return []; } }
function qRead() { Q.items = qStored(); }
/* כמה לשוניות פתוחות חולקות את אותו תור שמור. כל לשונית כותבת את שלה
   וגם שומרת את מה שלשונית אחרת הוסיפה — אחרת לשונית אחת הייתה מוחקת
   מהשמירה שינוי של השנייה שעוד לא נשלח. שליחה כפולה בטוחה: אותו מזהה. */
function qWrite() {
  var mine = {};
  Q.items.forEach(function (j) { mine[j.qid] = 1; });
  qStored().forEach(function (j) { if (!mine[j.qid] && !Q.done[j.qid]) Q.items.push(j); });
  lsSet(LS_Q, JSON.stringify(Q.items));
  qBadge();
}
function qCopy(o) { return o ? JSON.parse(JSON.stringify(o)) : null; }
/* שינוי שייך למי שעשה אותו: אם מישהו אחר נכנס באותו מחשב, השינויים
   של הקודם מחכים לו ולא נשלחים בשם הנוכחי */
function qMine(j) { return !j.uid || (S.user && j.uid === S.user.id); }

/* job: { kind: save|remove|restore|bulk, table, row, prev, prevs, fresh, catKnown, ids, op, patch, redo } */
function enqueue(job) {
  job.qid = newId('q');
  job.uid = S.user ? S.user.id : '';
  Q.items.push(job);
  qWrite();
  qPump();
}

/* השינויים שעוד בתור מוחלים מחדש על כל נתונים שנטענו מהשרת או מהמטמון —
   אחרת רענון באמצע היה מעלים שורה שהמשתמש כבר ראה נשמרת */
function qOverlay() {
  Q.items.forEach(function (j) {
    var list = S.d[j.table]; if (!list || !qMine(j)) return;
    var put = function (row) {
      var i = list.map(function (x) { return x.id; }).indexOf(row.id);
      if (i >= 0) list[i] = Object.assign({}, list[i], row); else list.push(row);
    };
    var drop = function (id) { S.d[j.table] = list = list.filter(function (x) { return x.id !== id; }); };
    if (j.kind === 'save') put(j.local || j.row);
    else if (j.kind === 'remove') drop(j.id);
    else if (j.kind === 'restore' && j.prev) put(j.prev);
    else if (j.kind === 'bulk') (j.locals || []).forEach(function (r) { if (j.op === 'delete') drop(r.id); else put(r); });
  });
}

function qPump() {
  if (Q.busy || !S.token || !S.url || !S.user) return;
  var j = Q.items.filter(qMine)[0], action, params;
  if (!j) return;
  clearTimeout(Q.timer);
  if (j.kind === 'save') { action = 'save'; params = { table: j.table, row: j.row, fresh: j.fresh ? '1' : '', catKnown: j.catKnown ? '1' : '' }; }
  else if (j.kind === 'bulk') { action = 'bulk'; params = { table: j.table, op: j.op, ids: j.ids, patch: j.patch }; }
  else { action = j.kind; params = { table: j.table, id: j.id }; }
  Q.busy = true; setSync(true);
  api(action, params, 30000).then(function (r) {
    Q.busy = false; setSync(false);
    if (r.net) {                                        // לא הגיעה תשובה — שולחים שוב, בהמתנה הולכת וגדלה
      Q.tries++;
      Q.timer = setTimeout(qPump, Math.min(30000, 1500 * Math.pow(2, Q.tries - 1)));
      qBadge();
      return;
    }
    Q.tries = 0;
    if (r.expired) { handleExpired(r); return; }         // נשאר בתור — ימשיך אחרי כניסה מחדש
    Q.done[j.qid] = 1;
    Q.items = Q.items.filter(function (x) { return x.qid !== j.qid; });
    qWrite();
    if (r.ok) qDone(j, r); else qUndo(j, r.error);
    qPump();
  });
}

function qDone(j, r) {
  /* אם אותה שורה נערכה שוב ועוד בתור — לא מחזירים אותה לגרסה הקודמת */
  var later = Q.items.some(function (x) { return x.table === j.table && (x.id === (r.row && r.row.id) || (x.row && r.row && x.row.id === r.row.id)); });
  if ((j.kind === 'save' || j.kind === 'restore') && r.row && !later) upsertLocal(j.table, r.row);
  if (j.kind === 'bulk') {
    (r.rows || []).forEach(function (row) { if (j.op !== 'delete') upsertLocal(j.table, row); });
    if (r.failed && r.failed.length) {
      if (j.op === 'restore') { r.failed.forEach(function (f) { removeLocal(j.table, f.id); }); rerender(); }
      else {
        var back = [];
        r.failed.forEach(function (f) { var p = (j.prevs || {})[f.id]; if (p) back.push(p); });
        qRollback(j, back);
      }
      toast('⚠ ' + r.failed.length + ' שורות לא עודכנו: ' + r.failed[0].error, 'err');
    }
  }
  (r.categories || (r.category ? [r.category] : [])).forEach(function (c) {
    if (!S.d.categories.some(function (x) { return x.id === c.id; })) S.d.categories.push(c);
  });
  S.ver++; cacheState();
}

/* השרת דחה — מחזירים את המסך למה שהיה לפני */
function qUndo(j, error) {
  if (j.kind === 'save') { if (j.prev) upsertLocal(j.table, j.prev); else removeLocal(j.table, j.row.id); }
  else if (j.kind === 'remove') { if (j.prev) upsertLocal(j.table, j.prev); }
  else if (j.kind === 'restore') removeLocal(j.table, j.id);
  else if (j.kind === 'bulk' && j.op === 'restore') (j.ids || []).forEach(function (id) { removeLocal(j.table, id); });
  else if (j.kind === 'bulk') qRollback(j, Object.keys(j.prevs || {}).map(function (k) { return j.prevs[k]; }));
  rerender();
  var fix = j.redo ? { label: 'פתיחה לתיקון', fn: function () { runRedo(j.redo); } } : null;
  /* "פעולה לא מוכרת" = הסקריפט בגוגל ישן מהדף. אומרים מה לעשות, לא רק שנכשל */
  if (error === 'פעולה לא מוכרת') error = 'הסקריפט בגוגל עוד לא עודכן לגרסה החדשה — צריך להדביק אותו מחדש ב-Apps Script';
  toast('⚠ לא נשמר: ' + (error || 'השרת דחה את השינוי'), 'err', fix);
}
function qRollback(j, rows) {
  rows.forEach(function (p) { upsertLocal(j.table, p); });
  if (rows.length) rerender();
}
function runRedo(r) { if (typeof window[r.fn] === 'function') window[r.fn].apply(null, r.args || []); }

/* חיווי בסרגל העליון: כמה שינויים עוד בדרך */
function qBadge() {
  var el = byId('qbadge'); if (!el) return;
  var n = Q.items.filter(qMine).length;
  el.classList.toggle('hide', !n);
  el.textContent = n ? (Q.tries ? '⏳ ממתין לחיבור · ' + n : '⏳ שומר · ' + n) : '';
  el.title = n ? 'השינויים כבר מוצגים, והם נשלחים לגיליון ברקע' : '';
}
window.addEventListener('beforeunload', function (ev) {
  if (Q.items.length) { ev.preventDefault(); ev.returnValue = ''; }
});
window.addEventListener('online', function () { Q.tries = 0; qPump(); });
qRead();
