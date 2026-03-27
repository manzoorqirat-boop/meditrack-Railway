const express = require('express');
const path    = require('path');
const { Pool } = require('pg');

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
      id TEXT PRIMARY KEY, name TEXT, role TEXT, email TEXT UNIQUE,
      mobile TEXT, dept TEXT, emp_id TEXT, pw TEXT, created_at TEXT
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
app.post('/api/accounts', async (req, res) => {
  const d = req.body;
  try {
    const exists = await pool.query('SELECT 1 FROM accounts WHERE email=$1',[d.email]);
    if (exists.rowCount > 0) return res.status(409).json({ ok:false, error:'An account with this email already exists.' });
    await pool.query(`INSERT INTO accounts VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [d.id,d.name,d.role,d.email,d.mobile||'',d.dept||'',d.empId||'',d.pw,d.createdAt||new Date().toISOString()]);
    ok(res, d);
  } catch(e) { err(res,e); }
});
app.post('/api/accounts/login', async (req, res) => {
  const { email, pw } = req.body;
  try {
    const r = await pool.query('SELECT * FROM accounts WHERE email=$1 AND pw=$2',[email,pw]);
    if (r.rowCount === 0) return res.status(401).json({ ok:false, error:'Incorrect email or password.' });
    ok(res, r.rows[0]);
  } catch(e) { err(res,e); }
});
app.put('/api/accounts/:id/password', async (req, res) => {
  const { oldPw, newPw } = req.body;
  try {
    const r = await pool.query('SELECT pw FROM accounts WHERE id=$1',[req.params.id]);
    if (!r.rowCount || r.rows[0].pw !== oldPw)
      return res.status(401).json({ ok:false, error:'Current password is incorrect.' });
    await pool.query('UPDATE accounts SET pw=$1 WHERE id=$2',[newPw,req.params.id]);
    ok(res, {});
  } catch(e) { err(res,e); }
});

// FRONTEND
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// START
initDB().then(() => {
  app.listen(PORT, () => console.log(`MediTrack running on port ${PORT}`));
}).catch(e => { console.error('DB init failed:', e.message); process.exit(1); });