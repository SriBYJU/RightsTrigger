import { getProfile, saveProfile, getPurchases, getPurchase, savePurchase, deletePurchase, clearAllData } from './db.js';
import { analyzeFiles } from './extractor.js';
import { analyzeRights, buildProofPackage } from './rights-engine.js';
import { exportBackup, parseBackup } from './backup.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const view = $('#view');
let profile = null;
let purchases = [];
let pendingFiles = [];
let pendingAnalysis = null;

const fmtMoney = (n,currency='USD') => Number.isFinite(Number(n)) ? new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:0}).format(Number(n)) : '—';
const countryCurrency = c => ({US:'USD',CA:'CAD',GB:'GBP',AU:'AUD',IN:'INR'}[c] || 'USD');
const fmtDate = d => d ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(new Date(`${d}T12:00:00`)) : 'Not verified';
const esc = s => String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uid = () => globalThis.crypto?.randomUUID?.() || `rt-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function toast(message,kind='') {
  const el=document.createElement('div');el.className=`toast ${kind}`;el.textContent=message;$('#toast-region').appendChild(el);setTimeout(()=>el.remove(),3300);
}

function currentRoute() {
  const raw=location.hash.replace(/^#/,'') || 'home';
  const [route,id]=raw.split('/');
  return {route,id};
}

function setActiveNav(route) {
  $$('[data-route]').forEach(a=>a.classList.toggle('active',a.dataset.route===route));
}

function enrich(p) { return {...p,analysis:analyzeRights(p)}; }
function allEnriched() { return purchases.map(enrich); }
function allActions() { return allEnriched().flatMap(p=>p.analysis.actions.map(a=>({...a,purchase:p}))); }

function updateBadge() {
  const count=allActions().filter(a=>a.severity==='urgent'||a.severity==='warn').length;
  const badge=$('#action-badge');badge.textContent=count;badge.classList.toggle('hidden',count===0);
}

function purchaseStatus(p) {
  const rights=p.analysis.rights;
  if (rights.some(r=>r.status==='urgent')) return ['urgent','Needs attention'];
  if (rights.some(r=>r.status==='warn')) return ['warn','Upcoming'];
  if (rights.some(r=>r.status==='good')) return ['good','Protected'];
  return ['','Needs evidence'];
}

function purchaseRow(p) {
  const [cls,label]=purchaseStatus(p);
  return `<a class="purchase-row" href="#purchase/${esc(p.id)}">
    <div class="purchase-avatar">${esc((p.product||'?').slice(0,1).toUpperCase())}</div>
    <div><div class="purchase-title">${esc(p.product)}</div><div class="purchase-meta">${esc(p.retailer)} · ${esc(fmtDate(p.purchaseDate))}</div></div>
    <div class="purchase-amount">${esc(fmtMoney(p.amount,p.currency||'USD'))}</div>
    <div class="status-pill ${cls}">${label}</div>
  </a>`;
}

function emptyState(title,copy,button='Add your first purchase') {
  return `<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(copy)}</p><button class="primary-button" data-open-add>${esc(button)}</button></div>`;
}

function renderHome() {
  const rows=allEnriched();
  const actions=allActions().filter(a=>a.severity==='urgent'||a.severity==='warn');
  const protectedRows=rows.filter(p=>p.analysis.rights.some(r=>['good','warn','urgent'].includes(r.status)));
  const currencies=[...new Set(protectedRows.map(p=>p.currency||'USD'))];
  const protectedValue=protectedRows.reduce((s,p)=>s+(Number(p.amount)||0),0);
  const protectedValueLabel=currencies.length>1?'Mixed':fmtMoney(protectedValue,currencies[0]||countryCurrency(profile?.country));
  const activeWarranties=rows.filter(p=>p.analysis.rights.find(r=>r.id==='warranty'&&['good','warn','urgent'].includes(r.status))).length;
  const openReturns=rows.filter(p=>p.analysis.rights.find(r=>r.id==='return'&&['good','warn','urgent'].includes(r.status))).length;
  const greeting=profile?.name ? `Good to see you, ${esc(profile.name)}.` : 'Your purchases. Under control.';
  view.innerHTML=`
    <section class="hero">
      <p class="eyebrow" style="color:#aeb8b2">RIGHTSTRIGGER</p>
      <h1>${greeting}</h1>
      <p>${purchases.length ? `${actions.length ? `${actions.length} time-sensitive item${actions.length===1?'':'s'} worth reviewing.` : 'Nothing urgent right now.'} Your evidence and protection dates stay organized here.` : 'Add a receipt or order confirmation. RightsTrigger will organize the purchase, track verified protection dates, and keep the evidence ready.'}</p>
      <button class="primary-button" data-open-add>+ Add purchase</button>
      <div class="hero-stats">
        <div class="hero-stat"><strong>${protectedValueLabel}</strong><span>value with tracked protection</span></div>
        <div class="hero-stat"><strong>${activeWarranties}</strong><span>active warranties</span></div>
        <div class="hero-stat"><strong>${openReturns}</strong><span>open return windows</span></div>
        <div class="hero-stat"><strong>${purchases.length}</strong><span>purchases tracked</span></div>
      </div>
    </section>
    <div class="grid-3">
      <div class="metric-card"><div class="metric-label">NEEDS ATTENTION</div><div class="metric-value">${actions.length}</div><p class="muted">Verified deadlines approaching.</p></div>
      <div class="metric-card"><div class="metric-label">EVIDENCE HEALTH</div><div class="metric-value">${purchases.length ? Math.round(rows.reduce((s,p)=>s+(p.analysis.evidence.filter(e=>e.present).length/p.analysis.evidence.length),0)/purchases.length*100) : 0}%</div><p class="muted">Average core evidence completeness.</p></div>
      <div class="metric-card"><div class="metric-label">DATA MODE</div><div class="metric-value" style="font-size:24px">Local</div><p class="muted">Stored in this browser by default.</p></div>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Needs attention</h2><a class="text-button" href="#actions">View all</a></div>
      ${actions.length ? `<div class="action-list">${actions.slice(0,3).map(actionCard).join('')}</div>` : `<div class="empty-state"><h3>Nothing urgent.</h3><p>RightsTrigger will surface verified deadlines here when they get close.</p></div>`}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Recent purchases</h2><a class="text-button" href="#purchases">View all</a></div>
      ${rows.length ? `<div class="purchase-list">${rows.slice(0,5).map(purchaseRow).join('')}</div>` : emptyState('No purchases yet','Upload a receipt, order confirmation, or add one manually.')}
    </section>`;
}

function renderPurchases() {
  const rows=allEnriched();
  view.innerHTML=`<div class="view-head"><div><p class="eyebrow">YOUR LIBRARY</p><h1>Purchases</h1><p>Every tracked purchase and the evidence attached to it.</p></div><button class="primary-button" data-open-add>+ Add purchase</button></div>
  ${rows.length ? `<div class="search-row"><input id="purchase-search" type="search" placeholder="Search product or retailer…" /></div><div class="purchase-list" id="purchase-results">${rows.map(purchaseRow).join('')}</div>` : emptyState('Your purchase library is empty','Add your first receipt or order confirmation and RightsTrigger will build the record.')}`;
  $('#purchase-search')?.addEventListener('input',e=>{
    const q=e.target.value.toLowerCase().trim();
    const filtered=rows.filter(p=>`${p.product} ${p.retailer} ${p.orderNumber||''}`.toLowerCase().includes(q));
    $('#purchase-results').innerHTML=filtered.length?filtered.map(purchaseRow).join(''):`<div class="empty-state"><h3>No matches</h3><p>Try a different product, retailer, or order number.</p></div>`;
  });
}

function actionCard(a) {
  return `<a class="action-card" href="#purchase/${esc(a.purchaseId)}"><span class="action-dot ${a.severity==='urgent'?'urgent':''}"></span><div class="action-copy"><strong>${esc(a.title)}</strong><p>${esc(a.detail)}</p></div><span>→</span></a>`;
}

function renderActions() {
  const actions=allActions().sort((a,b)=>({urgent:0,warn:1,info:2}[a.severity]-({urgent:0,warn:1,info:2}[b.severity])));
  view.innerHTML=`<div class="view-head"><div><p class="eyebrow">ACTION CENTER</p><h1>What matters now</h1><p>Only deadlines and missing evidence that can be tied to your saved purchase data.</p></div></div>
  ${actions.length ? `<div class="action-list">${actions.map(actionCard).join('')}</div>` : `<div class="panel">${emptyState('Nothing to chase','Add protection evidence to purchases and important actions will appear here.')}</div>`}`;
}

function renderPurchase(id) {
  const p=allEnriched().find(x=>x.id===id);
  if(!p){view.innerHTML=emptyState('Purchase not found','It may have been removed.','Add purchase');return;}
  const rights=p.analysis.rights;
  view.innerHTML=`<div class="view-head"><div><a href="#purchases" class="muted">← Purchases</a><p class="eyebrow" style="margin-top:14px">PURCHASE RECORD</p><h1>${esc(p.product)}</h1><p>${esc(p.retailer)} · ${esc(fmtDate(p.purchaseDate))}</p></div><div><button class="secondary-button" id="proof-button">Build proof package</button></div></div>
  <section class="purchase-card">
    <div class="panel-head"><div><p class="eyebrow">PURCHASE</p><h2>${esc(p.product)}</h2></div><strong>${esc(fmtMoney(p.amount,p.currency||'USD'))}</strong></div>
    <div class="detail-grid">
      <div class="detail-item"><small>Retailer</small><strong>${esc(p.retailer)}</strong></div>
      <div class="detail-item"><small>Purchase date</small><strong>${esc(fmtDate(p.purchaseDate))}</strong></div>
      <div class="detail-item"><small>Order / receipt #</small><strong>${esc(p.orderNumber||'Not saved')}</strong></div>
      <div class="detail-item"><small>Model / serial</small><strong>${esc(p.modelNumber||'Not saved')}</strong></div>
    </div>
  </section>
  <section class="panel"><div class="panel-head"><h2>Protection</h2><span class="status-pill">Evidence-backed</span></div>
    ${rights.map(r=>`<div class="protection-card"><div class="protection-top"><div><p class="eyebrow">${esc(r.type)}</p><h3>${esc(r.headline)}</h3></div><span class="status-pill ${r.status==='urgent'?'urgent':r.status==='warn'?'warn':r.status==='good'?'good':''}">${r.status==='unknown'?'Not verified':r.certainty==='high'?'Verified date':'Derived'}</span></div><p>${esc(r.explanation)}</p>${r.sources.length?`<button class="evidence-link" data-evidence="${esc(r.id)}">Why this result?</button>`:''}</div>`).join('')}
  </section>
  <section class="panel"><div class="panel-head"><h2>Evidence</h2><button class="text-button" id="proof-button-2">Open ProofAgent</button></div>
    <div class="proof-checklist">${p.analysis.evidence.map(e=>`<div class="proof-item"><b>${e.present?'✓':'○'}</b><div><strong>${esc(e.label)}</strong><span>${esc(e.detail)}</span></div></div>`).join('')}</div>
  </section>
  <section class="panel"><div class="panel-head"><div><h2>Ask RightsTrigger</h2><p class="muted" style="font-size:12px;margin:5px 0 0">Focused answers from this purchase record — not a generic chatbot.</p></div></div><div class="search-row" style="margin-bottom:10px"><input id="ask-input" placeholder="Can I still return this?" /><button class="primary-button" id="ask-button">Ask</button></div><div id="ask-answer" class="evidence-source hidden"></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="ghost-button" data-ask="Can I still return this?">Return?</button><button class="ghost-button" data-ask="Is the warranty active?">Warranty?</button><button class="ghost-button" data-ask="What evidence am I missing?">Missing evidence?</button><button class="ghost-button" data-ask="It broke. What should I do?">It broke</button></div></section>
  ${p.attachments?.length?`<section class="panel"><div class="panel-head"><h2>Source documents</h2><span class="muted">Stored locally</span></div>${p.attachments.map(a=>`<div class="file-chip"><span>${esc(a.name)}</span><span>${a.error?'Could not read':'Saved'}</span></div>`).join('')}</section>`:''}
  <section class="panel"><div class="panel-head"><h2>Manage</h2></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="secondary-button" id="edit-purchase">Edit details</button><button class="danger-button" id="delete-purchase">Delete purchase</button></div></section>`;

  $$('[data-evidence]').forEach(btn=>btn.addEventListener('click',()=>showEvidence(p,btn.dataset.evidence)));
  $('#proof-button')?.addEventListener('click',()=>showProof(p));
  $('#proof-button-2')?.addEventListener('click',()=>showProof(p));
  $('#ask-button')?.addEventListener('click',()=>answerPurchaseQuestion(p,$('#ask-input').value));
  $('#ask-input')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();answerPurchaseQuestion(p,e.target.value);}});
  $$('[data-ask]').forEach(b=>b.addEventListener('click',()=>{$('#ask-input').value=b.dataset.ask;answerPurchaseQuestion(p,b.dataset.ask);}));
  $('#delete-purchase')?.addEventListener('click',async()=>{if(confirm(`Delete ${p.product}? This removes its local record and attached documents.`)){await deletePurchase(p.id);await refreshData();location.hash='#purchases';toast('Purchase deleted.');}});
  $('#edit-purchase')?.addEventListener('click',()=>openEditPurchase(p));
}

function answerPurchaseQuestion(p,question='') {
  const q=question.toLowerCase().trim();if(!q)return;
  const ret=p.analysis.rights.find(r=>r.id==='return');const war=p.analysis.rights.find(r=>r.id==='warranty');const missing=p.analysis.evidence.filter(e=>!e.present);
  let answer='I can answer questions about the return window, warranty, and evidence saved for this purchase.';
  if(/return|refund/.test(q)) answer=ret.status==='unknown' ? 'I can’t verify a return window from the evidence saved yet. Add the official retailer policy or a receipt showing a return-by date, and I’ll track it.' : `${ret.headline}. ${ret.explanation}`;
  else if(/warrant|coverage|covered/.test(q)) answer=war.status==='unknown' ? 'I can’t verify warranty coverage from the saved evidence yet. Add warranty documentation or a known warranty end date.' : `${war.headline}. ${war.explanation}`;
  else if(/missing|evidence|need|proof/.test(q)) answer=missing.length ? `You’re still missing: ${missing.map(m=>m.label).join(', ')}.` : 'Your core evidence set is complete.';
  else if(/broke|broken|stopped|damage|claim/.test(q)) answer=war.status==='unknown' ? `Start by adding the warranty terms. I already have ${p.orderNumber?'your order number':'the purchase record'}, but I can’t tell whether warranty coverage applies without the warranty evidence.` : `${war.headline}. ${missing.length?`Before preparing a stronger proof package, add: ${missing.map(m=>m.label).join(', ')}.`:'Your core proof package is complete; review the official warranty process before submitting a claim.'}`;
  const box=$('#ask-answer');box.classList.remove('hidden');box.innerHTML=`<small>RIGHTSTRIGGER</small><p>${esc(answer)}</p>`;
}

function showEvidence(p,rightId) {
  const r=p.analysis.rights.find(x=>x.id===rightId);if(!r)return;
  const body=$('#evidence-content');
  body.innerHTML=`<div class="modal-head"><div><p class="eyebrow">WHY THIS RESULT?</p><h2>${esc(r.type)}</h2></div><button class="icon-button" data-close-evidence>×</button></div><p class="lede" style="font-size:15px">${esc(r.explanation)}</p>${r.sources.map(s=>`<div class="evidence-source"><small>${esc(s.label)}</small><p>${esc((s.text||'Saved date/metadata').slice(0,1400))}</p></div>`).join('')}<p class="muted" style="font-size:11px;margin-top:18px">RightsTrigger organizes supplied evidence and dates; it does not guarantee legal eligibility or outcomes.</p>`;
  $('#evidence-dialog').showModal();
  $('[data-close-evidence]')?.addEventListener('click',()=>$('#evidence-dialog').close());
}

function showProof(p) {
  const pack=buildProofPackage(p,p.analysis);
  const body=$('#proof-content');
  body.innerHTML=`<div class="modal-head"><div><p class="eyebrow">PROOFAGENT</p><h2>${esc(pack.title)}</h2></div><button class="icon-button" data-close-proof>×</button></div><p class="lede" style="font-size:15px">Evidence readiness: <strong>${pack.score}%</strong>. ${esc(pack.summary)}</p><div class="proof-checklist">${pack.items.map(i=>`<div class="proof-item"><b>${i.present?'✓':'○'}</b><div><strong>${esc(i.label)}</strong><span>${esc(i.detail)}</span></div></div>`).join('')}</div>${pack.protections.length?`<div class="evidence-source"><small>TRACKED PROTECTIONS</small><p>${pack.protections.map(r=>`${r.type}: ${r.headline}`).join('\n')}</p></div>`:''}<div class="modal-actions"><button class="secondary-button" data-close-proof>Close</button><button class="primary-button" id="download-proof">Export summary</button></div>`;
  $('#proof-dialog').showModal();
  $$('[data-close-proof]').forEach(b=>b.addEventListener('click',()=>$('#proof-dialog').close()));
  $('#download-proof')?.addEventListener('click',()=>downloadProof(p,pack));
}

function downloadProof(p,pack) {
  const text=[`RIGHTSTRIGGER — PROOFAGENT`,``,`${p.product} — ${p.retailer}`,`Purchase date: ${p.purchaseDate}`,`Amount: ${fmtMoney(p.amount,p.currency||'USD')}`,`Evidence readiness: ${pack.score}%`,``,...pack.items.map(i=>`${i.present?'[FOUND]':'[MISSING]'} ${i.label}: ${i.detail}`),``,...pack.protections.map(r=>`${r.type}: ${r.headline}`),``,`Generated from user-supplied purchase information. Review against official policies before relying on it.`].join('\n');
  const blob=new Blob([text],{type:'text/plain'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${p.product.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-proof-summary.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function renderProfile() {
  const name=profile?.name||'Local user';
  const initials=(name==='Local user'?'RT':name.split(/\s+/).map(x=>x[0]).join('').slice(0,2)).toUpperCase();
  view.innerHTML=`<div class="view-head"><div><p class="eyebrow">PROFILE & PRIVACY</p><h1>Profile</h1><p>Minimal information. Local by default.</p></div></div>
  <section class="panel profile-card"><div class="profile-summary"><div class="profile-avatar">${esc(initials)}</div><div><h2 style="margin:0">${esc(name)}</h2><p class="muted" style="margin:5px 0 0">${esc(profile?.region||'')}${profile?.region?' · ':''}${esc(profile?.country||'US')} · ${purchases.length} purchases</p></div></div>
  <div class="form-grid"><label>First name <input id="profile-name" value="${esc(profile?.name||'')}" /></label><label>Country <select id="profile-country"><option value="US" ${profile?.country==='US'?'selected':''}>United States</option><option value="CA" ${profile?.country==='CA'?'selected':''}>Canada</option><option value="GB" ${profile?.country==='GB'?'selected':''}>United Kingdom</option><option value="AU" ${profile?.country==='AU'?'selected':''}>Australia</option><option value="IN" ${profile?.country==='IN'?'selected':''}>India</option><option value="OTHER" ${profile?.country==='OTHER'?'selected':''}>Other</option></select></label><label>State / region <input id="profile-region" value="${esc(profile?.region||'')}" /></label></div><button class="primary-button" id="save-profile">Save profile</button>
  <div class="settings-section"><h3>Data & privacy</h3>
    <div class="settings-row"><div class="copy"><strong>Local mode</strong><span>Your profile, purchase records, and uploaded source documents are stored in this browser by default. No cloud account is required.</span></div><span class="status-pill good">On</span></div>
    <div class="settings-row"><div class="copy"><strong>Export backup</strong><span>Download a portable backup containing your profile, purchase records, and locally saved source files.</span></div><button class="secondary-button" id="export-backup">Export</button></div>
    <div class="settings-row"><div class="copy"><strong>Restore backup</strong><span>Restore a RightsTrigger backup on this device. Existing records with the same ID will be replaced.</span></div><button class="secondary-button" id="restore-backup">Restore</button><input type="file" id="restore-input" accept="application/json" hidden /></div>
    <div class="settings-row"><div class="copy"><strong>Delete local data</strong><span>Remove the profile, purchase records, and source documents saved by RightsTrigger in this browser.</span></div><button class="danger-button" id="clear-data">Delete</button></div>
  </div>
  <div class="settings-section"><h3>About the intelligence</h3><p class="muted" style="font-size:13px;line-height:1.65">RightsTrigger uses local document extraction, OCR for images, deterministic date/protection logic, and evidence checks. It intentionally does not invent current retailer policies. For unverified rules, add the official policy or warranty text. This is consumer organization software, not legal advice.</p></div></section>`;
  $('#save-profile').addEventListener('click',async()=>{profile=await saveProfile({...profile,name:$('#profile-name').value.trim(),country:$('#profile-country').value,region:$('#profile-region').value.trim()});toast('Profile saved.');renderProfile();});
  $('#export-backup').addEventListener('click',async()=>{await exportBackup(profile,purchases);toast('Backup exported.');});
  $('#restore-backup').addEventListener('click',()=>$('#restore-input').click());
  $('#restore-input').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const data=await parseBackup(f);if(data.profile)profile=await saveProfile(data.profile);for(const p of data.purchases)await savePurchase(p);await refreshData();toast('Backup restored.');renderProfile();}catch(err){toast(err.message,'warn');}});
  $('#clear-data').addEventListener('click',async()=>{if(confirm('Delete all RightsTrigger data stored in this browser? This cannot be undone unless you exported a backup.')){await clearAllData();profile=null;purchases=[];location.hash='#home';showOnboarding();toast('Local data deleted.');}});
}

async function render() {
  const {route,id}=currentRoute();
  setActiveNav(route==='purchase'?'purchases':route);
  if(route==='home')renderHome();else if(route==='purchases')renderPurchases();else if(route==='actions')renderActions();else if(route==='profile')renderProfile();else if(route==='purchase')renderPurchase(id);else{location.hash='#home';return;}
  bindOpenAdd();updateBadge();view.focus({preventScroll:true});
}

function showOnboarding() {
  $('#onboarding').classList.remove('hidden');$('#onboarding').setAttribute('aria-hidden','false');
}
function hideOnboarding(){ $('#onboarding').classList.add('hidden');$('#onboarding').setAttribute('aria-hidden','true'); }
function onboardingStep(n){$$('.onboarding-step').forEach(s=>s.classList.toggle('active',s.dataset.step===String(n)));}

function bindOpenAdd() { $$('[data-open-add]').forEach(b=>b.onclick=openAddDialog); }
function resetAddForm(){pendingFiles=[];pendingAnalysis=null;$('#add-form').reset();$('#currency').value=countryCurrency(profile?.country);$('#file-list').innerHTML='';$('#analysis-progress').classList.add('hidden');$('#confidence-panel').classList.add('hidden');$('#save-purchase').textContent='Save & analyze';$('#save-purchase').dataset.editId='';}
function openAddDialog(){resetAddForm();$('#add-dialog').showModal();}

function openEditPurchase(p){
  resetAddForm();
  $('#product').value=p.product||'';$('#retailer').value=p.retailer||'';$('#purchase-date').value=p.purchaseDate||'';$('#amount').value=p.amount??'';$('#currency').value=p.currency||countryCurrency(profile?.country);$('#order-number').value=p.orderNumber||'';$('#model-number').value=p.modelNumber||'';$('#return-deadline').value=p.returnDeadline||'';$('#warranty-end').value=p.warrantyEnd||'';$('#policy-text').value=p.policyText||'';$('#save-purchase').textContent='Save changes';$('#save-purchase').dataset.editId=p.id;pendingFiles=[];pendingAnalysis={documents:p.attachments||[],combinedText:p.sourceText||'',extracted:{}};$('#add-dialog').showModal();
}

function renderFileList(){ $('#file-list').innerHTML=pendingFiles.map((f,i)=>`<div class="file-chip"><span>${esc(f.name)} · ${(f.size/1024).toFixed(0)} KB</span><button type="button" data-remove-file="${i}">Remove</button></div>`).join('');$$('[data-remove-file]').forEach(b=>b.addEventListener('click',()=>{pendingFiles.splice(Number(b.dataset.removeFile),1);renderFileList();})); }

async function processPendingFiles(){
  if(!pendingFiles.length)return;
  $('#analysis-progress').classList.remove('hidden');$('#analysis-title').textContent='Reading documents…';
  pendingAnalysis=await analyzeFiles(pendingFiles,msg=>{$('#analysis-detail').textContent=msg});
  const x=pendingAnalysis.extracted;
  if(x.product&&!$('#product').value)$('#product').value=x.product;
  if(x.retailer&&!$('#retailer').value)$('#retailer').value=x.retailer;
  if(x.purchaseDate&&!$('#purchase-date').value)$('#purchase-date').value=x.purchaseDate;
  if(x.amount&&!$('#amount').value)$('#amount').value=x.amount;
  if(x.orderNumber&&!$('#order-number').value)$('#order-number').value=x.orderNumber;
  if(x.returnDeadline&&!$('#return-deadline').value)$('#return-deadline').value=x.returnDeadline;
  if(x.warrantyEnd&&!$('#warranty-end').value)$('#warranty-end').value=x.warrantyEnd;
  if(x.rawText&&!$('#policy-text').value && /(return|warranty)/i.test(x.rawText)) $('#policy-text').value=x.rawText.slice(0,6000);
  if(x.returnDays && !$('#return-deadline').value) $('#policy-text').value = ($('#policy-text').value || x.rawText).slice(0,6000);
  const conf=x.confidence||0;$('#confidence-panel').classList.remove('hidden');$('#confidence-dot').style.background=conf>=.8?'var(--success)':conf>=.5?'var(--warn)':'var(--danger)';$('#confidence-label').textContent=conf>=.8?'Strong extraction':conf>=.5?'Please verify the extracted fields':'Manual review recommended';$('#confidence-copy').textContent=`RightsTrigger extracted ${Math.round(conf*100)}% of the core purchase fields. Confirm them before saving.`;
  $('#analysis-progress').classList.add('hidden');
  const failures=pendingAnalysis.documents.filter(d=>d.error);if(failures.length)toast(`${failures.length} file${failures.length===1?'':'s'} could not be read automatically; manual entry still works.`,'warn');
}

async function saveFormPurchase(e){
  e.preventDefault();
  const button=$('#save-purchase');button.disabled=true;button.textContent='Saving…';
  try {
    if(pendingFiles.length && !pendingAnalysis) await processPendingFiles();
    const editId=button.dataset.editId;
    const existing=editId?await getPurchase(editId):null;
    const x=pendingAnalysis?.extracted||{};
    const purchase={
      ...(existing||{}),id:editId||uid(),product:$('#product').value.trim(),retailer:$('#retailer').value.trim(),purchaseDate:$('#purchase-date').value,amount:$('#amount').value?Number($('#amount').value):null,currency:$('#currency').value,orderNumber:$('#order-number').value.trim(),modelNumber:$('#model-number').value.trim(),returnDeadline:$('#return-deadline').value,warrantyEnd:$('#warranty-end').value,policyText:$('#policy-text').value.trim(),returnDays:x.returnDays||existing?.returnDays||null,warrantyYears:x.warrantyYears||existing?.warrantyYears||null,sourceText:pendingAnalysis?.combinedText||existing?.sourceText||'',attachments:pendingAnalysis?.documents||existing?.attachments||[],createdAt:existing?.createdAt||new Date().toISOString()
    };
    if(!purchase.product||!purchase.retailer||!purchase.purchaseDate) throw new Error('Product, retailer, and purchase date are required.');
    await savePurchase(purchase);await refreshData();$('#add-dialog').close();location.hash=`#purchase/${purchase.id}`;toast(editId?'Purchase updated.':'Purchase protected.');
  } catch(err){toast(err.message,'warn');}
  finally{button.disabled=false;button.textContent=button.dataset.editId?'Save changes':'Save & analyze';}
}

