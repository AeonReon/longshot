// Longshot — stitch overlapping screenshots in the browser.
// Pure client-side. Files never leave the device.

const $ = (id) => document.getElementById(id);
const drop   = $('drop');
const fileEl = $('file');
const grid   = $('grid');
const stitchBtn = $('stitch');
const clearBtn  = $('clear');
const hint   = $('hint');
const status = $('status');
const statusMsg = $('statusMsg');
const progress = $('progress');
const resultEl = $('result');
const resultImg = $('resultImg');
const resultMeta = $('resultMeta');
const downloadEl = $('download');
const newOneBtn = $('newOne');

let items = [];   // { id, file, url, bitmap?, w?, h? }
let working = false;

// ---------- file ingest ----------

// On-screen diagnostic strip — invaluable for iPhone debugging where there's no console.
const diagEl = document.getElementById('diag');
const diagLog = (msg) => {
  if (!diagEl) return;
  const t = new Date().toTimeString().slice(0,8);
  diagEl.innerHTML = `<b>${t}</b> ${msg}<br>` + (diagEl.innerHTML || '').split('<br>').slice(0,3).join('<br>');
};
window.addEventListener('error', (e) => diagLog('JS ERROR: ' + (e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => diagLog('PROMISE REJECT: ' + (e.reason?.message || e.reason)));

// The <input> is now positioned absolutely over the entire drop zone with
// opacity:0 — iOS taps land directly on the input element, native picker.
// No label association, no JS click(), no race conditions.
fileEl.addEventListener('click', () => diagLog('input click fired'));
fileEl.addEventListener('change', (e) => {
  const list = e.target.files;
  diagLog(`change fired, files=${list ? list.length : 'null'}`);
  if (list && list.length) addFiles(list);
  // NB: don't reset fileEl.value here — on iOS some versions reset before
  // the FileList objects are fully read. Reset only on next user gesture if needed.
});

drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

// Paste support (desktop)
window.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length) addFiles(files);
});

function addFiles(fileList) {
  const all = [...fileList];
  diagLog(`addFiles: ${all.length} raw, types=${all.map(f => f.type || '?').join(',')}`);
  // iOS sometimes returns empty type for HEIC/HEIF picked from Photos.
  // Trust the picker (accept="image/*") AND fall back to extension sniffing.
  // Last resort: just accept everything when MIME and extension both fail.
  const incoming = all.filter(f => {
    const t = f.type || '';
    if (t.startsWith('image/')) return true;
    if (/\.(heic|heif|jpe?g|png|webp|gif|bmp|tiff?|avif)$/i.test(f.name || '')) return true;
    // iOS Photos sometimes hands over files with empty name AND empty type.
    // Trust the picker since accept="image/*" already filtered at OS level.
    return f.size > 0;
  });
  diagLog(`addFiles: ${incoming.length} accepted after filter`);
  if (!incoming.length) {
    hint.textContent = all.length
      ? `Couldn't find image files in your selection (${all.length} picked). Try JPG/PNG.`
      : '';
    return;
  }
  // Sort by filename so iOS IMG_4001 < IMG_4002 ordering works
  incoming.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric:true, sensitivity:'base'}));
  const newId = () => (crypto.randomUUID
    ? crypto.randomUUID()
    : 'i' + Math.random().toString(36).slice(2) + Date.now());
  for (const f of incoming) {
    try {
      items.push({ id: newId(), file: f, url: URL.createObjectURL(f) });
    } catch (e) {
      diagLog(`createObjectURL failed for ${f.name}: ${e.message}`);
    }
  }
  diagLog(`items now: ${items.length}, calling render()`);
  render();
}

function removeItem(id) {
  const it = items.find(i => i.id === id);
  if (it) URL.revokeObjectURL(it.url);
  items = items.filter(i => i.id !== id);
  render();
}

