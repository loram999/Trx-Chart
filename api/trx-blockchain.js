/**
 * TRX Chart Data — blockchain-based draw history.
 * Mirrors the data-loading pattern used by warwarzc-sudo/trx-chart:
 * fetch TRX blocks from apilist.tronscanapi.com and derive the lottery
 * digit from the block hash. Blocks produced at UTC second :54 are the
 * 1-minute TRX lottery draws.
 *
 * Endpoints (GET):
 *   ?mode=info              → { currentBlock, rowCount }
 *   ?mode=blocks&from=&to=  → { records:[…], oldestTs, newestTs, rowCount }
 *   ?mode=latest (default)  → { record: {…}|null, rowCount }
 *
 * Record shape:
 *   { period, blockHeight, blockTime, hash, timestamp, second:54,
 *     result: 0-9, bigSmall: "Big"|"Small" }
 *
 * Existing /api/trx-data and /api/trx endpoints are untouched.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const TRONSCAN_BLOCK = 'https://apilist.tronscanapi.com/api/block';

function fetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const agent =
      parsed.protocol === 'https:'
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
          Accept: 'application/json',
          'User-Agent': UA,
          Connection: 'Keep-Alive',
        },
        agent,
        timeout: timeoutMs,
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

function resultFromHash(hash) {
  if (!hash) return 0;
  const part = hash.length > 16 ? hash.slice(16) : hash;
  for (let i = part.length - 1; i >= 0; i--) {
    const ch = part[i];
    if (ch >= '0' && ch <= '9') return parseInt(ch, 10);
  }
  for (let i = hash.length - 1; i >= 0; i--) {
    const ch = hash[i];
    if (ch >= '0' && ch <= '9') return parseInt(ch, 10);
  }
  return 0;
}

function toPeriod(ts) {
  const d = new Date(ts);
  return (
    String(d.getUTCFullYear()) +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0') +
    String(d.getUTCHours()).padStart(2, '0') +
    String(d.getUTCMinutes()).padStart(2, '0')
  );
}

function toBlockTime(ts) {
  const d = new Date(ts);
  return (
    String(d.getUTCHours()).padStart(2, '0') + ':' +
    String(d.getUTCMinutes()).padStart(2, '0') + ':' +
    String(d.getUTCSeconds()).padStart(2, '0')
  );
}

function toRecord(row) {
  if (!row || !row.timestamp || !row.hash) return null;
  const sec = new Date(row.timestamp).getUTCSeconds();
  if (sec !== 54) return null;
  const result = resultFromHash(row.hash);
  return {
    period: toPeriod(row.timestamp),
    blockHeight: row.number,
    blockTime: toBlockTime(row.timestamp),
    hash: row.hash,
    timestamp: row.timestamp,
    second: sec,
    result,
    bigSmall: result >= 5 ? 'Big' : 'Small',
  };
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const mode = url.searchParams.get('mode') || 'latest';
  const start = Math.max(0, parseInt(url.searchParams.get('start') || '0', 10));
  const limit = Math.min(60, Math.max(1, parseInt(url.searchParams.get('limit') || '40', 10)));
  const fromBlock = parseInt(url.searchParams.get('from') || '0', 10);
  const toBlock = parseInt(url.searchParams.get('to') || '0', 10);

  try {
    if (mode === 'info') {
      const upstream = `${TRONSCAN_BLOCK}?sort=-number&start=0&limit=1&_ts=${Date.now()}`;
      const data = await fetchJson(upstream);
      const rows = Array.isArray(data.data) ? data.data : [];
      const currentBlock = rows.length ? (rows[0].number || 0) : 0;
      sendJson(res, 200, { currentBlock, rowCount: rows.length });
      return;
    }

    if (mode === 'blocks') {
      const lo = Math.max(0, Math.min(fromBlock, toBlock));
      const hi = Math.max(lo, Math.max(fromBlock, toBlock));
      const span = Math.max(0, hi - lo);
      const pageSize = Math.min(span + 1, 1000);
      const upstream =
        `${TRONSCAN_BLOCK}?sort=-number&start=${lo}&limit=${pageSize}&_ts=${Date.now()}`;
      const data = await fetchJson(upstream);
      const rows = Array.isArray(data.data) ? data.data : [];
      const records = rows
        .map(toRecord)
        .filter(Boolean)
        .sort((a, b) => a.period.localeCompare(b.period));
      sendJson(res, 200, {
        records,
        oldestTs: rows.length ? rows[rows.length - 1].timestamp : null,
        newestTs: rows.length ? rows[0].timestamp : null,
        rowCount: rows.length,
      });
      return;
    }

    // mode=latest (default) — single most-recent draw
    const upstream =
      `${TRONSCAN_BLOCK}?sort=-number&start=${start}&limit=${limit}&_ts=${Date.now()}`;
    const data = await fetchJson(upstream);
    const rows = Array.isArray(data.data) ? data.data : [];
    const records = rows
      .map(toRecord)
      .filter(Boolean)
      .sort((a, b) => b.timestamp - a.timestamp);
    sendJson(res, 200, {
      record: records.length ? records[0] : null,
      rowCount: rows.length,
    });
  } catch (e) {
    console.error('[trx-blockchain]', e.message);
    sendJson(res, 500, { ok: false, error: e.message });
  }
};