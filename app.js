// ── STATE ──────────────────────────────────────────────────────────
window._patients  = [];
window._vitalsLog = [];
window._staff     = [];
window._wards     = [];
window._editingPatientId = null;
window._editingStaffId   = null;
window._patientFilter    = 'all';
window._patientSearch    = '';

// ── HELPERS ────────────────────────────────────────────────────────
function ini(n){ return (n||'?').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase(); }
function getPatient(id){ return window._patients.find(p=>p.id===id); }
function getWard(id){ return window._wards.find(w=>w.id===id); }

function statusBadge(p){
  if(p.status==='discharged') return '<span class="badge badge-gray">Discharged</span>';
  const logs=window._vitalsLog.filter(l=>l.patientId===p.id);
  if(!logs.length) return '<span class="badge badge-info">No logs</span>';
  const l=logs[0],spo2=parseFloat(l.spo2),pulse=parseFloat(l.pulse),temp=parseFloat(l.temp);
  if(spo2<93||pulse>110||pulse<50||temp>101||temp<96) return '<span class="badge badge-danger">Needs Attention</span>';
  if(spo2<96||pulse>95||temp>100) return '<span class="badge badge-warn">Monitor</span>';
  return '<span class="badge badge-ok">Stable</span>';
}

// ── SYNC UI ────────────────────────────────────────────────────────
function setSyncStatus(state,text){
  ['sync-dot','sync-dot-m'].forEach(id=>{ const e=document.getElementById(id); if(e) e.className='sync-dot '+state; });
  ['sync-text','sync-text-m'].forEach(id=>{ const e=document.getElementById(id); if(e) e.textContent=text; });
}
function showLoading(msg){ document.getElementById('loading-text').textContent=msg||'Loading…'; document.getElementById('loading-overlay').classList.remove('hidden'); }
function hideLoading(){ document.getElementById('loading-overlay').classList.add('hidden'); }

// ── NAVIGATION ─────────────────────────────────────────────────────
window.showPage=function(id){
  if(id==='users') loadUsers();
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const pg=document.getElementById('page-'+id);
  if(pg) pg.classList.add('active');
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===id));
  if     (id==='dashboard')        renderDashboard();
  else if(id==='patients')         { window._patientSearch=''; const si=document.getElementById('patient-search'); if(si) si.value=''; renderPatients(window._patientFilter); }
  else if(id==='vitals')           { populatePatientSelect(); refreshNurseSelect(); }
  else if(id==='wards')            { stopVitalsClock(); renderWards(); }
  else if(id==='staff')            { stopVitalsClock(); renderStaffPage(); }
  else if(id==='history')          { stopVitalsClock(); populateHistorySelect(); renderHistory(); }
  else if(id==='appointments')     { stopVitalsClock(); renderAppointments(); }
  else if(id==='book-appointment') { stopVitalsClock(); initBookAppt(); }
  else if(id==='change-password')  { stopVitalsClock(); renderChangePassword(); }
  else if(id==='audit')            { stopVitalsClock(); loadAuditStats(); loadAudit(1); }
  else if(id==='login')            { stopVitalsClock(); resetLoginForm(); }
};

window.openDrawer=function(){ document.getElementById('drawer').classList.add('open'); document.getElementById('drawer-overlay').classList.add('open'); document.body.style.overflow='hidden'; };
window.closeDrawer=function(){ document.getElementById('drawer').classList.remove('open'); document.getElementById('drawer-overlay').classList.remove('open'); document.body.style.overflow=''; };

