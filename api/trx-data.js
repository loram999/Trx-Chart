/**
 * TRX Chart Data — public draw history for the candlestick chart.
 * No auth required. Uses TRX blockchain blocks from apilist.tronscanapi.com
 * (the same data source the reference chart at warwarzc-sudo/trx-chart uses),
 * filtered to blocks produced at UTC second :54 — those are the 1-minute
 * TRX lottery draws. Walks block ranges backward until callerLimit is met.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

const UA = 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const TRONSCAN_BLOCK = 'https://apilist.tronscanapi.com/api/block';

function fetchJson(url, timeoutMs = 15000, retries = 2) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
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
          headers: { Accept: 'application/json', 'User-Agent': UA, Connection: 'Keep-Alive' },
          agent,
          timeout: timeoutMs,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            // Tronscan rate-limits aggressively (429). Back off and retry.
            if (res.statusCode === 429 && n < retries) {
              setTimeout(() => attempt(n + 1), 800 * (n + 1));
              return;
            }
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error(`status=${res.statusCode}: parse ${e.message}`)); }
          });
        }
      );
      req.on('error', (err) => {
        if (n < retries) setTimeout(() => attempt(n + 1), 500 * (n + 1));
        else reject(err);
      });
      req.on('timeout', () => {
        req.destroy();
        if (n < retries) setTimeout(() => attempt(n + 1), 500 * (n + 1));
        else reject(new Error('timeout'));
      });
      req.end();
    };
    attempt(0);
  });
}

// ── Block → lottery record ────────────────────────────────────────────
// Mirror the reference repo's worker.js exactly so the digit derivation
// is identical.

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

function lotteryRecordFromBlock(row) {
  if (!row || !row.timestamp || !row.hash) return null;
  const sec = new Date(row.timestamp).getUTCSeconds();
  if (sec !== 54) return null;
  return {
    issueNumber: toPeriod(row.timestamp),
    number: resultFromHash(row.hash),
    blockTime: toBlockTime(row.timestamp),
  };
}

async function fetchCurrentBlock() {
  const data = await fetchJson(`${TRONSCAN_BLOCK}?sort=-number&start=0&limit=1&_ts=${Date.now()}`);
  const rows = Array.isArray(data.data) ? data.data : [];
  return rows.length ? (rows[0].number || 0) : 0;
}

// Walk block ranges backward, collecting lottery draws. The chart needs
// historical data, so we start at the latest block and page back in
// 600-block chunks (~5 min of TRX) until we hit callerLimit.
async function fetchAllDraws({ limit = 1000 } = {}) {
  const callerLimit = Math.min(parseInt(limit, 10) || 0, 5000);
  if (callerLimit <= 0) return { list: [], total: 0, pageNo: 1, pageSize: 0, hasMore: false };

  const currentBlock = await fetchCurrentBlock();
  if (!currentBlock) return { list: [], total: 0, pageNo: 1, pageSize: 0, hasMore: false };

  // Tronscan caps each request at 50 rows and rate-limits aggressively from
  // cloud IPs. Strategy: fetch a single fast page (50 blocks ≈ 2.5 minutes
  // of TRX) — this gives us ~8 lottery draws, enough to render the chart
  // and hide the loading overlay. The chart's poll cycle accumulates more
  // by re-calling and reading from edge cache.
  const PAGE_SIZE = 50;
  const collected = [];
  const seen = new Set();

  try {
    const upstream = `${TRONSCAN_BLOCK}?sort=-number&start=0&limit=${PAGE_SIZE}&_ts=${Date.now()}`;
    const data = await fetchJson(upstream);
    const rows = Array.isArray(data.data) ? data.data : [];
    for (const row of rows) {
      const rec = lotteryRecordFromBlock(row);
      if (!rec) continue;
      if (seen.has(rec.issueNumber)) continue;
      seen.add(rec.issueNumber);
      collected.push(rec);
    }
  } catch (e) {
    console.warn('[trx-data] fetch failed:', e.message);
  }

  // Sort ascending by issueNumber for chart consumption.
  collected.sort((a, b) => (BigInt(a.issueNumber) < BigInt(b.issueNumber) ? -1 : 1));

  return {
    list: collected,
    total: collected.length,
    pageNo: 1,
    pageSize: collected.length,
    hasMore: collected.length < callerLimit && currentBlock > 0,
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
      parseInt(url.searchParams.get('limit') || '1000', 10) || 1000,
      5000
    );

    const result = await fetchAllDraws({ limit });
    const list = result.list;

    // Only cache successful responses with at least some data — empty/0 results
    // (rate-limited upstream) must not be cached, or the chart stays empty
    // for the full s-maxage window.
    if (list.length > 0) {
      res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=60');
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        list,
        pageNo: 1,
        pageSize: list.length,
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