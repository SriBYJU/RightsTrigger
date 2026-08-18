const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

function cleanText(text='') {
  return text.replace(/\r/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}

function parseCurrency(text) {
  const candidates = [...text.matchAll(/(?:total|amount|grand total|order total|paid)\s*[:\-]?\s*\$?\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.\d{2})?)/ig)]
    .map(m => Number(m[1].replace(/,/g,''))).filter(Number.isFinite);
  if (candidates.length) return candidates[candidates.length - 1];
  const all = [...text.matchAll(/\$\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.\d{2})?)/g)].map(m => Number(m[1].replace(/,/g,''))).filter(Number.isFinite);
  return all.length ? Math.max(...all.filter(n => n < 100000)) : null;
}

function normalizeDate(y,m,d) {
  const date = new Date(Date.UTC(Number(y), Number(m)-1, Number(d)));
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0,10);
}

function parseDate(text) {
  const iso = text.match(/(?:purchase date|order date|date)\s*[:\-]?\s*(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/i);
  if (iso) return normalizeDate(iso[1],iso[2],iso[3]);
  const us = text.match(/(?:purchase date|order date|date)\s*[:\-]?\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})/i)
    || text.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (us) return normalizeDate(us[3],us[1],us[2]);
  const lower = text.toLowerCase();
  for (let i=0;i<MONTHS.length;i++) {
    const re = new RegExp(`${MONTHS[i]}\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(20\\d{2})`, 'i');
    const m = lower.match(re);
    if (m) return normalizeDate(m[2], i+1, m[1]);
  }
  return '';
}

