const express = require('express');
const path    = require('path');
const { Pool } = require('pg');
const bcrypt  = require('bcryptjs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// ── DATABASE ────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY, name TEXT, age TEXT, gender TEXT, blood TEXT,
      contact TEXT, ward_id TEXT, admit_date TEXT, doctor TEXT,
      diagnosis TEXT, allergies TEXT, status TEXT DEFAULT 'admitted',
      discharge_date TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS vitals_log (
      id TEXT PRIMARY KEY, patient_id TEXT, time TEXT, bp TEXT,
      pulse TEXT, temp TEXT, spo2 TEXT, resp TEXT, glucose TEXT,
      pain TEXT, nurse TEXT, notes TEXT, saved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS wards (
      id TEXT PRIMARY KEY, name TEXT, beds INTEGER, type TEXT
    );
    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY, name TEXT, role TEXT, dept TEXT, qual TEXT, contact TEXT
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY, patient_name TEXT, mobile TEXT, age TEXT,
      gender TEXT, date TEXT, time TEXT, doctor TEXT, dept TEXT,
      reason TEXT, notes TEXT, status TEXT DEFAULT 'scheduled', created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, name TEXT, role TEXT, username TEXT UNIQUE,
      email TEXT, mobile TEXT, dept TEXT, qual TEXT, pw TEXT, created_at TEXT
    );
  `);
  const { rowCount } = await pool.query('SELECT 1 FROM wards LIMIT 1');
  if (rowCount === 0) {
    await pool.query(`INSERT INTO wards VALUES
      ('w1','General Ward A',12,'General'),
      ('w2','ICU',4,'ICU'),
      ('w3','Pediatric Ward',6,'Pediatric')
      ON CONFLICT DO NOTHING`);
  }
  // ── MIGRATIONS: add new columns if they don't exist yet ────────────
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS username TEXT`);
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS qual TEXT DEFAULT ''`);
  // Backfill username from email for existing rows (use part before @)
  await pool.query(`
    UPDATE accounts SET username = LOWER(SPLIT_PART(email, '@', 1))
    WHERE username IS NULL OR username = ''
  `);
  // Make username unique index (only if not already)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_idx ON accounts(username)`);
  console.log('Migrations applied');

  // Seed default admin if no accounts exist
  const { rowCount: adminCount } = await pool.query('SELECT 1 FROM accounts LIMIT 1');
  if (adminCount === 0) {
    const defaultPw = await bcrypt.hash('Admin@123', 10);
    await pool.query(
      `INSERT INTO accounts VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      ['admin-001','Administrator','admin','admin','admin@meditrack.local','','Administration','',defaultPw,new Date().toISOString()]
    );
    console.log('Default admin seeded — username: admin  password: Admin@123');
  } else {
    // Ensure existing admin has username set
    await pool.query(`UPDATE accounts SET username='admin' WHERE role='admin' AND (username IS NULL OR username='')`);
  }
  console.log('Database ready');
}

const ok  = (res, data) => res.json({ ok: true, data });
const err = (res, e)    => { console.error(e); res.status(500).json({ ok: false, error: e.message }); };

// PATIENTS
app.get('/api/patients', async (req, res) => {
  try { ok(res, (await pool.query('SELECT * FROM patients ORDER BY updated_at DESC NULLS LAST')).rows); } catch(e) { err(res,e); }
});
app.post('/api/patients', async (req, res) => {
  const d = req.body;
  try {
    await pool.query(`INSERT INTO patients VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(id) DO UPDATE SET name=$2,age=$3,gender=$4,blood=$5,contact=$6,ward_id=$7,
      admit_date=$8,doctor=$9,diagnosis=$10,allergies=$11,status=$12,discharge_date=$13,updated_at=$14`,
      [d.id,d.name,d.age,d.gender,d.blood,d.contact,d.wardId,d.admitDate,d.doctor,
       d.diagnosis,d.allergies,d.status||'admitted',d.dischargeDate||null,d.updatedAt||new Date().toISOString()]);
    ok(res, d);
  } catch(e) { err(res,e); }
});
app.delete('/api/patients/:id', async (req, res) => {
  try { await pool.query('DELETE FROM patients WHERE id=$1',[req.params.id]); ok(res,{}); } catch(e) { err(res,e); }
});

// VITALS
app.get('/api/vitals', async (req, res) => {
  try { ok(res, (await pool.query('SELECT * FROM vitals_log ORDER BY time DESC')).rows); } catch(e) { err(res,e); }
});
app.post('/api/vitals', async (req, res) => {
  const d = req.body;
  try {
    await pool.query(`INSERT INTO vitals_log VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING`,
      [d.id,d.patientId,d.time,d.bp,d.pulse,d.temp,d.spo2,d.resp,d.glucose,d.pain,d.nurse,d.notes,d.savedAt||new Date().toISOString()]);
    ok(res, d);
  } catch(e) { err(res,e); }
});

// WARDS
app.get('/api/wards', async (req, res) => {
  try { ok(res, (await pool.query('SELECT * FROM wards ORDER BY name')).rows); } catch(e) { err(res,e); }
});
app.post('/api/wards', async (req, res) => {
  const d = req.body;
  try {
    await pool.query(`INSERT INTO wards VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=$2,beds=$3,type=$4`,
      [d.id,d.name,d.beds||10,d.type||'General']);
    ok(res, d);
  } catch(e) { err(res,e); }
});
app.delete('/api/wards/:id', async (req, res) => {
  try { await pool.query('DELETE FROM wards WHERE id=$1',[req.params.id]); ok(res,{}); } catch(e) { err(res,e); }
});

// STAFF
app.get('/api/staff', async (req, res) => {
  try { ok(res, (await pool.query('SELECT * FROM staff ORDER BY name')).rows); } catch(e) { err(res,e); }
});
app.post('/api/staff', async (req, res) => {
  const d = req.body;
  try {
    await pool.query(`INSERT INTO staff VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=$2,role=$3,dept=$4,qual=$5,contact=$6`,
      [d.id,d.name,d.role,d.dept||'',d.qual||'',d.contact||'']);
    ok(res, d);
  } catch(e) { err(res,e); }
});
app.delete('/api/staff/:id', async (req, res) => {
  try { await pool.query('DELETE FROM staff WHERE id=$1',[req.params.id]); ok(res,{}); } catch(e) { err(res,e); }
});

// APPOINTMENTS
app.get('/api/appointments', async (req, res) => {
  try { ok(res, (await pool.query('SELECT * FROM appointments ORDER BY date DESC')).rows); } catch(e) { err(res,e); }
});
app.post('/api/appointments', async (req, res) => {
  const d = req.body;
  try {
    await pool.query(`INSERT INTO appointments VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(id) DO UPDATE SET patient_name=$2,mobile=$3,age=$4,gender=$5,date=$6,time=$7,
      doctor=$8,dept=$9,reason=$10,notes=$11,status=$12,created_at=$13`,
      [d.id,d.patientName,d.mobile,d.age||'',d.gender||'',d.date,d.time||'',
       d.doctor||'',d.dept||'',d.reason||'',d.notes||'',d.status||'scheduled',d.createdAt||new Date().toISOString()]);
    ok(res, d);
  } catch(e) { err(res,e); }
});
app.delete('/api/appointments/:id', async (req, res) => {
  try { await pool.query('DELETE FROM appointments WHERE id=$1',[req.params.id]); ok(res,{}); } catch(e) { err(res,e); }
});

// ACCOUNTS
app.get('/api/accounts', async (req, res) => {
  const { adminEmail, adminPw } = req.query;
  try {
    const adminRow = await pool.query('SELECT * FROM accounts WHERE username=$1',[adminEmail]);
    if (!adminRow.rowCount || !(await bcrypt.compare(adminPw, adminRow.rows[0].pw)))
      return res.status(401).json({ ok:false, error:'Invalid admin credentials.' });
    if (adminRow.rows[0].role !== 'admin')
      return res.status(403).json({ ok:false, error:'Only admin can view users.' });
    const r = await pool.query('SELECT id,name,role,username,email,mobile,dept,qual,created_at FROM accounts ORDER BY created_at DESC');
    ok(res, r.rows);
  } catch(e) { err(res,e); }
});

app.post('/api/accounts', async (req, res) => {
  const d = req.body;
  try {
    // Verify admin credentials before creating any user
    if (!d.adminEmail || !d.adminPw)
      return res.status(401).json({ ok:false, error:'Admin credentials required to create users.' });
    const adminRow = await pool.query('SELECT * FROM accounts WHERE username=$1',[d.adminEmail]);
    if (!adminRow.rowCount || !(await bcrypt.compare(d.adminPw, adminRow.rows[0].pw)))
      return res.status(401).json({ ok:false, error:'Invalid admin credentials.' });
    if (adminRow.rows[0].role !== 'admin')
      return res.status(403).json({ ok:false, error:'Only admin can create users.' });
    if (!d.pw || d.pw.length < 8) return res.status(400).json({ ok:false, error:'Password must be at least 8 characters.' });
    if (!d.username) return res.status(400).json({ ok:false, error:'Username is required.' });
    const exists = await pool.query('SELECT 1 FROM accounts WHERE username=$1',[d.username]);
    if (exists.rowCount > 0) return res.status(409).json({ ok:false, error:'An account with this username already exists.' });
    const hashedPw = await bcrypt.hash(d.pw, 10);
    await pool.query(`INSERT INTO accounts VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [d.id,d.name,d.role,d.username,d.email||'',d.mobile||'',d.dept||'',d.qual||'',hashedPw,d.createdAt||new Date().toISOString()]);
    ok(res, { id:d.id, name:d.name, role:d.role, username:d.username });
  } catch(e) { err(res,e); }
});
app.post('/api/accounts/login', async (req, res) => {
  const { email, pw } = req.body;
  try {
    if (!email || !pw) return res.status(400).json({ ok:false, error:'Username and password are required.' });
    const r = await pool.query('SELECT * FROM accounts WHERE username=$1',[email]);
    if (r.rowCount === 0) {
      // Dummy compare to prevent timing attacks
      await bcrypt.compare(pw, '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
      return res.status(401).json({ ok:false, error:'Incorrect username or password.' });
    }
    const user = r.rows[0];
    const valid = await bcrypt.compare(pw, user.pw);
    if (!valid) return res.status(401).json({ ok:false, error:'Incorrect username or password.' });
    const { pw: _, ...safeUser } = user;
    ok(res, safeUser);
  } catch(e) { err(res,e); }
});
app.put('/api/accounts/:id/password', async (req, res) => {
  const { oldPw, newPw } = req.body;
  try {
    if (!newPw || newPw.length < 8) return res.status(400).json({ ok:false, error:'New password must be at least 8 characters.' });
    const r = await pool.query('SELECT pw FROM accounts WHERE id=$1',[req.params.id]);
    if (!r.rowCount) return res.status(404).json({ ok:false, error:'Account not found.' });
    const valid = await bcrypt.compare(oldPw, r.rows[0].pw);
    if (!valid) return res.status(401).json({ ok:false, error:'Current password is incorrect.' });
    const hashedNew = await bcrypt.hash(newPw, 10);
    await pool.query('UPDATE accounts SET pw=$1 WHERE id=$2',[hashedNew,req.params.id]);
    ok(res, {});
  } catch(e) { err(res,e); }
});

// FRONTEND
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// START
initDB().then(() => {
  app.listen(PORT, () => console.log(`MediTrack running on port ${PORT}`));
}).catch(e => { console.error('DB init failed:', e.message); process.exit(1); });