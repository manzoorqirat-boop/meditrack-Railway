const express = require('express');
const path    = require('path');
const { Pool } = require('pg');
const bcrypt  = require('bcryptjs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// ── DATABASE ─────────────────────────────────────────────────────────────────
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
    CREATE TABLE IF NOT EXISTS audit_log (
      id          TEXT PRIMARY KEY,
      username    TEXT NOT NULL,
      user_role   TEXT DEFAULT '',
      event       TEXT NOT NULL,
      record      TEXT DEFAULT '',
      old_value   TEXT DEFAULT '',
      new_value   TEXT DEFAULT '',
      ip_address  TEXT DEFAULT '',
      timestamp   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts   ON audit_log (timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log (username);
    CREATE INDEX IF NOT EXISTS idx_audit_evt  ON audit_log (event);
  `);

  const { rowCount } = await pool.query('SELECT 1 FROM wards LIMIT 1');
  if (rowCount === 0) {
    await pool.query(`INSERT INTO wards VALUES
      ('w1','General Ward A',12,'General'),
      ('w2','ICU',4,'ICU'),
      ('w3','Pediatric Ward',6,'Pediatric')
      ON CONFLICT DO NOTHING`);
  }
  const { rowCount: adminCount } = await pool.query('SELECT 1 FROM accounts LIMIT 1');
  if (adminCount === 0) {
    const defaultPw = await bcrypt.hash('Admin@123', 10);
    await pool.query(
      `INSERT INTO accounts VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      ['admin-001','Administrator','admin','admin@meditrack.local','','Administration','ADM-001',defaultPw,new Date().toISOString()]
    );
    console.log('Default admin seeded — email: admin@meditrack.local  password: Admin@123');
  }
  console.log('Database ready');
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
const ok  = (res, data) => res.json({ ok: true, data });
const err = (res, e)    => { console.error(e); res.status(500).json({ ok: false, error: e.message }); };

// ── AUDIT HELPER ──────────────────────────────────────────────────────────────
// Mirrors ERES Manager AuditLog: username, event, record, old_value, new_value, ip_address
async function audit({ username, userRole, event, record, oldValue, newValue, ip }) {
  try {
    const id = 'al' + Date.now() + Math.random().toString(36).slice(2, 7);
    await pool.query(
      `INSERT INTO audit_log (id,username,user_role,event,record,old_value,new_value,ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, username||'system', userRole||'', event, record||'', oldValue||'', newValue||'', ip||'']
    );
  } catch (e) { console.error('[AUDIT] Failed:', e.message); }
}

// ── PATIENTS ──────────────────────────────────────────────────────────────────
app.get('/api/patients', async (req, res) => {
  try { ok(res, (await pool.query('SELECT * FROM patients ORDER BY updated_at DESC NULLS LAST')).rows); }
  catch(e) { err(res,e); }
});

app.post('/api/patients', async (req, res) => {
  const d = req.body;
  try {
    const existing = await pool.query('SELECT * FROM patients WHERE id=$1', [d.id]);
    const isUpdate = existing.rowCount > 0;
    const old = isUpdate ? existing.rows[0] : null;

    await pool.query(
      `INSERT INTO patients VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT(id) DO UPDATE SET
         name=$2,age=$3,gender=$4,blood=$5,contact=$6,ward_id=$7,
         admit_date=$8,doctor=$9,diagnosis=$10,allergies=$11,
         status=$12,discharge_date=$13,updated_at=$14`,
      [d.id,d.name,d.age,d.gender,d.blood,d.contact,d.wardId,d.admitDate,d.doctor,
       d.diagnosis,d.allergies,d.status||'admitted',d.dischargeDate||null,d.updatedAt||new Date().toISOString()]
    );

    if (!isUpdate) {
      await audit({ username:d._actor, userRole:d._actorRole, event:'PATIENT_ADMITTED',
        record:d.name, oldValue:'Not exists',
        newValue:`Ward:${d.wardId||'—'} | Doctor:${d.doctor||'—'} | DOA:${d.admitDate||'—'}`, ip:d._ip });
    } else {
      const changes = [];
      if (old.name !== d.name) changes.push(`Name: ${old.name} → ${d.name}`);
      if (old.ward_id !== d.wardId) changes.push(`Ward: ${old.ward_id} → ${d.wardId}`);
      if (old.doctor !== d.doctor) changes.push(`Doctor: ${old.doctor} → ${d.doctor}`);
      if (old.diagnosis !== d.diagnosis) changes.push(`Diagnosis updated`);
      if (old.status !== (d.status||'admitted')) changes.push(`Status: ${old.status} → ${d.status}`);
      await audit({ username:d._actor, userRole:d._actorRole, event:'PATIENT_UPDATED',
        record:d.name, oldValue:`Status:${old.status}`,
        newValue:changes.length ? changes.join(' | ') : 'Record re-saved', ip:d._ip });
    }
    ok(res, d);
  } catch(e) { err(res,e); }
});

app.post('/api/patients/:id/discharge', async (req, res) => {
  const { _actor, _actorRole, _ip } = req.body;
  try {
    const r = await pool.query('SELECT * FROM patients WHERE id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ ok:false, error:'Patient not found' });
    const p = r.rows[0];
    const ts = new Date().toISOString();
    await pool.query(`UPDATE patients SET status='discharged',discharge_date=$1,updated_at=$2 WHERE id=$3`,[ts,ts,req.params.id]);
    await audit({ username:_actor, userRole:_actorRole, event:'PATIENT_DISCHARGED',
      record:p.name, oldValue:`Status:admitted | Ward:${p.ward_id||'—'}`,
      newValue:`Status:discharged | Date:${ts.slice(0,10)}`, ip:_ip });
    ok(res, { id:req.params.id, status:'discharged', dischargeDate:ts });
  } catch(e) { err(res,e); }
});

app.delete('/api/patients/:id', async (req, res) => {
  const { actor, actorRole } = req.query;
  try {
    const r = await pool.query('SELECT * FROM patients WHERE id=$1', [req.params.id]);
    const p = r.rowCount ? r.rows[0] : { name:req.params.id, status:'—' };
    await pool.query('DELETE FROM patients WHERE id=$1', [req.params.id]);
    await audit({ username:actor, userRole:actorRole, event:'PATIENT_DELETED',
      record:p.name, oldValue:`Status:${p.status||'—'}`, newValue:'Record deleted', ip:req.ip });
    ok(res, {});
  } catch(e) { err(res,e); }
});

// ── VITALS ────────────────────────────────────────────────────────────────────
app.get('/api/vitals', async (req, res) => {
  try { ok(res, (await pool.query('SELECT * FROM vitals_log ORDER BY time DESC')).rows); }
  catch(e) { err(res,e); }
});

app.post('/api/vitals', async (req, res) => {
  const d = req.body;
  try {
    await pool.query(
      `INSERT INTO vitals_log VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING`,
      [d.id,d.patientId,d.time,d.bp,d.pulse,d.temp,d.spo2,d.resp,d.glucose,d.pain,d.nurse,d.notes,d.savedAt||new Date().toISOString()]
    );
    const pr = await pool.query('SELECT name FROM patients WHERE id=$1', [d.patientId]);
    const patName = pr.rowCount ? pr.rows[0].name : d.patientId;
    await audit({ username:d._actor||d.nurse, userRole:d._actorRole, event:'VITALS_RECORDED',
      record:patName, oldValue:'—',
      newValue:`BP:${d.bp||'—'} | Pulse:${d.pulse||'—'} | Temp:${d.temp||'—'} | SpO2:${d.spo2||'—'} | Nurse:${d.nurse||'—'}`,
      ip:d._ip });
    ok(res, d);
  } catch(e) { err(res,e); }
});

// ── WARDS ─────────────────────────────────────────────────────────────────────
app.get('/api/wards', async (req, res) => {
  try { ok(res, (await pool.query('SELECT * FROM wards ORDER BY name')).rows); }
  catch(e) { err(res,e); }
});

app.post('/api/wards', async (req, res) => {
  const d = req.body;
  try {
    const existing = await pool.query('SELECT * FROM wards WHERE id=$1', [d.id]);
    const isUpdate = existing.rowCount > 0;
    await pool.query(
      `INSERT INTO wards VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=$2,beds=$3,type=$4`,
      [d.id,d.name,d.beds||10,d.type||'General']
    );
    await audit({ username:d._actor, userRole:d._actorRole,
      event: isUpdate ? 'WARD_UPDATED' : 'WARD_CREATED', record:d.name,
      oldValue: isUpdate ? `Beds:${existing.rows[0].beds} | Type:${existing.rows[0].type}` : 'Not exists',
      newValue:`Beds:${d.beds||10} | Type:${d.type||'General'}`, ip:d._ip });
    ok(res, d);
  } catch(e) { err(res,e); }
});

app.delete('/api/wards/:id', async (req, res) => {
  const { actor, actorRole } = req.query;
  try {
    const r = await pool.query('SELECT * FROM wards WHERE id=$1', [req.params.id]);
    const w = r.rowCount ? r.rows[0] : { name:req.params.id };
    await pool.query('DELETE FROM wards WHERE id=$1', [req.params.id]);
    await audit({ username:actor, userRole:actorRole, event:'WARD_DELETED',
      record:w.name, oldValue:`Beds:${w.beds||'—'} | Type:${w.type||'—'}`, newValue:'Deleted', ip:req.ip });
    ok(res, {});
  } catch(e) { err(res,e); }
});

// ── STAFF ─────────────────────────────────────────────────────────────────────
app.get('/api/staff', async (req, res) => {
  try { ok(res, (await pool.query('SELECT * FROM staff ORDER BY name')).rows); }
  catch(e) { err(res,e); }
});

app.post('/api/staff', async (req, res) => {
  const d = req.body;
  try {
    const existing = await pool.query('SELECT * FROM staff WHERE id=$1', [d.id]);
    const isUpdate = existing.rowCount > 0;
    await pool.query(
      `INSERT INTO staff VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=$2,role=$3,dept=$4,qual=$5,contact=$6`,
      [d.id,d.name,d.role,d.dept||'',d.qual||'',d.contact||'']
    );
    await audit({ username:d._actor, userRole:d._actorRole,
      event: isUpdate ? 'STAFF_UPDATED' : 'STAFF_ADDED', record:d.name,
      oldValue: isUpdate ? `Role:${existing.rows[0].role} | Dept:${existing.rows[0].dept}` : 'Not exists',
      newValue:`Role:${d.role} | Dept:${d.dept||'—'} | Qual:${d.qual||'—'}`, ip:d._ip });
    ok(res, d);
  } catch(e) { err(res,e); }
});

app.delete('/api/staff/:id', async (req, res) => {
  const { actor, actorRole } = req.query;
  try {
    const r = await pool.query('SELECT * FROM staff WHERE id=$1', [req.params.id]);
    const s = r.rowCount ? r.rows[0] : { name:req.params.id };
    await pool.query('DELETE FROM staff WHERE id=$1', [req.params.id]);
    await audit({ username:actor, userRole:actorRole, event:'STAFF_REMOVED',
      record:s.name, oldValue:`Role:${s.role||'—'} | Dept:${s.dept||'—'}`, newValue:'Removed', ip:req.ip });
    ok(res, {});
  } catch(e) { err(res,e); }
});

// ── APPOINTMENTS ──────────────────────────────────────────────────────────────
app.get('/api/appointments', async (req, res) => {
  try { ok(res, (await pool.query('SELECT * FROM appointments ORDER BY date DESC')).rows); }
  catch(e) { err(res,e); }
});

app.post('/api/appointments', async (req, res) => {
  const d = req.body;
  try {
    const existing = await pool.query('SELECT * FROM appointments WHERE id=$1', [d.id]);
    const isUpdate = existing.rowCount > 0;
    const old = isUpdate ? existing.rows[0] : null;
    await pool.query(
      `INSERT INTO appointments VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(id) DO UPDATE SET patient_name=$2,mobile=$3,age=$4,gender=$5,
       date=$6,time=$7,doctor=$8,dept=$9,reason=$10,notes=$11,status=$12,created_at=$13`,
      [d.id,d.patientName,d.mobile,d.age||'',d.gender||'',d.date,d.time||'',
       d.doctor||'',d.dept||'',d.reason||'',d.notes||'',d.status||'scheduled',d.createdAt||new Date().toISOString()]
    );
    if (!isUpdate) {
      await audit({ username:d._actor, userRole:d._actorRole, event:'APPOINTMENT_BOOKED',
        record:d.patientName, oldValue:'Not exists',
        newValue:`Date:${d.date} ${d.time||''} | Doctor:${d.doctor||'—'} | Status:${d.status||'scheduled'}`, ip:d._ip });
    } else if (old && old.status !== d.status) {
      await audit({ username:d._actor, userRole:d._actorRole, event:'APPOINTMENT_STATUS_CHANGED',
        record:d.patientName, oldValue:`Status:${old.status}`, newValue:`Status:${d.status}`, ip:d._ip });
    } else {
      await audit({ username:d._actor, userRole:d._actorRole, event:'APPOINTMENT_UPDATED',
        record:d.patientName, oldValue:`Date:${old.date} | Doctor:${old.doctor||'—'}`,
        newValue:`Date:${d.date} | Doctor:${d.doctor||'—'}`, ip:d._ip });
    }
    ok(res, d);
  } catch(e) { err(res,e); }
});

app.delete('/api/appointments/:id', async (req, res) => {
  const { actor, actorRole } = req.query;
  try {
    const r = await pool.query('SELECT * FROM appointments WHERE id=$1', [req.params.id]);
    const a = r.rowCount ? r.rows[0] : { patient_name:req.params.id };
    await pool.query('DELETE FROM appointments WHERE id=$1', [req.params.id]);
    await audit({ username:actor, userRole:actorRole, event:'APPOINTMENT_CANCELLED',
      record:a.patient_name, oldValue:`Date:${a.date||'—'} | Doctor:${a.doctor||'—'}`, newValue:'Cancelled', ip:req.ip });
    ok(res, {});
  } catch(e) { err(res,e); }
});

// ── ACCOUNTS ──────────────────────────────────────────────────────────────────
app.get('/api/accounts', async (req, res) => {
  const { adminEmail, adminPw } = req.query;
  try {
    const adminRow = await pool.query('SELECT * FROM accounts WHERE email=$1', [adminEmail]);
    if (!adminRow.rowCount || !(await bcrypt.compare(adminPw, adminRow.rows[0].pw)))
      return res.status(401).json({ ok:false, error:'Invalid admin credentials.' });
    if (adminRow.rows[0].role !== 'admin')
      return res.status(403).json({ ok:false, error:'Only admin can view users.' });
    const r = await pool.query('SELECT id,name,role,email,mobile,dept,emp_id,created_at FROM accounts ORDER BY created_at DESC');
    ok(res, r.rows);
  } catch(e) { err(res,e); }
});

app.post('/api/accounts', async (req, res) => {
  const d = req.body;
  try {
    if (!d.adminEmail || !d.adminPw)
      return res.status(401).json({ ok:false, error:'Admin credentials required.' });
    const adminRow = await pool.query('SELECT * FROM accounts WHERE email=$1', [d.adminEmail]);
    if (!adminRow.rowCount || !(await bcrypt.compare(d.adminPw, adminRow.rows[0].pw)))
      return res.status(401).json({ ok:false, error:'Invalid admin credentials.' });
    if (adminRow.rows[0].role !== 'admin')
      return res.status(403).json({ ok:false, error:'Only admin can create users.' });
    if (!d.pw || d.pw.length < 8)
      return res.status(400).json({ ok:false, error:'Password must be at least 8 characters.' });
    const exists = await pool.query('SELECT 1 FROM accounts WHERE email=$1', [d.email]);
    if (exists.rowCount > 0)
      return res.status(409).json({ ok:false, error:'An account with this email already exists.' });
    const hashedPw = await bcrypt.hash(d.pw, 10);
    await pool.query(`INSERT INTO accounts VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [d.id,d.name,d.role,d.email,d.mobile||'',d.dept||'',d.empId||'',hashedPw,d.createdAt||new Date().toISOString()]);
    const admin = adminRow.rows[0];
    await audit({ username:admin.email, userRole:admin.role, event:'USER_CREATED',
      record:d.email, oldValue:'Not exists', newValue:`Name:${d.name} | Role:${d.role} | Dept:${d.dept||'—'}`, ip:req.ip });
    ok(res, { id:d.id, name:d.name, role:d.role, email:d.email });
  } catch(e) { err(res,e); }
});

