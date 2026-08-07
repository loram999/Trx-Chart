/**
 * TRX Chart Data — public draw history for the candlestick chart.
 * No auth required. Returns up to 10k most recent TRX 1M draws.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

const UA = 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

const PRIMARY_URL = 'https://draw.ar-lottery01.com/TrxWinGo/TrxWinGo_1M/GetHistoryIssuePage.json';
const FALLBACK_URLS = [
  'https://draw.ar-lottery03.com/TrxWinGo/TrxWinGo_1M/GetHistoryIssuePage.json',
  'https://draw.ar-lottery02.com/TrxWinGo/TrxWinGo_1M/GetHistoryIssuePage.json',
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const agent = parsed.protocol === 'https:'
      ? new https.Agent({ rejectUnauthorized: false, keepAlive: true })
      : undefined;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': UA,
          Connection: 'Keep-Alive',
        },
        agent,
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Parse error: ' + e.message));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function fetchAllDraws() {
  // Try primary first, then fallbacks
  const urls = [PRIMARY_URL, ...FALLBACK_URLS];
  for (const url of urls) {
    try {
      const json = await fetchJson(url + '?ts=' + Date.now());
      const list = json?.list || json?.data?.list || [];
      if (list.length > 0) return list;
    } catch (e) {
      console.warn('[trx-data] fetch failed:', url, e.message);
    }
  }
  return [];
}

function normalize(item) {
  return {
    issueNumber: String(item.issueNumber || item.issuenumber || item.period || ''),
    number: parseInt(item.number ?? item.openNumber ?? item.result ?? 0, 10) || 0,
    blockTime: item.blockTime || item.block_time || item.openTime || null,
  };
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end('ok');
    return;
  }

  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || '10000', 10) || 10000,
      10000
    );

    const raw = await fetchAllDraws();
    const list = raw.slice(0, limit).map(normalize);

    // Cache 5s on Vercel Edge to reduce upstream hits
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(list));
  } catch (e) {
    console.error('[trx-data]', e.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: e.message }));
  }
};
