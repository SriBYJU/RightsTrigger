const DAY = 86400000;

export function addDays(dateStr, days) {
  if (!dateStr || !Number.isFinite(Number(days))) return '';
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0,10);
}

export function addYears(dateStr, years) {
  if (!dateStr || !Number.isFinite(Number(years))) return '';
  const d = new Date(`${dateStr}T12:00:00`);
  d.setFullYear(d.getFullYear() + Number(years));
  return d.toISOString().slice(0,10);
}

export function daysUntil(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T23:59:59`);
  return Math.ceil((target - now) / DAY);
}

function source(type, label, text='') { return { type, label, text }; }

export function analyzeRights(purchase, now = new Date()) {
  const rights=[];
  let returnDeadline = purchase.returnDeadline || '';
  let warrantyEnd = purchase.warrantyEnd || '';

  if (!returnDeadline && purchase.returnDays && purchase.purchaseDate) returnDeadline = addDays(purchase.purchaseDate, purchase.returnDays);
  if (!warrantyEnd && purchase.warrantyYears && purchase.purchaseDate) warrantyEnd = addYears(purchase.purchaseDate, purchase.warrantyYears);

  if (returnDeadline) {
    const days = daysUntil(returnDeadline, now);
    rights.push({
      id:'return', type:'Return window', date:returnDeadline, days,
      status: days < 0 ? 'expired' : days <= 2 ? 'urgent' : days <= 7 ? 'warn' : 'good',
      headline: days < 0 ? 'Return window appears closed' : days === 0 ? 'Possible return deadline today' : `${days} day${days===1?'':'s'} remaining`,
      explanation: purchase.returnDeadline ? 'Based on a return deadline found or entered for this purchase.' : `Calculated from a ${purchase.returnDays}-day return period found in the supplied evidence.`,
      sources:[source('evidence',purchase.returnDeadline?'Return deadline':'Policy text', purchase.returnDeadline || purchase.policyText || purchase.sourceText || '')],
      certainty: purchase.returnDeadline ? 'high' : 'medium'
    });
  } else {
    rights.push({
      id:'return', type:'Return window', status:'unknown', headline:'Return policy not verified',
      explanation:'Add a retailer policy, receipt with a “return by” date, or a known deadline. RightsTrigger will not guess a retailer policy.',
      sources:[], certainty:'unknown'
    });
  }

  if (warrantyEnd) {
    const days = daysUntil(warrantyEnd, now);
    rights.push({
      id:'warranty', type:'Warranty', date:warrantyEnd, days,
      status: days < 0 ? 'expired' : days <= 14 ? 'urgent' : days <= 45 ? 'warn' : 'good',
      headline: days < 0 ? 'Warranty appears expired' : `${Math.max(days,0)} day${days===1?'':'s'} of potential coverage remaining`,
      explanation: purchase.warrantyEnd ? 'Based on the warranty end date found or entered for this purchase.' : `Calculated from a ${purchase.warrantyYears}-year warranty period found in the supplied evidence.`,
      sources:[source('evidence',purchase.warrantyEnd?'Warranty end date':'Warranty text', purchase.warrantyEnd || purchase.policyText || purchase.sourceText || '')],
      certainty: purchase.warrantyEnd ? 'high' : 'medium'
    });
  } else {
    rights.push({
      id:'warranty', type:'Warranty', status:'unknown', headline:'Warranty not verified',
      explanation:'Add warranty documentation or a known warranty end date to track coverage.',
      sources:[], certainty:'unknown'
    });
  }

  const evidence = [
    {key:'receipt',label:'Purchase record',present:Boolean(purchase.purchaseDate && purchase.retailer),detail:purchase.purchaseDate ? `${purchase.retailer || 'Retailer'} · ${purchase.purchaseDate}` : 'Purchase date missing'},
    {key:'order',label:'Order / receipt number',present:Boolean(purchase.orderNumber),detail:purchase.orderNumber || 'Not saved'},
    {key:'model',label:'Model / serial',present:Boolean(purchase.modelNumber),detail:purchase.modelNumber || 'Not saved'},
    {key:'policy',label:'Protection evidence',present:Boolean(purchase.policyText || purchase.returnDeadline || purchase.warrantyEnd || purchase.returnDays || purchase.warrantyYears),detail:(purchase.policyText?'Policy/warranty text saved':'Protection dates saved')}
  ];

  const actions=[];
  for (const r of rights) {
    if (r.status === 'urgent') actions.push({id:`${purchase.id}-${r.id}`,purchaseId:purchase.id,severity:'urgent',title:r.headline,detail:`${purchase.product} · ${r.type}`,kind:r.id});
    else if (r.status === 'warn') actions.push({id:`${purchase.id}-${r.id}`,purchaseId:purchase.id,severity:'warn',title:r.headline,detail:`${purchase.product} · ${r.type}`,kind:r.id});
  }
  const missing = evidence.filter(e=>!e.present);
  if (missing.length) actions.push({id:`${purchase.id}-evidence`,purchaseId:purchase.id,severity:'info',title:`${missing.length} evidence item${missing.length===1?'':'s'} missing`,detail:`${purchase.product} · ${missing.map(m=>m.label).join(', ')}`,kind:'evidence'});

  return { rights, evidence, actions, returnDeadline, warrantyEnd };
}

export function buildProofPackage(purchase, analysis) {
  const items = analysis.evidence.map(e => ({...e}));
  const score = Math.round((items.filter(i=>i.present).length/items.length)*100);
  const activeProtection = analysis.rights.filter(r=>['good','warn','urgent'].includes(r.status));
  return {
    title:`${purchase.product} evidence package`,
    score,
    items,
    protections: activeProtection,
    summary: score === 100 ? 'Core evidence set is complete.' : `${items.filter(i=>!i.present).length} core evidence item${items.filter(i=>!i.present).length===1?'':'s'} still missing.`
  };
}