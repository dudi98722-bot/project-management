/* קופה קטנה — service worker מינימלי.
   רשת קודם, ומטמון רק כגיבוי. כך עדכון קוד תמיד נתפס מיד,
   ואם אין רשת האפליקציה עדיין נפתחת עם מה שנשמר.
   הקריאות ל-Apps Script יושבות במקור אחר ולכן לא נוגעים בהן בכלל. */
var CACHE = 'kupa-shell-v1';

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;   // Apps Script — לא נוגעים

  e.respondWith(
    fetch(req)
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./');
        });
      })
  );
});