function moveItem(id, dir) {
  const i = items.findIndex(x => x.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  render();
}

clearBtn.addEventListener('click', () => {
  for (const it of items) URL.revokeObjectURL(it.url);
  items = [];
  hideResult();
  render();
});

newOneBtn.addEventListener('click', () => {
  hideResult();
  for (const it of items) URL.revokeObjectURL(it.url);
  items = [];
  render();
});

// ---------- render tile grid ----------

function render() {
  grid.innerHTML = '';
  items.forEach((it, idx) => {
    const div = document.createElement('div');
    div.className = 'tile';
    div.draggable = true;
    div.dataset.id = it.id;
    div.innerHTML = `
      <div class="thumb">
        <img src="${it.url}" alt="">
        <div class="num">${idx + 1}</div>
        <button class="x" aria-label="Remove">×</button>
      </div>
      <div class="ctl">
        <button class="nudge-l" aria-label="Move left">◀</button>
        <button class="nudge-r" aria-label="Move right">▶</button>
      </div>
    `;
    div.querySelector('.x').onclick = (e) => { e.stopPropagation(); removeItem(it.id); };
    div.querySelector('.nudge-l').onclick = (e) => { e.stopPropagation(); moveItem(it.id, -1); };
    div.querySelector('.nudge-r').onclick = (e) => { e.stopPropagation(); moveItem(it.id, +1); };

    // Native HTML5 drag-and-drop reorder (desktop)
    div.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', it.id);
      div.classList.add('dragging');
    });
    div.addEventListener('dragend', () => div.classList.remove('dragging'));
    div.addEventListener('dragover', (e) => e.preventDefault());
    div.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromId = e.dataTransfer.getData('text/plain');
      if (!fromId || fromId === it.id) return;
      const fromIdx = items.findIndex(x => x.id === fromId);
      const toIdx   = items.findIndex(x => x.id === it.id);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = items.splice(fromIdx, 1);
      items.splice(toIdx, 0, moved);
      render();
    });

    grid.appendChild(div);
  });

  stitchBtn.disabled = items.length < 2 || working;
  clearBtn.style.display = items.length ? '' : 'none';
  hint.textContent = items.length === 0
    ? ''
    : items.length === 1
      ? 'Add at least one more screenshot.'
      : `${items.length} images — drag to reorder, or use the arrows.`;
}

// ---------- stitching ----------

stitchBtn.addEventListener('click', async () => {
  if (working || items.length < 2) return;
  working = true;
  stitchBtn.disabled = true;
  hideResult();
  showStatus('Loading images…', 0);

  try {
    // Decode all images
    for (let i = 0; i < items.length; i++) {
      showStatus(`Loading image ${i+1}/${items.length}…`, (i / items.length) * 0.2);
      items[i].bitmap = await decodeImage(items[i].file, items[i].url);
      items[i].w = items[i].bitmap.width || items[i].bitmap.naturalWidth;
      items[i].h = items[i].bitmap.height || items[i].bitmap.naturalHeight;
    }

    // Normalize all images to a common width (first image's). Different widths
    // are scaled proportionally so the stitch result is uniform — no distortion,
    // no need for the user to give us perfectly-matched inputs.
    const targetW = items[0].w;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.w !== targetW) {
        const ratio = targetW / it.w;
        const newH = Math.round(it.h * ratio);
        const c = document.createElement('canvas');
        c.width = targetW;
        c.height = newH;
        c.getContext('2d').drawImage(it.bitmap, 0, 0, targetW, newH);
        diagLog(`resized image ${i+1}: ${it.w}×${it.h} → ${targetW}×${newH}`);
        it.bitmap = c;
        it.w = targetW;
        it.h = newH;
      }
    }

    // Pre-compute greyscale at low + full res for each image
    showStatus('Analysing overlap…', 0.25);
    const LOW_W = 320;
    for (let i = 0; i < items.length; i++) {
      items[i].low  = await greyscaleScaled(items[i].bitmap, LOW_W);
      items[i].full = await greyscaleScaled(items[i].bitmap, items[i].w);
      showStatus('Analysing overlap…', 0.25 + (i / items.length) * 0.25);
    }

    // For each consecutive pair, find overlap
    // overlap[i] = how many rows of items[i+1] should be skipped from the top
    const skips = [0];
    let warnings = [];
    for (let i = 0; i < items.length - 1; i++) {
      showStatus(`Matching ${i+1} → ${i+2}…`, 0.5 + (i / items.length) * 0.3);
      const m = await findOverlap(items[i], items[i+1]);
      skips.push(m.skip);
      if (m.poor) warnings.push(`Pair ${i+1}→${i+2}: weak overlap, falling back to direct concatenation.`);
    }

    // Build final canvas
    showStatus('Stitching…', 0.85);
    const totalH = items.reduce((sum, it, i) => sum + (it.h - skips[i]), 0);
    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = totalH;
    const ctx = out.getContext('2d');
    let y = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const sy = skips[i];
      const sh = it.h - sy;
      ctx.drawImage(it.bitmap, 0, sy, it.w, sh, 0, y, it.w, sh);
      y += sh;
    }

    // Export
    showStatus('Exporting…', 0.95);
    const blob = await new Promise(res => out.toBlob(res, 'image/png'));
    const url = URL.createObjectURL(blob);
    showResult(url, out.width, out.height, blob.size, warnings);

  } catch (err) {
    console.error(err);
    showStatus('Failed: ' + err.message, 1, true);
  } finally {
    working = false;
    stitchBtn.disabled = items.length < 2;
  }
});

