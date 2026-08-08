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

async function fetchAllDraws({ pageNo = 1, pageSize = 2000 } = {}) {
  // Try primary first, then fallbacks. Walk pages via pageNo/pageSize until
  // upstream returns < pageSize or we hit the global cap.
  const urls = [PRIMARY_URL, ...FALLBACK_URLS];
  for (const url of urls) {
    try {
      const params = new URLSearchParams({
        pageNo: String(pageNo),
        pageSize: String(pageSize),
        ts: String(Date.now()),
      });
      const json = await fetchJson(url + '?' + params.toString());
      const list = json?.list || json?.data?.list || [];
      const total = json?.data?.totalCount ?? json?.totalCount ?? json?.total ?? null;
      if (list.length > 0) {
        return { list, total, pageNo, pageSize, hasMore: total != null ? pageNo * pageSize < total : list.length === pageSize };
      }
    } catch (e) {
      console.warn('[trx-data] fetch failed:', url, e.message);
    }
  }
  return { list: [], total: 0, pageNo, pageSize, hasMore: false };
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
      20000
    );
    const pageNo = Math.max(parseInt(url.searchParams.get('pageNo') || '1', 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(url.searchParams.get('pageSize') || String(limit), 10) || limit, 100),
      10000
    );

    const result = await fetchAllDraws({ pageNo, pageSize });
    const list = result.list.slice(0, limit).map(normalize);

    // Cache 5s on Vercel Edge to reduce upstream hits
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        list,
        pageNo,
        pageSize,
        returned: list.length,
        total: result.total,
        hasMore: result.hasMore,
      })
    );
  } catch (e) {
    console.error('[trx-data]', e.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: e.message }));
  }
};
