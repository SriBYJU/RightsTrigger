const DB_NAME = 'rightstrigger-db';
const DB_VERSION = 1;
const STORES = { profile: 'profile', purchases: 'purchases', meta: 'meta' };

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.profile)) db.createObjectStore(STORES.profile, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.purchases)) {
        const store = db.createObjectStore(STORES.purchases, { keyPath: 'id' });
        store.createIndex('purchaseDate', 'purchaseDate');
        store.createIndex('retailer', 'retailer');
      }
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(name, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    let result;
    try { result = fn(store); } catch (err) { reject(err); return; }
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Database transaction aborted'));
  }).finally(() => db.close());
}

export async function getProfile() {
  try { return await withStore(STORES.profile, 'readonly', s => s.get('current')); }
  catch { return JSON.parse(localStorage.getItem('rt-profile') || 'null'); }
}

export async function saveProfile(profile) {
  const value = { ...profile, id: 'current', updatedAt: new Date().toISOString() };
  try { await withStore(STORES.profile, 'readwrite', s => s.put(value)); }
  catch { localStorage.setItem('rt-profile', JSON.stringify(value)); }
  return value;
}

export async function getPurchases() {
  try {
    const rows = await withStore(STORES.purchases, 'readonly', s => s.getAll());
    return (rows || []).sort((a,b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));
  } catch {
    return JSON.parse(localStorage.getItem('rt-purchases') || '[]');
  }
}

export async function getPurchase(id) {
  try { return await withStore(STORES.purchases, 'readonly', s => s.get(id)); }
  catch { return (await getPurchases()).find(p => p.id === id) || null; }
}

export async function savePurchase(purchase) {
  const value = { ...purchase, updatedAt: new Date().toISOString() };
  try { await withStore(STORES.purchases, 'readwrite', s => s.put(value)); }
  catch {
    const rows = await getPurchases();
    const next = [value, ...rows.filter(p => p.id !== value.id)];
    localStorage.setItem('rt-purchases', JSON.stringify(next, (key,val) => key === 'blob' ? undefined : val));
  }
  return value;
}

export async function deletePurchase(id) {
  try { await withStore(STORES.purchases, 'readwrite', s => s.delete(id)); }
  catch {
    const rows = await getPurchases();
    localStorage.setItem('rt-purchases', JSON.stringify(rows.filter(p => p.id !== id)));
  }
}

export async function clearAllData() {
  try {
    const db = await openDB();
    db.close();
    await new Promise((resolve,reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
      req.onblocked = resolve;
    });
  } catch {}
  localStorage.removeItem('rt-profile');
  localStorage.removeItem('rt-purchases');
  localStorage.removeItem('rt-onboarded');
}