// Decode a file to something canvas.drawImage can consume.
// createImageBitmap is fast but Safari can't decode HEIC; fall back to <img>.
async function decodeImage(file, url) {
  try {
    return await createImageBitmap(file);
  } catch (e) {
    const img = new Image();
    img.src = url;
    if (img.decode) {
      await img.decode();
    } else {
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('Could not decode ' + (file.name || 'image')));
      });
    }
    return img;
  }
}

// Render a bitmap into a canvas at given width and return greyscale Uint8Array + dims
async function greyscaleScaled(bitmap, targetW) {
  const ratio = targetW / bitmap.width;
  const w = Math.round(targetW);
  const h = Math.round(bitmap.height * ratio);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const grey = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
    // perceptual luminance approximation
    grey[i] = (data[p] * 76 + data[p+1] * 150 + data[p+2] * 30) >> 8;
  }
  return { grey, w, h };
}

// Find overlap between A (top) and B (bottom).
// Strategy: rough match at downsampled width, then refine at full resolution.
// Returns { skip, poor } where skip = rows of B to skip from top.
async function findOverlap(itemA, itemB) {
  const aLow = itemA.low, bLow = itemB.low;
  const stripLow = Math.min(40, Math.floor(aLow.h * 0.2));

  // Search range: real overlap is somewhere in the upper 80% of B.
  // Anything in the bottom 20% is almost certainly a coincidental match
  // on white space / status bar / home indicator and not real content overlap.
  const minY = 0;
  const maxY = Math.min(bLow.h - stripLow, Math.floor(bLow.h * 0.80));

  const rough = ssdSearch(
    aLow.grey, aLow.w, aLow.h,
    bLow.grey, bLow.w, bLow.h,
    stripLow, minY, maxY
  );

  // Scale rough.y from low-res to full-res
  const aFull = itemA.full, bFull = itemB.full;
  const ratio = bFull.h / bLow.h;
  const roughYFull = Math.round(rough.y * ratio);
  const stripFull = Math.min(80, Math.floor(aFull.h * 0.08));
  const refineRange = Math.ceil(ratio) + 4; // ±N pixels around rough match
  const fullMaxY = Math.min(bFull.h - stripFull, Math.floor(bFull.h * 0.80));

  const refined = ssdSearch(
    aFull.grey, aFull.w, aFull.h,
    bFull.grey, bFull.w, bFull.h,
    stripFull,
    Math.max(0, roughYFull - refineRange),
    Math.min(fullMaxY, roughYFull + refineRange)
  );

  // Score interpretation: avg squared diff per pixel.
  // Pure white-on-white ~0; mismatched content ~2000+. Use 800 as poor threshold —
  // tighter than before so flat regions don't get accepted as "real" matches.
  const POOR = 800;
  let poor = refined.score > POOR;

  // Sanity fallback: if the algorithm decided to skip ~all of B, that's
  // almost certainly wrong (real screenshots overlap by at most ~85%).
  // Treat as poor and just concatenate that pair directly.
  const proposedSkip = refined.y + stripFull;
  if (proposedSkip > bFull.h * 0.90) {
    poor = true;
  }

  const skip = poor ? 0 : proposedSkip;
  diagLog(`overlap: y=${refined.y}/${bFull.h} score=${refined.score.toFixed(0)} skip=${skip}${poor ? ' (rejected)' : ''}`);
  return { skip, poor, score: refined.score };
}