async function refreshData(){profile=await getProfile();purchases=await getPurchases();updateBadge();}

function initUpload(){
  const zone=$('#upload-zone'),input=$('#file-input');
  $('#browse-button').addEventListener('click',e=>{e.stopPropagation();input.click();});
  zone.addEventListener('click',e=>{if(e.target.id!=='browse-button')input.click();});zone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}});
  input.addEventListener('change',async e=>{pendingFiles=[...e.target.files];renderFileList();await processPendingFiles();});
  ['dragenter','dragover'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.add('dragging');}));['dragleave','drop'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.remove('dragging');}));zone.addEventListener('drop',async e=>{pendingFiles=[...e.dataTransfer.files];renderFileList();await processPendingFiles();});
}

async function init(){
  await refreshData();
  $$('.onboarding-step [data-next]').forEach(b=>b.addEventListener('click',()=>onboardingStep(b.dataset.next)));
  $('#finish-onboarding').addEventListener('click',async()=>{profile=await saveProfile({name:$('#setup-name').value.trim(),country:$('#setup-country').value,region:$('#setup-region').value.trim(),createdAt:new Date().toISOString()});localStorage.setItem('rt-onboarded','1');hideOnboarding();render();});
  $('#onboarding-close').addEventListener('click',()=>{localStorage.setItem('rt-onboarded','1');hideOnboarding();});
  if(!localStorage.getItem('rt-onboarded')&&!profile)showOnboarding();
  initUpload();$$('[data-close-add]').forEach(b=>b.addEventListener('click',()=>$('#add-dialog').close()));$('#add-form').addEventListener('submit',saveFormPurchase);
  $('#privacy-status').addEventListener('click',()=>{location.hash='#profile';});
  window.addEventListener('hashchange',render);render();
  if('serviceWorker'in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
}

init();