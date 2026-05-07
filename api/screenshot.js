// Server-side full-page screenshot via headless Chromium.
// POST { url: string, width?: number } → PNG bytes.

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const ALLOWED_WIDTHS = new Set([390, 414, 430, 768, 1024, 1280, 1440, 1920]);
const FETCH_TIMEOUT_MS = 35_000;
const MAX_PAGE_HEIGHT = 16000; // safety cap on output height (px)

const UA_MOBILE  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

export const config = {
  maxDuration: 60,
  memory: 1024,
};

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function isPublicHttpUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost') return false;
    if (host === '0.0.0.0' || host === '::1') return false;
    if (/^127\./.test(host)) return false;
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    if (/\.local$/.test(host)) return false;
    if (/^fc[0-9a-f]{2}:/i.test(host) || /^fe80:/i.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  let body;
  try { body = await readBody(req); }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const url = String(body.url || '').trim();
  const width = ALLOWED_WIDTHS.has(Number(body.width)) ? Number(body.width) : 390;

  if (!url) return res.status(400).json({ error: 'Missing url' });
  if (!isPublicHttpUrl(url)) return res.status(400).json({ error: 'URL must be a public http(s) address' });

  const isMobile = width < 700;
  const dpr = isMobile ? 3 : 2;

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--hide-scrollbars',
        '--disable-web-security',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      defaultViewport: {
        width,
        height: 900,
        deviceScaleFactor: dpr,
        isMobile,
        hasTouch: isMobile,
      },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setUserAgent(isMobile ? UA_MOBILE : UA_DESKTOP);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-GB,en;q=0.9' });

    // Block heavy/irrelevant resources for speed
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const t = r.resourceType();
      if (t === 'media' || t === 'websocket') return r.abort();
      r.continue();
    });

    const navStart = Date.now();
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: FETCH_TIMEOUT_MS });
    } catch (e) {
      // networkidle2 can time out on chatty pages; fall back to domcontentloaded
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: FETCH_TIMEOUT_MS });
      } catch (e2) {
        throw new Error('Could not load page: ' + (e2.message || e.message));
      }
    }

    // Trigger lazy-loaded content: scroll to bottom, then back to top.
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let total = 0;
        const step = 400;
        const timer = setInterval(() => {
          window.scrollBy(0, step);
          total += step;
          if (total >= document.body.scrollHeight) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            setTimeout(resolve, 250);
          }
        }, 80);
      });
    });

    // Small settle for any post-scroll layout changes
    await new Promise((r) => setTimeout(r, 600));

    // Cap insanely tall pages
    const pageHeight = await page.evaluate(() => Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0,
    ));
    const captureHeight = Math.min(pageHeight, MAX_PAGE_HEIGHT);
    if (captureHeight !== pageHeight) {
      await page.setViewport({ width, height: captureHeight, deviceScaleFactor: dpr, isMobile, hasTouch: isMobile });
    }

    const png = await page.screenshot({
      type: 'png',
      fullPage: true,
      captureBeyondViewport: true,
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Render-Time-Ms', String(Date.now() - navStart));
    return res.status(200).send(png);

  } catch (err) {
    console.error('screenshot failed', err);
    return res.status(500).json({ error: err.message || 'Screenshot failed' });
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
}