// ── REST API ───────────────────────────────────────────────────────
async function api(method, path, body){
  setSyncStatus('saving','Saving…');
  try{
    const token = localStorage.getItem('meditrack_token') || '';
    const res = await fetch(path,{
      method,
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json();
    if(res.status === 401){ window.logoutUser(); return; }
    if(!json.ok) throw new Error(json.error||'Request failed');
    setSyncStatus('live','Live · PostgreSQL');
    return json.data;
  } catch(e){
    setSyncStatus('offline','Error: '+e.message);
    throw e;
  }
}

async function loadAll(){
  if(!localStorage.getItem('meditrack_token')){ hideLoading(); showPage('login'); return; }
  setSyncStatus('saving','Loading…'); showLoading('Loading data…');
  try{
    const [patients,vitals,wards,staff,appts] = await Promise.all([
      api('GET','/api/patients'),
      api('GET','/api/vitals?limit=200'),
      api('GET','/api/wards'),
      api('GET','/api/staff'),
      api('GET','/api/appointments'),
    ]);
    window._patients     = patients.map(normalizePatient);
    window._vitalsLog    = vitals.map(normalizeVital);
    window._wards        = wards.map(normalizeWard);
    window._staff        = staff.map(normalizeStaff);
    window._appointments = appts.map(normalizeAppt);
    setSyncStatus('live','Live · PostgreSQL');
    hideLoading();
    renderDashboard();
  } catch(e){
    setSyncStatus('offline','Load failed');
    hideLoading();
    if(e.message && (e.message.includes('401')||e.message.includes('Authentication'))){ showPage('login'); }
  }
}

// Normalize snake_case from DB → camelCase used in UI
function normalizePatient(r){ return {id:r.id,name:r.name,age:r.age,gender:r.gender,blood:r.blood,contact:r.contact,wardId:r.ward_id,admitDate:r.admit_date,doctor:r.doctor,diagnosis:r.diagnosis,allergies:r.allergies,status:r.status,dischargeDate:r.discharge_date,updatedAt:r.updated_at}; }
function normalizeVital(r){ return {id:r.id,patientId:r.patient_id,time:r.time,bp:r.bp,pulse:r.pulse,temp:r.temp,spo2:r.spo2,resp:r.resp,glucose:r.glucose,pain:r.pain,nurse:r.nurse,notes:r.notes,savedAt:r.saved_at}; }
function normalizeWard(r){ return {id:r.id,name:r.name,beds:r.beds,type:r.type}; }
function normalizeStaff(r){ return {id:r.id,name:r.name,role:r.role,dept:r.dept,qual:r.qual,contact:r.contact}; }
function normalizeAppt(r){ return {id:r.id,patientName:r.patient_name,mobile:r.mobile,age:r.age,gender:r.gender,date:r.date,time:r.time,doctor:r.doctor,dept:r.dept,reason:r.reason,notes:r.notes,status:r.status,createdAt:r.created_at}; }

function refreshCurrentPage(){
  const active=document.querySelector('.page.active'); if(!active) return;
  const id=active.id.replace('page-','');
  if     (id==='dashboard')    renderDashboard();
  else if(id==='patients')     renderPatients(window._patientFilter);
  else if(id==='vitals')       { populatePatientSelect(); refreshNurseSelect(); }
  else if(id==='wards')        renderWards();
  else if(id==='staff')        renderStaffPage();
  else if(id==='history')      { populateHistorySelect(); renderHistory(); }
  else if(id==='appointments') renderAppointments();
}

// ── DASHBOARD ──────────────────────────────────────────────────────
function renderDashboard(){
  document.getElementById('dash-time').textContent=new Date().toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'});
  const admitted=window._patients.filter(p=>p.status==='admitted');
  const todayStr=new Date().toISOString().split('T')[0];
  const warn=admitted.filter(p=>{ const logs=window._vitalsLog.filter(l=>l.patientId===p.id); if(!logs.length) return false; const l=logs[0]; return parseFloat(l.spo2)<93||parseFloat(l.pulse)>110||parseFloat(l.pulse)<50||parseFloat(l.temp)>101||parseFloat(l.temp)<96; });
  document.getElementById('stat-total').textContent=window._patients.length;
  document.getElementById('stat-today').textContent=window._patients.filter(p=>p.admitDate===todayStr&&p.status==='admitted').length;
  document.getElementById('stat-warn').textContent=warn.length;
  document.getElementById('stat-logs').textContent=window._vitalsLog.filter(l=>l.time&&l.time.startsWith(todayStr)).length;
  document.getElementById('alert-area').innerHTML=warn.map(p=>`<div class="alert-banner"><span style="font-size:16px">⚠</span><b>${p.name}</b> — abnormal vitals. Immediate review recommended.</div>`).join('');
  const recent=window._vitalsLog.slice(0,5);
  document.getElementById('dash-activity').innerHTML=recent.length?recent.map(l=>{
    const p=getPatient(l.patientId);
    const t=l.time?new Date(l.time).toLocaleString('en-IN',{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'}):'—';
    return `<div class="history-row"><span class="time-badge">${t}</span><div><div style="font-size:13px;font-weight:500">${p?p.name:'Unknown'}</div><div class="vitals-chips"><span class="v-chip">BP ${l.bp||'—'}</span><span class="v-chip">Pulse ${l.pulse||'—'} bpm</span><span class="v-chip">Temp ${l.temp||'—'}°F</span><span class="v-chip ${parseFloat(l.spo2)<94?'abnormal':''}">SpO2 ${l.spo2||'—'}%</span></div></div></div>`;
  }).join(''):'<div class="empty-state">No vitals recorded yet.</div>';
  document.getElementById('dash-patients').innerHTML=admitted.map(p=>`<div class="patient-row"><div class="patient-info"><div class="avatar">${ini(p.name)}</div><div><div class="patient-name">${p.name}</div><div class="patient-meta">${p.age||''}y · ${p.gender||''} · ${getWard(p.wardId)?getWard(p.wardId).name:'No ward'}</div></div></div>${statusBadge(p)}</div>`).join('')||'<div class="empty-state">No admitted patients.</div>';
}

// ── PATIENTS ───────────────────────────────────────────────────────
function renderPatients(filter){
  window._patientFilter = filter || 'all';
  const search = (window._patientSearch||'').toLowerCase().trim();
  let list = window._patients;
  if(filter==='admitted')   list=list.filter(p=>p.status==='admitted');
  if(filter==='discharged') list=list.filter(p=>p.status==='discharged');
  if(search){
    list=list.filter(p=>{
      const ward=getWard(p.wardId);
      return [p.name,p.doctor,p.diagnosis,p.allergies,p.contact,p.blood,ward?ward.name:''].join(' ').toLowerCase().includes(search);
    });
  }
  const countEl=document.getElementById('patient-count');
  if(countEl) countEl.textContent=(search||filter!=='all')?`${list.length} result${list.length!==1?'s':''}` :'';
  const el=document.getElementById('patient-list'); if(!el) return;
  if(!list.length){
    el.innerHTML=`<div class="empty-state">${search?`No patients match "<b>${search}</b>". <a href="#" onclick="window._patientSearch='';document.getElementById('patient-search').value='';renderPatients(window._patientFilter);return false">Clear</a>`:'No patients found.'}</div>`;
    return;
  }
  el.innerHTML=list.map(p=>{
    const ward=getWard(p.wardId);
    let displayName=p.name;
    if(search&&p.name.toLowerCase().includes(search)){
      const i=p.name.toLowerCase().indexOf(search);
      displayName=p.name.slice(0,i)+`<mark style="background:#FEF08A;border-radius:2px;padding:0 1px">${p.name.slice(i,i+search.length)}</mark>`+p.name.slice(i+search.length);
    }
    return `<div class="patient-row"><div class="patient-info"><div class="avatar">${ini(p.name)}</div><div><div class="patient-name">${displayName}</div><div class="patient-meta">${p.age||''}y · ${p.gender||''} · ${p.blood||''} · ${ward?ward.name:'—'} · ${p.doctor||'—'}</div><div class="patient-meta" style="margin-top:2px">${p.diagnosis||''}</div></div></div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${statusBadge(p)}<button class="btn sm" onclick="editPatient('${p.id}')">Edit</button><button class="btn sm" onclick="logVitalsFor('${p.id}')">Log Vitals</button>${p.status==='admitted'?`<button class="btn sm" onclick="dischargePatient('${p.id}')">Discharge</button>`:''}</div></div>`;
  }).join('');
}

window.filterPatients=function(f,el){ document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active')); if(el) el.classList.add('active'); renderPatients(f); };

function refreshDoctorSelect(selected){
  const el=document.getElementById('p-doctor'); if(!el) return;
  const docs=window._staff.filter(s=>s.role==='doctor');
  el.innerHTML=docs.length
    ? '<option value="">— select doctor —</option>'+docs.map(d=>`<option value="${d.name}"${selected===d.name?' selected':''}>${d.name}${d.dept?' · '+d.dept:''}</option>`).join('')
    : '<option value="">— no doctors added yet —</option>';
}

window.openAddPatient=function(){
  window._editingPatientId=null;
  document.getElementById('modal-patient-title').textContent='Add New Patient';
  ['p-name','p-age','p-contact','p-diagnosis','p-allergies'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('p-admit').value=new Date().toISOString().split('T')[0];
  document.getElementById('p-ward').innerHTML='<option value="">— no ward —</option>'+window._wards.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
  refreshDoctorSelect();
  document.getElementById('modal-patient').classList.add('open');
};

window.editPatient=function(id){
  const p=getPatient(id); if(!p) return;
  window._editingPatientId=id;
  document.getElementById('modal-patient-title').textContent='Edit Patient';
  document.getElementById('p-name').value=p.name||'';
  document.getElementById('p-age').value=p.age||'';
  document.getElementById('p-gender').value=p.gender||'Male';
  document.getElementById('p-blood').value=p.blood||'A+';
  document.getElementById('p-contact').value=p.contact||'';
  document.getElementById('p-admit').value=p.admitDate||'';
  document.getElementById('p-diagnosis').value=p.diagnosis||'';
  document.getElementById('p-allergies').value=p.allergies||'';
  document.getElementById('p-ward').innerHTML='<option value="">— no ward —</option>'+window._wards.map(w=>`<option value="${w.id}"${p.wardId===w.id?' selected':''}>${w.name}</option>`).join('');
  refreshDoctorSelect(p.doctor);
  document.getElementById('modal-patient').classList.add('open');
};

window.savePatient=async function(){
  const name=document.getElementById('p-name').value.trim();
  if(!name){ alert('Patient name is required.'); return; }
  const id=window._editingPatientId||('p'+Date.now());
  const existing=getPatient(id)||{};
  const data={...existing,id,name,age:document.getElementById('p-age').value,gender:document.getElementById('p-gender').value,blood:document.getElementById('p-blood').value,contact:document.getElementById('p-contact').value,wardId:document.getElementById('p-ward').value,admitDate:document.getElementById('p-admit').value,doctor:document.getElementById('p-doctor').value,diagnosis:document.getElementById('p-diagnosis').value,allergies:document.getElementById('p-allergies').value,status:existing.status||'admitted',updatedAt:new Date().toISOString()};
  closeModal('modal-patient');
  try{
    await api('POST','/api/patients',data);
    const idx=window._patients.findIndex(p=>p.id===id);
    if(idx>-1) window._patients[idx]=data; else window._patients.push(data);
    renderPatients(window._patientFilter);
  }catch(e){ alert('Save failed: '+e.message); }
};

// ── VITALS ─────────────────────────────────────────────────────────
function populatePatientSelect(){
  const admitted=window._patients.filter(p=>p.status==='admitted');
  document.getElementById('vitals-patient-select').innerHTML='<option value="">— choose patient —</option>'+admitted.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  setVitalsDateTime();
  startVitalsClock();
}

function setVitalsDateTime(){
  const now=new Date();
  const pad=n=>String(n).padStart(2,'0');
  const dateStr=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
  const timeStr=pad(now.getHours())+':'+pad(now.getMinutes());
  const dateEl=document.getElementById('vitals-date-display');
  const timeEl=document.getElementById('vitals-time-display');
  const hiddenEl=document.getElementById('vitals-time');
  if(dateEl) dateEl.textContent=now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  if(timeEl) timeEl.textContent=now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
  if(hiddenEl) hiddenEl.value=dateStr+'T'+timeStr;
}

let _vitalsClockTimer=null;
function startVitalsClock(){
  if(_vitalsClockTimer) clearInterval(_vitalsClockTimer);
  _vitalsClockTimer=setInterval(setVitalsDateTime,1000);
}
function stopVitalsClock(){
  if(_vitalsClockTimer){ clearInterval(_vitalsClockTimer); _vitalsClockTimer=null; }
}

function refreshNurseSelect(selected){
  const el=document.getElementById('v-nurse'); if(!el) return;
  const nurses=window._staff.filter(s=>s.role!=='doctor');
  el.innerHTML=nurses.length
    ? '<option value="">— select nurse / staff —</option>'+nurses.map(n=>`<option value="${n.name}"${selected===n.name?' selected':''}>${n.name}${n.role==='nurse'?' (Nurse)':' (Staff)'}${n.dept?' · '+n.dept:''}</option>`).join('')
    : '<option value="">— no nurses added yet —</option>';
}

window.logVitalsFor=function(pid){ showPage('vitals'); setTimeout(()=>{ document.getElementById('vitals-patient-select').value=pid; },100); };

window.saveVitals=async function(){
  const pid=document.getElementById('vitals-patient-select').value;
  if(!pid){ alert('Please select a patient.'); return; }
  const id='l'+Date.now();
  const log={id,patientId:pid,time:document.getElementById('vitals-time').value,bp:document.getElementById('v-bp').value,pulse:document.getElementById('v-pulse').value,temp:document.getElementById('v-temp').value,spo2:document.getElementById('v-spo2').value,resp:document.getElementById('v-resp').value,glucose:document.getElementById('v-glucose').value,pain:document.getElementById('v-pain').value,nurse:document.getElementById('v-nurse').value,notes:document.getElementById('v-notes').value,savedAt:new Date().toISOString()};
  try{
    await api('POST','/api/vitals',log);
    window._vitalsLog.unshift(log);
    alert('Vitals saved for '+getPatient(pid).name+'!');
    clearVitalsForm();
  }catch(e){ alert('Save failed: '+e.message); }
};

window.clearVitalsForm=function(){
  ['v-bp','v-pulse','v-temp','v-spo2','v-resp','v-glucose','v-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('v-pain').value=0; document.getElementById('pain-out').textContent='0';
  document.getElementById('v-nurse').value='';
  ['bp','pulse','temp','spo2','resp','glucose'].forEach(f=>{
    const input=document.getElementById('v-'+f); if(input) input.classList.remove('vi-normal','vi-warn','vi-critical');
    const ind=document.getElementById('vi-'+f); if(ind) ind.textContent='';
    const hint=document.getElementById('vh-'+f); if(hint){ hint.className='vitals-hint'; hint.textContent=''; }
  });
};

// ── WARDS ──────────────────────────────────────────────────────────
function renderWards(){
  document.getElementById('ward-grid').innerHTML=window._wards.map(w=>{
    const occ=window._patients.filter(p=>p.wardId===w.id&&p.status==='admitted').length;
    const pct=Math.round(occ/(w.beds||1)*100);
    const cls=pct>=90?'badge-danger':pct>=70?'badge-warn':'badge-ok';
    const bar=pct>=90?'#E24B4A':pct>=70?'#EF9F27':'#1D9E75';
    return `<div class="ward-card"><div class="ward-type">${w.type}</div><div class="ward-name">${w.name}</div><div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px"><span class="badge ${cls}">${occ}/${w.beds} beds</span><span style="font-size:11px;color:var(--text-2)">${pct}% full</span></div><div style="margin-top:10px;height:4px;background:var(--bg-2);border-radius:2px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${bar};border-radius:2px"></div></div></div>`;
  }).join('')||'<div class="empty-state">No wards configured.</div>';
}

window.openAddWard=function(){ document.getElementById('modal-ward').classList.add('open'); };
window.saveWard=async function(){
  const name=document.getElementById('w-name').value.trim();
  if(!name){ alert('Ward name required.'); return; }
  const id='w'+Date.now();
  const ward={id,name,beds:parseInt(document.getElementById('w-beds').value)||10,type:document.getElementById('w-type').value};
  closeModal('modal-ward');
  try{
    await api('POST','/api/wards',ward);
    window._wards.push(ward);
    ['w-name','w-beds'].forEach(i=>document.getElementById(i).value='');
    renderWards();
  }catch(e){ alert('Save failed: '+e.message); }
};

// ── STAFF ──────────────────────────────────────────────────────────
function renderStaffPage(){
  const doctors=window._staff.filter(s=>s.role==='doctor');
  const nurses=window._staff.filter(s=>s.role!=='doctor');
  function card(s){
    const avcls=s.role==='doctor'?'doctor':s.role==='nurse'?'nurse':'other';
    const bdg=s.role==='doctor'?'<span class="badge badge-info">Doctor</span>':s.role==='nurse'?'<span class="badge badge-ok">Nurse</span>':'<span class="badge badge-purple">Staff</span>';
    const sub=[s.qual,s.dept].filter(Boolean).join(' · ')||'—';
    return `<div class="staff-card"><div class="staff-card-top"><div class="staff-av ${avcls}">${ini(s.name)}</div><div><div class="staff-nm">${s.name}</div><div class="staff-sub">${sub}</div></div></div><div class="staff-row2">${bdg}<span class="staff-contact">${s.contact||''}</span></div>
  const dEl=document.getElementById('staff-grid-doctors');
  const nEl=document.getElementById('staff-grid-nurses');
  if(dEl) dEl.innerHTML=doctors.length?doctors.map(card).join(''):'<div class="staff-empty">No doctors added yet. Add a user with the Doctor role to see them here.</div>';
  if(nEl) nEl.innerHTML=nurses.length?nurses.map(card).join(''):'<div class="staff-empty">No nurses or staff added yet. Add users with Nurse or Staff roles to see them here.</div>';
}

window.openAddStaff=function(role){
  window._editingStaffId=null;
  document.getElementById('modal-staff-title').textContent=role==='doctor'?'Add Doctor':'Add Nurse / Staff';
  ['st-name','st-dept','st-qual','st-contact'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('st-role').value=role||'nurse';
  document.getElementById('modal-staff').classList.add('open');
};

window.openEditStaff=function(id){
  const s=window._staff.find(x=>x.id===id); if(!s) return;
  window._editingStaffId=id;
  document.getElementById('modal-staff-title').textContent='Edit Staff';
  document.getElementById('st-name').value=s.name||'';
  document.getElementById('st-role').value=s.role||'nurse';
  document.getElementById('st-dept').value=s.dept||'';
  document.getElementById('st-qual').value=s.qual||'';
  document.getElementById('st-contact').value=s.contact||'';
  document.getElementById('modal-staff').classList.add('open');
};

window.saveStaff=async function(){
  const name=document.getElementById('st-name').value.trim();
  if(!name){ alert('Name is required.'); return; }
  const id=window._editingStaffId||('stf'+Date.now());
  const data={id,name,role:document.getElementById('st-role').value,dept:document.getElementById('st-dept').value.trim(),qual:document.getElementById('st-qual').value.trim(),contact:document.getElementById('st-contact').value.trim()};
  closeModal('modal-staff');
  try{
    await api('POST','/api/staff',data);
    const idx=window._staff.findIndex(s=>s.id===id);
    if(idx>-1) window._staff[idx]=data; else window._staff.push(data);
    renderStaffPage(); refreshDoctorSelect(); refreshNurseSelect();
  }catch(e){ alert('Save failed: '+e.message); }
};

window.removeStaff=function(id,name){
  confirmDelete({
    record:name, message:'This staff member will be permanently removed.',
    requireType:'DELETE',
    onConfirm:async()=>{
      await api('DELETE','/api/staff/'+id);
      window._staff=window._staff.filter(s=>s.id!==id);
      renderStaffPage(); refreshDoctorSelect(); refreshNurseSelect();
    }
  });
};

// ── HISTORY / REPORT ───────────────────────────────────────────────
function populateHistorySelect(){
  document.getElementById('hist-patient').innerHTML='<option value="">All Patients</option>'+window._patients.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
}

window.clearHistFilter=function(){
  document.getElementById('hist-patient').value='';
  document.getElementById('hist-date-from').value='';
  document.getElementById('hist-date-to').value='';
  document.getElementById('hist-status').value='';
  window._historyPage=1;
  renderHistory();
};

window.renderHistory=async function(){
  const pid    = document.getElementById('hist-patient').value;
  const from   = document.getElementById('hist-date-from').value;
  const to     = document.getElementById('hist-date-to').value;
  const status = document.getElementById('hist-status').value;
  const page   = window._historyPage || 1;
  const container = document.getElementById('history-list');
  container.innerHTML = '<div class="card"><div class="empty-state">Loading…</div></div>';

  const params = new URLSearchParams({ page, limit:100 });
  if(pid)  params.set('patientId', pid);
  if(from) params.set('from', from);
  if(to)   params.set('to', to);
  if(status==='abnormal') params.set('abnormal','true');

  try{
    const data = await api('GET','/api/vitals/history?'+params.toString());
    const { entries, total, pages } = data;

    const logs = entries.map(r => {
      const l = normalizeVital(r);
      const as=parseFloat(l.spo2)<94, ap=parseFloat(l.pulse)>110||parseFloat(l.pulse)<50;
      const at=parseFloat(l.temp)>101||parseFloat(l.temp)<96, ag=parseFloat(l.glucose)>180||parseFloat(l.glucose)<70;
      return {...l,_abnormal:as||ap||at||ag,_as:as,_ap:ap,_at:at,_ag:ag};
    });

    const filtered = status==='normal' ? logs.filter(l=>!l._abnormal) : logs;
    if(!filtered.length){
      container.innerHTML='<div class="card"><div class="empty-state">No vitals records match.</div></div>';
      return;
    }

    const rows = filtered.map(l => {
      const p=getPatient(l.patientId);
      const t=l.time?new Date(l.time).toLocaleString('en-IN',{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'}):'—';
      return `<div class="history-row${l._abnormal?' rpt-row-abnormal':''}">
        <span class="time-badge">${t}</span>
        <div><div style="font-size:13px;font-weight:500">${p?p.name:'Unknown'}</div>
        <div class="vitals-chips">
          <span class="v-chip${l._ap?' abnormal':''}">Pulse ${l.pulse||'—'} bpm</span>
          <span class="v-chip">BP ${l.bp||'—'}</span>
          <span class="v-chip${l._at?' abnormal':''}">Temp ${l.temp||'—'}°F</span>
          <span class="v-chip${l._as?' abnormal':''}">SpO2 ${l.spo2||'—'}%</span>
        </div></div>
      </div>`;
    }).join('');

    const pgHtml = pages>1 ? `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--b2)">
        <span style="font-size:12px;color:var(--t3)">Page ${page} of ${pages} · ${total} records</span>
        <div style="display:flex;gap:8px">
          ${page>1?`<button class="btn sm" onclick="window._historyPage=${page-1};window.renderHistory()">← Prev</button>`:''}
          ${page<pages?`<button class="btn sm" onclick="window._historyPage=${page+1};window.renderHistory()">Next →</button>`:''}
        </div>
      </div>` : '';
    container.innerHTML=`<div class="card">${rows}${pgHtml}</div>`;
  } catch(e){
    container.innerHTML=`<div class="card"><div class="empty-state" style="color:#c0392b">Failed: ${e.message}</div></div>`;
  }
};

window.printReport=function(){
  window.print();
};

// ── MODALS ─────────────────────────────────────────────────────────
window.closeModal=function(id){ document.getElementById(id).classList.remove('open'); };
document.querySelectorAll('.modal-backdrop').forEach(b=>{
  b.addEventListener('click',e=>{ if(e.target===b) b.classList.remove('open'); });
});
window.openSetup=function(){};
window.closeSetup=function(){};

// ── APPOINTMENTS ──────────────────────────────────────────────────
window._appointments = [];

function todayStr(){ return new Date().toISOString().split('T')[0]; }

function refreshApptDoctorSelect(){
  const el=document.getElementById('appt-doctor'); if(!el) return;
  const docs=window._staff.filter(s=>s.role==='doctor');
  el.innerHTML='<option value="">— select doctor —</option>'+docs.map(d=>`<option value="${d.name}">${d.name}${d.dept?' · '+d.dept:''}</option>`).join('');
}

function initBookAppt(){
  document.getElementById('appt-date').value=todayStr();
  refreshApptDoctorSelect();
  ['appt-pname','appt-mobile','appt-reason','appt-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('appt-age').value='';
  document.getElementById('appt-appttime').value='';
  const msg=document.getElementById('appt-form-msg');
  if(msg) msg.style.display='none';
}

function renderAppointments(filter){
  window._apptFilter=filter||window._apptFilter||'all';
  const today=todayStr();
  let list=window._appointments.slice().sort((a,b)=>a.date>b.date?1:-1);
  const todayList=list.filter(a=>a.date===today);
  const upcoming=list.filter(a=>a.date>today);
  document.getElementById('appt-stat-today').textContent=todayList.length;
  document.getElementById('appt-stat-upcoming').textContent=upcoming.length;
  document.getElementById('appt-stat-total').textContent=list.length;
  if(window._apptFilter==='today')      list=todayList;
  else if(window._apptFilter==='upcoming')   list=upcoming;
  else if(window._apptFilter==='completed')  list=list.filter(a=>a.status==='completed');
  document.getElementById('appt-list').innerHTML=list.length?list.map(a=>{
    const dLabel=a.date===today?'Today':a.date;
    const sBadge=a.status==='completed'?'<span class="badge badge-ok">Completed</span>':a.date<today?'<span class="badge badge-gray">Past</span>':a.date===today?'<span class="badge badge-warn">Today</span>':'<span class="badge badge-info">Upcoming</span>';
    return `<div class="appt-row"><div class="appt-info"><div><div class="appt-time">${a.time||'—'}</div><div style="font-size:10px;color:var(--text-2)">${dLabel}</div></div><div class="avatar">${ini(a.patientName)}</div><div><div class="appt-name">${a.patientName}</div><div class="appt-meta">${a.doctor?'Dr. '+a.doctor:'—'} · ${a.dept||'—'}</div><div class="appt-meta">${a.reason||''}</div></div></div><div class="appt-actions">${sBadge}${a.status!=='completed'?`<button class="btn sm" onclick="markApptDone('${a.id}')">Done</button>`:''}<button class="btn sm danger" onclick="deleteAppt('${a.id}')">✕</button></div></div>`;
  }).join(''):'<div class="empty-state">No appointments found.</div>';
}

window.filterAppts=function(f,el){ document.querySelectorAll('#page-appointments .tab').forEach(t=>t.classList.remove('active')); if(el) el.classList.add('active'); renderAppointments(f); };

window.saveAppointment=async function(){
  const name=document.getElementById('appt-pname').value.trim();
  const mobile=document.getElementById('appt-mobile').value.trim();
  const date=document.getElementById('appt-date').value;
  if(!name||!mobile||!date){ alert('Patient name, mobile, and date are required.'); return; }
  const id='apt'+Date.now();
  const appt={id,patientName:name,mobile,age:document.getElementById('appt-age').value,gender:document.getElementById('appt-gender').value,date,time:document.getElementById('appt-appttime').value,doctor:document.getElementById('appt-doctor').value,dept:document.getElementById('appt-dept').value,reason:document.getElementById('appt-reason').value.trim(),notes:document.getElementById('appt-notes').value.trim(),status:'scheduled',createdAt:new Date().toISOString()};
  try{
    await api('POST','/api/appointments',appt);
    window._appointments.unshift(appt);
    const m=document.getElementById('appt-form-msg');
    if(m){m.textContent='✓ Appointment booked for '+name+'!';m.style.display='block';setTimeout(()=>{m.style.display='none';showPage('appointments');},1500);}
  }catch(e){ alert('Save failed: '+e.message); }
};

window.markApptDone=async function(id){
  const idx=window._appointments.findIndex(a=>a.id===id); if(idx<0) return;
  const updated={...window._appointments[idx],status:'completed'};
  try{
    await api('POST','/api/appointments',updated);
    window._appointments[idx]=updated; renderAppointments();
  }catch(e){ alert('Failed: '+e.message); }
};

window.deleteAppt=function(id){
  const a=window._appointments.find(x=>x.id===id);
  confirmDelete({
    icon:'📅', title:'Cancel appointment?',
    record:a?`${a.patientName} — ${a.date}`:id,
    message:'This appointment will be permanently removed.',
    btnLabel:'Cancel Appointment',
    onConfirm:async()=>{
      await api('DELETE','/api/appointments/'+id);
      window._appointments=window._appointments.filter(x=>x.id!==id);
      renderAppointments();
    }
  });
};

// ── ACCOUNT / AUTH ─────────────────────────────────────────────────
window._currentUser=null;

function updateAuthUI(){
  const u=window._currentUser;
  const loggedIn=!!u;
  const isAdmin=loggedIn&&u.role==='admin';
  document.getElementById('nav-loggedin').style.display=loggedIn?'inline-flex':'none';
  document.getElementById('nav-loggedout').style.display=loggedIn?'none':'inline-flex';
  document.getElementById('drawer-loggedin').style.display=loggedIn?'block':'none';
  document.getElementById('drawer-loggedout').style.display=loggedIn?'none':'block';
  const navUsersBtn=document.getElementById('nav-users-btn');
  if(navUsersBtn) navUsersBtn.style.display=isAdmin?'inline-flex':'none';
  const drawerUsersBtn=document.getElementById('drawer-users-btn');
  if(drawerUsersBtn) drawerUsersBtn.style.display=isAdmin?'flex':'none';
  const navAuditBtn=document.getElementById('nav-audit-btn');
  if(navAuditBtn) navAuditBtn.style.display=isAdmin?'inline-block':'none';
  const drawerAuditBtn=document.getElementById('drawer-audit-btn');
  if(drawerAuditBtn) drawerAuditBtn.style.display=isAdmin?'block':'none';
  const bnavAcc=document.getElementById('bnav-account');
  if(bnavAcc){ bnavAcc.innerHTML=loggedIn?'<span class="b-icon">👤</span>Account':'<span class="b-icon">🔑</span>Login'; }
  if(loggedIn){
    const av=ini(u.name);
    document.getElementById('user-av-top').textContent=av;
    document.getElementById('user-name-top').textContent=u.name.split(' ')[0];
    document.getElementById('user-av-drawer').textContent=av;
    document.getElementById('user-name-drawer').textContent=u.name;
    document.getElementById('user-role-drawer').textContent=u.role||'';
  }
}

function loadStoredUser(){
  try{ const s=localStorage.getItem('meditrack_user'); return s?JSON.parse(s):null; }catch(e){ return null; }
}
function saveStoredUser(u){ try{ localStorage.setItem('meditrack_user',JSON.stringify(u)); }catch(e){} }
function clearStoredUser(){ try{ localStorage.removeItem('meditrack_user'); }catch(e){} }

function showAuthMsg(errId,sucId,msg,isErr){
  const eEl=document.getElementById(errId), sEl=document.getElementById(sucId);
  if(eEl) eEl.style.display='none'; if(sEl) sEl.style.display='none';
  if(isErr&&eEl){ eEl.textContent=msg; eEl.style.display='block'; }
  else if(!isErr&&sEl){ sEl.textContent=msg; sEl.style.display='block'; }
}

window.togglePw=function(inputId,btn){
  const inp=document.getElementById(inputId); if(!inp) return;
  const show=inp.type==='password'; inp.type=show?'text':'password'; btn.textContent=show?'🙈':'👁';
};

window.checkStrength=function(pw,fillId,labelId){
  fillId=fillId||'strength-fill'; labelId=labelId||'strength-label';
  const fill=document.getElementById(fillId), label=document.getElementById(labelId);
  if(!fill||!label) return;
  let score=0;
  if(pw.length>=8) score++;
  if(/[A-Z]/.test(pw)) score++;
  if(/[0-9]/.test(pw)) score++;
  if(/[^A-Za-z0-9]/.test(pw)) score++;
  const map=[[0,'#ef4444','Very weak'],[1,'#f97316','Weak'],[2,'#eab308','Fair'],[3,'#22c55e','Strong'],[4,'#0F6E56','Very strong']];
  const [,clr,lbl]=map[score]||map[0];
  fill.style.width=(score*25)+'%'; fill.style.background=clr; label.textContent=lbl;
};

function renderChangePassword(){
  const loggedIn=!!window._currentUser;
  const ls=document.getElementById('chpw-loggedin-section');
  const lo=document.getElementById('chpw-loggedout-section');
  if(ls) ls.style.display=loggedIn?'block':'none';
  if(lo) lo.style.display=loggedIn?'none':'block';
}

// ── USER MANAGEMENT (admin only) ───────────────────────────────────
window.openCreateUser=function(){
  document.getElementById('create-user-card').style.display='block';
  document.getElementById('cu-error').style.display='none';
};
window.closeCreateUser=function(){
  document.getElementById('create-user-card').style.display='none';
  ['cu-name','cu-username','cu-email','cu-mobile','cu-qual','cu-pw','cu-admin-pw'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
};
window.submitCreateUser=async function(){
  const errEl=document.getElementById('cu-error');
  errEl.style.display='none';
  const name=document.getElementById('cu-name').value.trim();
  const username=document.getElementById('cu-username').value.trim().toLowerCase().replace(/\s+/g,'');
  const email=document.getElementById('cu-email').value.trim();
  const role=document.getElementById('cu-role').value;
  const mobile=document.getElementById('cu-mobile').value.trim();
  const dept=document.getElementById('cu-dept').value;
  const qual=document.getElementById('cu-qual').value.trim();
  const pw=document.getElementById('cu-pw').value;
  if(!name||!username||!pw){ errEl.textContent='Name, username and password are required.'; errEl.style.display='block'; return; }
  if(pw.length<8){ errEl.textContent='Password must be at least 8 characters.'; errEl.style.display='block'; return; }
  if(!window._currentUser){ errEl.textContent='You are not logged in.'; errEl.style.display='block'; return; }
  try{
    await api('POST','/api/accounts',{
      id:'u'+Date.now(), name, role, username, email, mobile, dept, qual,
      pw, createdAt:new Date().toISOString()
    });
    if(role==='doctor'||role==='nurse'||role==='staff'||role==='pharmacist'){
      const staffData={id:'stf'+Date.now(),name,role:role==='pharmacist'?'staff':role,dept,qual,contact:mobile};
      try{
        await api('POST','/api/staff',staffData);
        const idx=window._staff.findIndex(s=>s.id===staffData.id);
        if(idx>-1) window._staff[idx]=staffData; else window._staff.push(staffData);
        renderStaffPage(); refreshDoctorSelect(); refreshNurseSelect();
      }catch(se){ console.warn('Staff sync failed:',se.message); }
    }
    closeCreateUser();
    loadUsers();
    alert('User "'+name+'" created successfully.');
  }catch(e){ errEl.textContent=e.message; errEl.style.display='block'; }
};

async function loadUsers(){
  if(!window._currentUser||window._currentUser.role!=='admin') return;
  const tbody=document.getElementById('users-tbody');
  if(!tbody) return;
  tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--t2)">Loading…</td></tr>';
  // Sync accounts → staff silently on every users page load
  api('POST','/api/admin/sync-staff').then(r=>{
    if(r&&r.synced>0){ renderStaffPage(); refreshDoctorSelect(); refreshNurseSelect(); }
  }).catch(()=>{});
  try{
    const data=await api('GET','/api/accounts');
    if(!data||!data.length){ tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-2)">No users yet.</td></tr>'; return; }
        tbody.innerHTML=data.map(u=>`<tr>
      <td><b>${u.name||'—'}</b></td>
      <td><span class="badge">${u.role||'—'}</span></td>
      <td style="font-family:monospace;font-size:13px">${u.username||'—'}</td>
      <td style="font-size:12px;color:var(--t2)">${u.email||'—'}</td>
      <td>${u.dept||'—'}</td>
      <td style="font-size:12px;color:var(--t2)">${u.qual||'—'}</td>
      <td style="font-size:12px;color:var(--t2)">${u.created_at?new Date(u.created_at).toLocaleDateString('en-IN'):'—'}</td>
    </tr>`).join('');
  }catch(e){ tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:24px;color:#dc2626">'+e.message+'</td></tr>'; }
}

// ── LOGIN / AUTH ────────────────────────────────────────────────────
document.addEventListener('keydown', function(e){
  const loginPage = document.getElementById('page-login');
  if(e.key==='Enter' && loginPage && loginPage.classList.contains('active')) { window.doLogin(); }
});

window.doLogin=async function(){
  const username=document.getElementById('login-email').value.trim();
  const pw=document.getElementById('login-pw').value;
  showAuthMsg('login-error','login-success','','');
  if(!username||!pw){ showAuthMsg('login-error','login-success','Please enter username and password.',true); return; }
  try{
    const res=await api('POST','/api/accounts/login',{username,pw});
    localStorage.setItem('meditrack_token', res.token);
    window._currentUser={...res.user};
    saveStoredUser(window._currentUser);
    updateAuthUI();
    showAuthMsg('login-error','login-success','✓ Welcome back, '+res.user.name.split(' ')[0]+'!',false);
    setTimeout(()=>showPage('dashboard'),900);
  }catch(e){ showAuthMsg('login-error','login-success',e.message,true); }
};

window.doChangePassword=async function(){
  showAuthMsg('chpw-error','chpw-success','','');
  if(!window._currentUser){ showPage('login'); return; }
  const oldPw=document.getElementById('chpw-old').value;
  const newPw=document.getElementById('chpw-new').value;
  const confirm=document.getElementById('chpw-confirm').value;
  if(newPw.length<8){ showAuthMsg('chpw-error','chpw-success','New password must be at least 8 characters.',true); return; }
  if(newPw!==confirm){ showAuthMsg('chpw-error','chpw-success','Passwords do not match.',true); return; }
  try{
    await api('PUT','/api/accounts/'+window._currentUser.id+'/password',{oldPw,newPw});
    showAuthMsg('chpw-error','chpw-success','✓ Password updated successfully!',false);
    ['chpw-old','chpw-new','chpw-confirm'].forEach(id=>{const el=document.getElementById(id);if(el) el.value='';});
  }catch(e){ showAuthMsg('chpw-error','chpw-success',e.message,true); }
};

window.doForgotPassword=function(){
  showAuthMsg('forgot-error','forgot-success','Password reset is not available. Please contact your admin.',true);
};

function resetLoginForm(){
  const emailEl=document.getElementById('login-email');
  const pwEl=document.getElementById('login-pw');
  if(emailEl) emailEl.value='';
  if(pwEl) pwEl.value='';
  showAuthMsg('login-error','login-success','','');
}

window.logoutUser=async function(){
  const u=window._currentUser||{};
  try{
    await fetch('/api/accounts/logout',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ username:u.username||'', role:u.role||'' })
    });
  }catch(_){}
  localStorage.removeItem('meditrack_token');
  window._currentUser=null;
  clearStoredUser();
  updateAuthUI();
  resetLoginForm();
  showPage('login');
};

// ── CONFIRM DELETE MODAL ─────────────────────────────────────────────
let _confirmCb=null, _confirmKeyword=null;
window.confirmDelete=function({title,record,message,icon,btnLabel,requireType,onConfirm}){
  _confirmCb=onConfirm; _confirmKeyword=requireType||null;
  document.getElementById('confirm-icon').textContent    = icon||'🗑️';
  document.getElementById('confirm-title').textContent   = title||'Are you sure?';
  document.getElementById('confirm-record').textContent  = record||'';
  document.getElementById('confirm-message').textContent = message||'This action cannot be undone.';
  document.getElementById('confirm-btn-label').textContent = btnLabel||'Delete';
  const typeWrap=document.getElementById('confirm-type-wrap');
  const typeInput=document.getElementById('confirm-type-input');
  const btn=document.getElementById('confirm-action-btn');
  if(requireType){
    typeWrap.style.display='block'; typeInput.value='';
    document.getElementById('confirm-keyword').textContent=requireType;
    btn.disabled=true; btn.style.opacity='.4'; btn.style.cursor='not-allowed';
  } else {
    typeWrap.style.display='none';
    btn.disabled=false; btn.style.opacity='1'; btn.style.cursor='pointer';
  }
  document.getElementById('confirm-modal').style.display='flex';
  setTimeout(()=>{ if(requireType) typeInput.focus(); },100);
};
window.checkConfirmKeyword=function(){
  const input=document.getElementById('confirm-type-input');
  const btn=document.getElementById('confirm-action-btn');
  const ok=input.value===_confirmKeyword;
  btn.disabled=!ok; btn.style.opacity=ok?'1':'.4'; btn.style.cursor=ok?'pointer':'not-allowed';
  input.style.borderColor=input.value.length>0?(ok?'#22c55e':'#ef4444'):'';
};
window.closeConfirmModal=function(){
  document.getElementById('confirm-modal').style.display='none';
  _confirmCb=null; _confirmKeyword=null;
};
window.executeConfirm=async function(){
  if(!_confirmCb) return;
  const btn=document.getElementById('confirm-action-btn');
  const lbl=document.getElementById('confirm-btn-label');
  btn.disabled=true; const orig=lbl.textContent; lbl.textContent='Working…';
  try{ await _confirmCb(); closeConfirmModal(); }
  catch(e){ lbl.textContent=orig; btn.disabled=false; alert('Failed: '+e.message); }
};
document.addEventListener('keydown',e=>{
  const m=document.getElementById('confirm-modal');
  if(!m||m.style.display==='none') return;
  if(e.key==='Escape') closeConfirmModal();
  if(e.key==='Enter'&&!document.getElementById('confirm-action-btn').disabled) executeConfirm();
});

window.dischargePatient=function(id){
  const p=getPatient(id); if(!p) return;
  confirmDelete({
    icon:'🏥', title:'Discharge patient?', record:p.name,
    message:'Patient will be marked as discharged. All records are preserved.',
    btnLabel:'Discharge',
    onConfirm:async()=>{
      const result=await api('POST','/api/patients/'+id+'/discharge',{});
      const updated={...p,status:'discharged',dischargeDate:result.dischargeDate};
      const idx=window._patients.findIndex(x=>x.id===id);
      if(idx>-1) window._patients[idx]=updated;
      renderPatients(window._patientFilter);
    }
  });
};

// ── DARK MODE ───────────────────────────────────────────────────────
(function(){
  if(localStorage.getItem('meditrack_theme')==='dark')
    document.documentElement.classList.add('dark');
  updateThemeIcon();
})();
window.toggleTheme=function(){
  const dark=document.documentElement.classList.toggle('dark');
  localStorage.setItem('meditrack_theme',dark?'dark':'light');
  updateThemeIcon();
};
function updateThemeIcon(){
  const btn=document.getElementById('theme-toggle'); if(!btn) return;
  const dark=document.documentElement.classList.contains('dark');
  btn.textContent=dark?'☀️':'🌙';
  btn.title=dark?'Switch to light mode':'Switch to dark mode';
}

// ── VITALS LIVE RANGE INDICATORS ────────────────────────────────────
const VITAL_RULES={
  pulse:  {check:v=>{const n=parseFloat(v);if(isNaN(n)||v==='')return null;if(n<40||n>130)return'critical';if(n<50||n>110)return'warn';return'normal';},hint:{normal:'✓ Normal (60–100 bpm)',warn:'⚠ Outside normal range',critical:'✕ Critical'}},
  temp:   {check:v=>{const n=parseFloat(v);if(isNaN(n)||v==='')return null;if(n<95||n>104)return'critical';if(n<96||n>100.4)return'warn';return'normal';},hint:{normal:'✓ Normal (97–99°F)',warn:'⚠ Fever or hypothermia',critical:'✕ Critical temperature'}},
  spo2:   {check:v=>{const n=parseFloat(v);if(isNaN(n)||v==='')return null;if(n<90)return'critical';if(n<94)return'warn';return'normal';},hint:{normal:'✓ Normal (≥ 95%)',warn:'⚠ Low — consider O₂',critical:'✕ Critical hypoxia'}},
  resp:   {check:v=>{const n=parseFloat(v);if(isNaN(n)||v==='')return null;if(n<8||n>30)return'critical';if(n<12||n>24)return'warn';return'normal';},hint:{normal:'✓ Normal (12–20 br/min)',warn:'⚠ Outside normal range',critical:'✕ Critical respiratory rate'}},
  glucose:{check:v=>{const n=parseFloat(v);if(isNaN(n)||v==='')return null;if(n<50||n>400)return'critical';if(n<70||n>180)return'warn';return'normal';},hint:{normal:'✓ Normal (70–140 mg/dL)',warn:'⚠ Hypo/hyperglycaemia',critical:'✕ Critical glucose'}},
  bp:     {check:v=>{if(!v||!v.includes('/'))return null;const[s,d]=v.split('/').map(Number);if(isNaN(s))return null;if(s<80||s>180||d<40||d>120)return'critical';if(s<90||s>140||d<60||d>90)return'warn';return'normal';},hint:{normal:'✓ Normal (90–140 / 60–90)',warn:'⚠ Hypo/hypertensive range',critical:'✕ Critical BP'}},
};
const VI_ICONS={normal:'✓',warn:'⚠',critical:'✕'};
window.checkVital=function(field,value){
  const rule=VITAL_RULES[field]; if(!rule) return;
  const input=document.getElementById('v-'+field);
  const ind  =document.getElementById('vi-'+field);
  const hint =document.getElementById('vh-'+field);
  if(!input) return;
  input.classList.remove('vi-normal','vi-warn','vi-critical');
  const level=rule.check(value);
  if(!level||value===''){
    if(ind) ind.textContent='';
    if(hint){hint.className='vitals-hint';hint.textContent='';}
    return;
  }
  input.classList.add('vi-'+level);
  if(ind) ind.textContent=VI_ICONS[level];
  if(hint){hint.className='vitals-hint hint-'+level;hint.textContent=rule.hint[level];}
};

// ── AUDIT TRAIL ─────────────────────────────────────────────────────
window._auditPage=1; window._auditEntries=[];
const AUDIT_COLORS={LOGIN:'#1a7f5a',LOGIN_FAILED:'#c0392b',LOGOUT:'#5a6560',PATIENT_ADMITTED:'#1565c0',PATIENT_UPDATED:'#0277bd',PATIENT_DISCHARGED:'#558b2f',PATIENT_DELETED:'#c0392b',VITALS_RECORDED:'#6a1b9a',STAFF_ADDED:'#1565c0',STAFF_UPDATED:'#0277bd',STAFF_REMOVED:'#c0392b',WARD_CREATED:'#1565c0',WARD_UPDATED:'#0277bd',WARD_DELETED:'#c0392b',APPOINTMENT_BOOKED:'#1565c0',APPOINTMENT_CANCELLED:'#c0392b',USER_CREATED:'#1a7f5a',PASSWORD_CHANGED:'#e65100'};
function auditBadge(event){const c=AUDIT_COLORS[event]||'#5a6560';return `<span style="background:${c}18;color:${c};border:1px solid ${c}40;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:600;letter-spacing:.04em">${event.replace(/_/g,' ')}</span>`;}
function fmtTs(ts){if(!ts)return'—';const d=new Date(ts);return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}

async function loadAuditStats(){
  try{
    const data=await api('GET','/api/audit/stats');
    if(!data) return;
    const row=document.getElementById('audit-stats-row'); if(!row) return;
    row.innerHTML=[
      {label:'Total Events',val:data.total.toLocaleString(),icon:'📋',color:'var(--p)'},
      {label:'Last 24 Hours',val:data.today.toLocaleString(),icon:'🕐',color:'var(--ok)'},
      {label:'Top Event',val:(data.topEvents[0]?.event||'—').replace(/_/g,' '),icon:'📌',color:'var(--warn)'},
      {label:'Most Active User',val:data.topUsers[0]?.username||'—',icon:'👤',color:'#1565c0'},
    ].map(c=>`<div class="stat-card"><div style="font-size:20px;margin-bottom:6px">${c.icon}</div><div class="stat-val" style="color:${c.color};font-size:22px">${c.val}</div><div class="stat-label">${c.label}</div></div>`).join('');
  }catch(_){}
}

async function loadAudit(page){
  window._auditPage=page||1;
  const params=new URLSearchParams({page:window._auditPage,limit:50});
  const search=document.getElementById('af-search')?.value.trim();
  const event =document.getElementById('af-event')?.value;
  const user  =document.getElementById('af-user')?.value.trim();
  const from  =document.getElementById('af-from')?.value;
  const to    =document.getElementById('af-to')?.value;
  if(search)params.set('search',search);
  if(event) params.set('event',event);
  if(user)  params.set('username',user);
  if(from)  params.set('from',from);
  if(to)    params.set('to',to+'T23:59:59');
  const tbody=document.getElementById('audit-tbody');
  const pgEl =document.getElementById('audit-pagination');
  if(tbody) tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--t3)">Loading…</td></tr>';
  try{
    const data=await api('GET','/api/audit?'+params.toString());
    if(!data) return;
    const {entries,total,pages}=data;
    window._auditEntries=entries;
    if(!entries.length){
      tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--t3)">No records match.</td></tr>';
      if(pgEl) pgEl.innerHTML=''; return;
    }
    tbody.innerHTML=entries.map((e,i)=>`<tr style="border-bottom:1px solid var(--b2);background:${i%2?'var(--surface2)':'transparent'}">
      <td style="padding:9px 14px;white-space:nowrap;font-size:11px;color:var(--t2);font-family:monospace">${fmtTs(e.timestamp)}</td>
      <td style="padding:9px 14px"><div style="font-weight:500">${e.username||'—'}</div><div style="font-size:10px;color:var(--t3)">${e.user_role||''}</div></td>
      <td style="padding:9px 14px">${auditBadge(e.event)}</td>
      <td style="padding:9px 14px;font-size:13px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.record||''}">${e.record||'—'}</td>
      <td style="padding:9px 14px;font-size:11px;color:var(--t2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.old_value||''}">${e.old_value||'—'}</td>
      <td style="padding:9px 14px;font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.new_value||''}">${e.new_value||'—'}</td>
      <td style="padding:9px 14px;font-size:11px;color:var(--t3);font-family:monospace">${e.ip_address||'—'}</td>
    </tr>`).join('');
    if(pgEl){
      const start=(window._auditPage-1)*50+1,end=Math.min(window._auditPage*50,total),cur=window._auditPage;
      let btns='';
      for(let p=Math.max(1,cur-2);p<=Math.min(pages,cur+2);p++)
        btns+=`<button class="btn${p===cur?' primary':''}" style="min-width:32px;padding:4px 8px;font-size:12px" onclick="loadAudit(${p})">${p}</button>`;
      pgEl.innerHTML=`<span style="font-size:12px;color:var(--t3)">Showing ${start}–${end} of ${total.toLocaleString()}</span>
        <div style="display:flex;gap:6px">
          ${cur>1?`<button class="btn" style="padding:4px 10px;font-size:12px" onclick="loadAudit(${cur-1})">← Prev</button>`:''}
          ${btns}
          ${cur<pages?`<button class="btn" style="padding:4px 10px;font-size:12px" onclick="loadAudit(${cur+1})">Next →</button>`:''}
        </div>`;
    }
  }catch(e){
    if(tbody) tbody.innerHTML=`<tr><td colspan="7" style="text-align:center;padding:24px;color:#c0392b">Error: ${e.message}</td></tr>`;
  }
}

let _auditDebounce;
function debounceAudit(){clearTimeout(_auditDebounce);_auditDebounce=setTimeout(()=>loadAudit(1),400);}
function clearAuditFilters(){
  ['af-search','af-event','af-user','af-from','af-to'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  loadAudit(1);
}
function exportAuditCSV(){
  const entries=window._auditEntries||[];
  if(!entries.length){alert('Load the audit page first.');return;}
  const header=['Timestamp','User','Role','Event','Record','Before','After','IP'];
  const rows=entries.map(e=>[fmtTs(e.timestamp),e.username||'',e.user_role||'',e.event||'',e.record||'',e.old_value||'',e.new_value||'',e.ip_address||''].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(','));
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([[header.join(','),...rows].join('\n')],{type:'text/csv'}));
  a.download='meditrack-audit-'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
}

// ── BOOT ───────────────────────────────────────────────────────────
window._currentUser=loadStoredUser();
updateAuthUI();

setTimeout(function(){
  if(!localStorage.getItem('meditrack_token')){
    showPage('login');
  } else {
    loadAll();
  }
}, 0);