app.post('/api/accounts/login', async (req, res) => {
  const { email, pw } = req.body;
  try {
    if (!email || !pw) return res.status(400).json({ ok:false, error:'Email and password are required.' });
    const r = await pool.query('SELECT * FROM accounts WHERE email=$1', [email]);
    if (r.rowCount === 0) {
      await bcrypt.compare(pw, '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
      await audit({ username:email, event:'LOGIN_FAILED', record:'System',
        oldValue:'Valid session', newValue:'Account not found', ip:req.ip });
      return res.status(401).json({ ok:false, error:'Incorrect email or password.' });
    }
    const user = r.rows[0];
    const valid = await bcrypt.compare(pw, user.pw);
    if (!valid) {
      await audit({ username:email, userRole:user.role, event:'LOGIN_FAILED', record:'System',
        oldValue:'Valid session', newValue:'Incorrect password', ip:req.ip });
      return res.status(401).json({ ok:false, error:'Incorrect email or password.' });
    }
    await audit({ username:email, userRole:user.role, event:'LOGIN',
      record:'System', oldValue:'Logged out', newValue:`Logged in | IP:${req.ip}`, ip:req.ip });
    const { pw: _, ...safeUser } = user;
    ok(res, safeUser);
  } catch(e) { err(res,e); }
});

app.post('/api/accounts/logout', async (req, res) => {
  const { email, role } = req.body;
  try {
    await audit({ username:email, userRole:role, event:'LOGOUT',
      record:'System', oldValue:'Logged in', newValue:'Logged out', ip:req.ip });
    ok(res, {});
  } catch(e) { err(res,e); }
});

app.put('/api/accounts/:id/password', async (req, res) => {
  const { oldPw, newPw, email } = req.body;
  try {
    if (!newPw || newPw.length < 8)
      return res.status(400).json({ ok:false, error:'New password must be at least 8 characters.' });
    const r = await pool.query('SELECT * FROM accounts WHERE id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ ok:false, error:'Account not found.' });
    const valid = await bcrypt.compare(oldPw, r.rows[0].pw);
    if (!valid) return res.status(401).json({ ok:false, error:'Current password is incorrect.' });
    const hashedNew = await bcrypt.hash(newPw, 10);
    await pool.query('UPDATE accounts SET pw=$1 WHERE id=$2', [hashedNew, req.params.id]);
    await audit({ username:email||r.rows[0].email, userRole:r.rows[0].role, event:'PASSWORD_CHANGED',
      record:'System', oldValue:'Previous password', newValue:'New password set', ip:req.ip });
    ok(res, {});
  } catch(e) { err(res,e); }
});

// ── AUDIT LOG API ─────────────────────────────────────────────────────────────
// Mirrors ERES Manager /api/audit — paginated, filterable
app.get('/api/audit', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
    const skip  = (page - 1) * limit;
    const conds = [], params = [];
    let pi = 1;
    if (req.query.event)    { conds.push(`event = $${pi++}`);              params.push(req.query.event); }
    if (req.query.username) { conds.push(`username ILIKE $${pi++}`);       params.push('%'+req.query.username+'%'); }
    if (req.query.from)     { conds.push(`timestamp >= $${pi++}`);         params.push(req.query.from); }
    if (req.query.to)       { conds.push(`timestamp <= $${pi++}`);         params.push(req.query.to); }
    if (req.query.search)   { conds.push(`(record ILIKE $${pi} OR new_value ILIKE $${pi} OR old_value ILIKE $${pi})`); params.push('%'+req.query.search+'%'); pi++; }
    const where = conds.length ? 'WHERE '+conds.join(' AND ') : '';
    const [data, cnt] = await Promise.all([
      pool.query(`SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT $${pi} OFFSET $${pi+1}`, [...params,limit,skip]),
      pool.query(`SELECT COUNT(*) FROM audit_log ${where}`, params)
    ]);
    const total = parseInt(cnt.rows[0].count);
    ok(res, { entries:data.rows, total, page, limit, pages:Math.ceil(total/limit) });
  } catch(e) { err(res,e); }
});

app.get('/api/audit/stats', async (req, res) => {
  try {
    const [tot, tod, evts, usrs] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM audit_log`),
      pool.query(`SELECT COUNT(*) FROM audit_log WHERE timestamp >= NOW()-INTERVAL '24 hours'`),
      pool.query(`SELECT event, COUNT(*) cnt FROM audit_log GROUP BY event ORDER BY cnt DESC LIMIT 10`),
      pool.query(`SELECT username, COUNT(*) cnt FROM audit_log GROUP BY username ORDER BY cnt DESC LIMIT 5`)
    ]);
    ok(res, { total:parseInt(tot.rows[0].count), today:parseInt(tod.rows[0].count), topEvents:evts.rows, topUsers:usrs.rows });
  } catch(e) { err(res,e); }
});

// ── FRONTEND ──────────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── START ──────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`MediTrack running on port ${PORT}`));
}).catch(e => { console.error('DB init failed:', e.message); process.exit(1); });