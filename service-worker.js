const CACHE='rightstrigger-shell-v2';
const CORE=['./','./index.html','./styles.css','./config.js','./manifest.webmanifest','./assets/mark.svg','./js/app.js','./js/db.js','./js/extractor.js','./js/rights-engine.js','./js/backup.js'];

self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const u=new URL(event.request.url);
  if(u.origin!==location.origin) return;

  // Network-first keeps an actively developed app from getting stuck on an old
  // JavaScript bundle. The cache remains an offline fallback.
  event.respondWith(
    fetch(event.request).then(res=>{
      const copy=res.clone();
      caches.open(CACHE).then(c=>c.put(event.request,copy));
      return res;
    }).catch(()=>caches.match(event.request))
  );
});
