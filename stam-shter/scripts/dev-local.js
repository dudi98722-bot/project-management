// הרצה מקומית מלאה בלי להתקין Postgres:
// מקים Postgres נייד (embedded) -> מאתחל סכימה + אדמין -> מריץ שרת.
// שימוש:  npm run dev-local     (המסד נשמר בתיקייה .pgdata)
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const EmbeddedPostgres = require('embedded-postgres').default;

const DATA = path.join(__dirname, '..', '.pgdata');
const PORT_DB = 5434;
const DB_URL = `postgres://postgres:postgres@127.0.0.1:${PORT_DB}/stam_shter`;
const SERVER_PORT = process.env.PORT || '3620';

(async () => {
  const fresh = !fs.existsSync(DATA);
  const pg = new EmbeddedPostgres({
    databaseDir: DATA, user: 'postgres', password: 'postgres', port: PORT_DB, persistent: true
  });
  if (fresh) { console.log('▶ מאתחל Postgres נייד (פעם ראשונה)...'); await pg.initialise(); }
  console.log('▶ מפעיל Postgres...');
  await pg.start();
  try { await pg.createDatabase('stam_shter'); console.log('✔ מסד stam_shter נוצר'); }
  catch (e) { console.log('• המסד כבר קיים'); }

  const childEnv = {
    ...process.env, DATABASE_URL: DB_URL, NODE_ENV: 'development',
    ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin1234'
  };

  console.log('▶ מאתחל סכימה + אדמין...');
  execFileSync(process.execPath, [path.join(__dirname, 'init_db.js')], { stdio: 'inherit', env: childEnv });

  process.env.DATABASE_URL = DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'local-dev-secret-not-for-prod';
  process.env.PORT = SERVER_PORT;
  process.env.NODE_ENV = 'development';
  console.log(`▶ מריץ שרת על http://localhost:${SERVER_PORT}`);
  require('../server.js');

  const stop = async () => { try { await pg.stop(); } catch (e) {} process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
})().catch(e => { console.error('❌ שגיאה בהרצה מקומית:', e); process.exit(1); });
