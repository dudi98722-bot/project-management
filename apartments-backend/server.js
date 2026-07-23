'use strict';
/* ============================================================
   מערכת ניהול דירות ושותפויות — Backend על שרת ה-VPS
   ------------------------------------------------------------
   Node טהור (בלי תלויות / בלי npm install).
   מאחסן את כל ה-DB כקובץ JSON יחיד על השרת, ומדבר בדיוק
   את אותו חוזה שהאפליקציה כבר מכירה:
     GET  /api?key=TOKEN&action=load  -> { ok:true, data:<DB|null> }
     POST /api?key=TOKEN  body {action:"save", data:<DB>} -> { ok:true, savedAt }
   ------------------------------------------------------------ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3610;
const HOST = '127.0.0.1';                                   // מאזין רק מקומית; nginx חושף החוצה
const TOKEN = 'f11fad687d3005d8a75809c0dcf84fc782568f34';   // חייב להיות זהה למה שמוטמע ב-HTML
const DATA_DIR = '/var/lib/alexander-dirot';
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const MAX_BODY = 60 * 1024 * 1024;                          // 60MB תקרה

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

function readRaw() {
  try { return fs.readFileSync(DATA_FILE, 'utf8'); } catch (e) { return null; }
}
function writeAtomic(str) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, str);
  try { if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, DATA_FILE + '.bak'); } catch (e) {}
  fs.renameSync(tmp, DATA_FILE);                            // rename אטומי — לא משאיר קובץ חצי-כתוב
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, { ok: false, error: 'bad url' }); }

  // ---- בדיקת טוקן ----
  if (u.searchParams.get('key') !== TOKEN) {
    return send(res, 403, { ok: false, error: 'forbidden' });
  }

  // ---- טעינה ----
  if (req.method === 'GET') {
    if (u.searchParams.get('action') === 'load') {
      const raw = readRaw();
      let data = null;
      if (raw) { try { data = JSON.parse(raw); } catch (e) { data = null; } }
      return send(res, 200, { ok: true, data });
    }
    return send(res, 200, { ok: true, status: 'alexander-dirot backend ready' });
  }

  // ---- שמירה ----
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > MAX_BODY) { send(res, 413, { ok: false, error: 'too large' }); req.destroy(); }
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      try {
        const parsed = JSON.parse(body);
        if (parsed && parsed.action === 'save') {
          writeAtomic(JSON.stringify(parsed.data));
          return send(res, 200, { ok: true, savedAt: new Date().toISOString() });
        }
        return send(res, 400, { ok: false, error: 'unknown action' });
      } catch (err) {
        return send(res, 400, { ok: false, error: String(err) });
      }
    });
    return;
  }

  send(res, 405, { ok: false, error: 'method not allowed' });
});

server.listen(PORT, HOST, () => {
  console.log('alexander-dirot backend listening on ' + HOST + ':' + PORT + '  data=' + DATA_FILE);
});