// Sum-of-squared-differences search.
// Compares aGrey[stripStart..aH] (the bottom strip of A) against
// bGrey[y..y+stripH] for y in [yMin..yMax]. Returns best y and avg score.
function ssdSearch(aGrey, aW, aH, bGrey, bW, bH, stripH, yMin, yMax) {
  const stripStart = aH - stripH;
  let bestY = yMin;
  let bestScore = Infinity;

  for (let y = yMin; y <= yMax; y++) {
    let sum = 0;
    for (let row = 0; row < stripH; row++) {
      const aOff = (stripStart + row) * aW;
      const bOff = (y + row) * bW;
      for (let x = 0; x < aW; x++) {
        const d = aGrey[aOff + x] - bGrey[bOff + x];
        sum += d * d;
      }
      if (sum > bestScore) break; // early exit
    }
    if (sum < bestScore) {
      bestScore = sum;
      bestY = y;
    }
  }
  return { y: bestY, score: bestScore / (stripH * aW) };
}

// ---------- UI helpers ----------

function showStatus(msg, frac, error = false) {
  status.classList.add('show');
  statusMsg.textContent = msg;
  statusMsg.style.color = error ? 'var(--warn)' : 'var(--soft)';
  progress.style.width = Math.min(100, Math.max(0, frac * 100)) + '%';
}
function hideStatus() { status.classList.remove('show'); }

function showResult(url, w, h, sizeBytes, warnings) {
  hideStatus();
  resultImg.src = url;
  const kb = (sizeBytes / 1024).toFixed(0);
  const mb = (sizeBytes / 1024 / 1024).toFixed(2);
  const sizeStr = sizeBytes > 1024*1024 ? `${mb} MB` : `${kb} KB`;
  let meta = `${w} × ${h}px · ${sizeStr}`;
  if (warnings.length) meta += '<br><span style="color:var(--warn)">⚠ ' + warnings.join(' ') + '</span>';
  resultMeta.innerHTML = meta;
  downloadEl.href = url;
  const ts = new Date().toISOString().replace(/[-:T.]/g,'').slice(0,14);
  downloadEl.download = `longshot-${ts}.png`;
  resultEl.classList.add('show');
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function hideResult() { resultEl.classList.remove('show'); }

render();

// ---------- Share Target ingest ----------

// If the user landed here via Photos.app → Share → Longshot, the service
// worker stashed the photos in a cache before redirecting. Pull them out.
async function ingestSharedFiles() {
  if (!('caches' in self)) return;
  const url = new URL(location.href);
  const fromShare = url.searchParams.has('from-share') || location.hash === '#stitch';
  if (!fromShare) return;

  try {
    const cache = await caches.open('longshot-share');
    const manifestResp = await cache.match('/__share/manifest');
    if (!manifestResp) return;
    const { count = 0 } = await manifestResp.json();
    if (!count) return;

    const files = [];
    for (let i = 0; i < count; i++) {
      const resp = await cache.match(`/__share/${i}`);
      if (!resp) continue;
      const blob = await resp.blob();
      const filename = resp.headers.get('X-Filename') || `photo-${i}.jpg`;
      const type = resp.headers.get('Content-Type') || blob.type || 'image/jpeg';
      files.push(new File([blob], filename, { type }));
    }

    // Tear down the share cache so we don't re-ingest on reload
    const keys = await cache.keys();
    for (const k of keys) await cache.delete(k);

    if (files.length) {
      diagLog(`Share ingest: received ${files.length} photo(s)`);
      // Force-switch to the Stitch tab
      document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'stitch'));
      document.getElementById('panel-url').classList.remove('active');
      document.getElementById('panel-stitch').classList.add('active');
      addFiles(files);
    }

    // Clean URL so refresh doesn't try to re-ingest
    history.replaceState(null, '', '/');
  } catch (e) {
    diagLog('Share ingest failed: ' + e.message);
  }
}