function parseOrderNumber(text) {
  const m = text.match(/(?:order|receipt|invoice|confirmation)(?:\s*(?:number|no\.?|#))?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{5,})/i);
  return m?.[1] || '';
}

function parseRetailer(text) {
  const lines = cleanText(text).split('\n').map(s=>s.trim()).filter(Boolean).slice(0,10);
  const known = ['amazon','walmart','target','best buy','costco','nike','apple','adidas','ebay','etsy','home depot',"lowe's","macy's",'nordstrom','staples'];
  const lower = text.toLowerCase();
  const hit = known.find(k => lower.includes(k));
  if (hit) return hit.replace(/\b\w/g,c=>c.toUpperCase());
  const plausible = lines.find(l => l.length >= 2 && l.length <= 50 && !/receipt|invoice|order|thank|www\.|http|\$|\d{3,}/i.test(l));
  return plausible || '';
}

function parseProduct(text, retailer='') {
  const lines = cleanText(text).split('\n').map(s=>s.trim()).filter(Boolean);
  const patterns = [/item\s*[:\-]\s*(.+)/i,/product\s*[:\-]\s*(.+)/i,/description\s*[:\-]\s*(.+)/i];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim().slice(0,100);
  }
  const skip = /receipt|invoice|order|total|subtotal|tax|shipping|payment|visa|mastercard|thank|return|warranty|date|qty|quantity|address|www\.|http/i;
  const candidate = lines.find(l => l.length > 4 && l.length < 100 && !skip.test(l) && (!retailer || l.toLowerCase() !== retailer.toLowerCase()) && /[a-z]/i.test(l));
  return candidate || '';
}

function parseDeadlineByPhrase(text, phrase) {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(phrase.toLowerCase());
  if (idx < 0) return '';
  const chunk = text.slice(idx, idx + 180);
  return parseDate(chunk);
}

function parsePolicyDays(text, type) {
  const patterns = type === 'return'
    ? [/(?:return|refund)[^\n.]{0,80}?within\s+(\d{1,3})\s+days/i,/(\d{1,3})[- ]day\s+return/i]
    : [/(\d{1,3})\s*(?:year|yr)s?\s+(?:limited\s+)?warranty/i,/(?:warranty)[^\n.]{0,80}?(\d{1,3})\s*(?:year|yr)s?/i];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

export function extractStructuredData(text) {
  const cleaned = cleanText(text);
  const retailer = parseRetailer(cleaned);
  const product = parseProduct(cleaned, retailer);
  const purchaseDate = parseDate(cleaned);
  const amount = parseCurrency(cleaned);
  const orderNumber = parseOrderNumber(cleaned);
  const returnDeadline = parseDeadlineByPhrase(cleaned, 'return by') || parseDeadlineByPhrase(cleaned, 'eligible through');
  const warrantyEnd = parseDeadlineByPhrase(cleaned, 'warranty until') || parseDeadlineByPhrase(cleaned, 'warranty expires');
  const returnDays = parsePolicyDays(cleaned, 'return');
  const warrantyYears = parsePolicyDays(cleaned, 'warranty');
  const fields = [retailer,product,purchaseDate,amount,orderNumber];
  const populated = fields.filter(v => v !== '' && v !== null && v !== undefined).length;
  const confidence = populated / fields.length;
  return { retailer, product, purchaseDate, amount, orderNumber, returnDeadline, warrantyEnd, returnDays, warrantyYears, rawText: cleaned, confidence };
}

async function extractPdf(file, onProgress) {
  onProgress?.('Reading PDF text…');
  const pdfjsLib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let text = '';
  for (let i=1;i<=pdf.numPages;i++) {
    onProgress?.(`Reading PDF page ${i} of ${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return cleanText(text);
}

let ocrWorkerPromise = null;

async function createOcrWorker(onProgress) {
  onProgress?.('Loading OCR engine…');
  const mod = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js');
  const createWorker = mod.createWorker || mod.default?.createWorker;
  if (typeof createWorker !== 'function') throw new Error('OCR engine loaded without a compatible worker API.');

  return createWorker('eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    logger: m => {
      if (!m?.status) return;
      if (typeof m.progress === 'number') onProgress?.(`${m.status} · ${Math.round(m.progress * 100)}%`);
      else onProgress?.(m.status);
    }
  });
}

async function getOcrWorker(onProgress) {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createOcrWorker(onProgress).catch(error => {
      ocrWorkerPromise = null;
      throw error;
    });
  }
  return ocrWorkerPromise;
}

async function imageFileToCanvas(file, onProgress) {
  onProgress?.('Preparing receipt image…');

  let source;
  let sourceUrl = null;
  try {
    if ('createImageBitmap' in window) {
      try { source = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch { source = null; }
    }
    if (!source) {
      sourceUrl = URL.createObjectURL(file);
      const img = new Image();
      img.decoding = 'async';
      img.src = sourceUrl;
      if (img.decode) await img.decode();
      else await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Image could not be decoded.'));});
      source = img;
    }

    const sw = source.width || source.naturalWidth;
    const sh = source.height || source.naturalHeight;
    if (!sw || !sh) throw new Error('Image dimensions could not be read.');

    const minLongSide = 1800;
    const maxLongSide = 2600;
    const longSide = Math.max(sw, sh);
    let scale = 1;
    if (longSide < minLongSide) scale = Math.min(2.5, minLongSide / longSide);
    else if (longSide > maxLongSide) scale = maxLongSide / longSide;

    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Image canvas is unavailable in this browser.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,width,height);
    ctx.drawImage(source,0,0,width,height);

    try {
      const image = ctx.getImageData(0,0,width,height);
      const d = image.data;
      const contrast = 1.25;
      for (let i=0;i<d.length;i+=4) {
        const gray = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
        const v = Math.max(0,Math.min(255,(gray-128)*contrast+128));
        d[i]=d[i+1]=d[i+2]=v;
      }
      ctx.putImageData(image,0,0);
    } catch {}

    return canvas;
  } catch (error) {
    const isHeic = /heic|heif/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || '');
    if (isHeic) throw new Error('This HEIC/HEIF photo could not be decoded for OCR. Use a screenshot or JPEG/PNG copy of the receipt.');
    throw new Error(`The receipt image could not be decoded: ${error.message || 'unknown image error'}`);
  } finally {
    if (source?.close) source.close();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }
}

async function extractImage(file, onProgress) {
  const canvas = await imageFileToCanvas(file,onProgress);
  let worker;
  try {
    worker = await getOcrWorker(onProgress);
    onProgress?.('Reading receipt text…');
    const result = await worker.recognize(canvas, { rotateAuto: true });
    const text = cleanText(result?.data?.text || '');
    if (!text) throw new Error('OCR ran but found no readable text.');
    return text;
  } catch (firstError) {
    try {
      const stale = await ocrWorkerPromise;
      await stale?.terminate?.();
    } catch {}
    ocrWorkerPromise = null;

    try {
      onProgress?.('Retrying OCR engine…');
      worker = await getOcrWorker(onProgress);
      const result = await worker.recognize(canvas, { rotateAuto: true });
      const text = cleanText(result?.data?.text || '');
      if (!text) throw new Error('OCR ran but found no readable text.');
      return text;
    } catch (retryError) {
      throw new Error(`OCR could not read this image. ${retryError?.message || firstError?.message || 'Unknown OCR error'}`);
    }
  }
}

export async function extractFileText(file, onProgress) {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return extractPdf(file,onProgress);
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|heic|heif)$/i.test(file.name)) return extractImage(file,onProgress);
  if (file.type.startsWith('text/') || file.name.toLowerCase().endsWith('.txt')) return cleanText(await file.text());
  throw new Error(`Unsupported file type: ${file.name}`);
}

export async function analyzeFiles(files, onProgress) {
  const results=[];
  for (let i=0;i<files.length;i++) {
    onProgress?.(`Analyzing ${files[i].name} (${i+1}/${files.length})…`);
    try {
      const text = await extractFileText(files[i],onProgress);
      results.push({ name:files[i].name, type:files[i].type, size:files[i].size, text, blob:files[i] });
    } catch (error) {
      console.error('[RightsTrigger OCR]', files[i].name, error);
      results.push({ name:files[i].name, type:files[i].type, size:files[i].size, text:'', blob:files[i], error:error.message });
    }
  }
  const combined = results.map(r=>r.text).filter(Boolean).join('\n\n');
  return { documents: results, extracted: extractStructuredData(combined), combinedText: combined };
}
