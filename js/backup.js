function blobToDataURL(blob) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataURL) {
  const [meta,data] = dataURL.split(',');
  const mime = (meta.match(/data:([^;]+)/)||[])[1] || 'application/octet-stream';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:mime});
}

export async function exportBackup(profile,purchases) {
  const safe=[];
  for (const p of purchases) {
    const attachments=[];
    for (const a of (p.attachments||[])) {
      let data='';
      try { if (a.blob instanceof Blob) data = await blobToDataURL(a.blob); } catch {}
      attachments.push({...a,blob:undefined,data});
    }
    safe.push({...p,attachments});
  }
  const payload={schema:'rightstrigger-backup',version:1,exportedAt:new Date().toISOString(),profile,purchases:safe};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`rightstrigger-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export async function parseBackup(file) {
  const payload=JSON.parse(await file.text());
  if (payload.schema!=='rightstrigger-backup' || payload.version!==1) throw new Error('This is not a supported RightsTrigger backup.');
  const purchases=(payload.purchases||[]).map(p=>({...p,attachments:(p.attachments||[]).map(a=>({...a,blob:a.data?dataURLToBlob(a.data):undefined,data:undefined}))}));
  return {profile:payload.profile||null,purchases};
}