// Run once after first paint so the diagnostic strip is in the DOM.
window.addEventListener('load', () => {
  setTimeout(ingestSharedFiles, 100);
});

// ---------- Tabs ----------

function setActiveTab(tab) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('panel-url').classList.toggle('active', tab === 'url');
  document.getElementById('panel-stitch').classList.toggle('active', tab === 'stitch');
  try { localStorage.setItem('longshot-tab', tab); } catch {}
  hideResult();
  hideStatus();
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

// Restore last-used tab on load (default to Stitch since it's the primary use case)
try {
  const saved = localStorage.getItem('longshot-tab');
  if (saved === 'stitch' || saved === 'url') setActiveTab(saved);
} catch {}

// ---------- URL mode ----------

const urlInput = $('urlInput');
const captureBtn = $('capture');
const urlHint = $('urlHint');
const widthSeg = $('widthSeg');

let chosenWidth = 390;
widthSeg.querySelectorAll('button').forEach(b => {
  b.addEventListener('click', () => {
    widthSeg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    chosenWidth = parseInt(b.dataset.w, 10);
  });
});

captureBtn.addEventListener('click', async () => {
  if (working) return;
  let url = urlInput.value.trim();
  if (!url) { urlInput.focus(); urlHint.textContent = 'Paste a URL first.'; return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  urlHint.textContent = '';

  working = true;
  captureBtn.disabled = true;
  hideResult();
  showStatus('Asking the screenshot service…', 0.15);

  try {
    const t0 = performance.now();
    let frac = 0.15;
    const tick = setInterval(() => {
      frac = Math.min(0.9, frac + 0.04);
      showStatus(`Rendering at ${chosenWidth}px width…`, frac);
    }, 1200);

    // Microlink: free public screenshot service. No auth, generous free tier.
    // Returns JSON with screenshot.url pointing at the rendered PNG.
    const device = chosenWidth <= 430 ? 'iPhone X' : (chosenWidth <= 768 ? 'iPad' : 'Macbook Pro 15');
    const params = new URLSearchParams({
      url,
      screenshot: 'true',
      meta: 'false',
      embed: 'screenshot.url',
      'viewport.width': String(chosenWidth),
      'viewport.deviceScaleFactor': '2',
      fullPage: 'true',
      waitUntil: 'networkidle0',
      type: 'png',
      device,
    });

    const apiUrl = `https://api.microlink.io/?${params.toString()}`;
    const resp = await fetch(apiUrl);
    clearInterval(tick);

    if (!resp.ok) {
      const status = resp.status;
      let body = '';
      try { body = await resp.text(); } catch {}
      throw new Error(`Screenshot service returned ${status}${body ? ': ' + body.slice(0, 120) : ''}`);
    }

    // With embed=screenshot.url, the response IS the image bytes.
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const dims = await new Promise((res) => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res({ w: chosenWidth, h: 0 });
      im.src = blobUrl;
    });
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    showResult(blobUrl, dims.w, dims.h, blob.size, [`Captured in ${elapsed}s via microlink.io`]);

  } catch (err) {
    console.error(err);
    showStatus('Failed: ' + err.message, 1, true);
  } finally {
    working = false;
    captureBtn.disabled = false;
  }
});
