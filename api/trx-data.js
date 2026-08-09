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

function fetchJson(url, timeoutMs = 15000) {
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
        headers: { Accept: 'application/json', 'User-Agent': UA, Connection: 'Keep-Alive' },
        agent,
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Parse error: ' + e.message)); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
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

  const collected = [];
  const seen = new Set();
  // Tronscan caps each request at 50 rows regardless of the requested limit.
  // TRX produces a block every ~3s, so 50 blocks ≈ 2.5 minutes. To collect
  // `callerLimit` lottery draws (one per minute at second :54), we walk back
  // ~60 blocks per expected draw × callerLimit + a buffer.
  const PAGE_SIZE = 50;
  const BLOCKS_PER_DRAW = 60;
  const blocksNeeded = Math.min(callerLimit * BLOCKS_PER_DRAW + 200, 50000);
  const maxPages = Math.ceil(blocksNeeded / PAGE_SIZE) + 2;

  let offset = 0;
  let pagesTried = 0;
  let oldestSeenBlock = currentBlock;
  let exhausted = false;

  while (collected.length < callerLimit && pagesTried < maxPages && !exhausted) {
    try {
      const upstream = `${TRONSCAN_BLOCK}?sort=-number&start=${offset}&limit=${PAGE_SIZE}&_ts=${Date.now()}`;
      const data = await fetchJson(upstream);
      const rows = Array.isArray(data.data) ? data.data : [];
      if (rows.length === 0) { exhausted = true; break; }
      oldestSeenBlock = rows[rows.length - 1].number || oldestSeenBlock;

      for (const row of rows) {
        const rec = lotteryRecordFromBlock(row);
        if (!rec) continue;
        if (seen.has(rec.issueNumber)) continue;
        seen.add(rec.issueNumber);
        collected.push(rec);
        if (collected.length >= callerLimit) break;
      }

      // If the upstream returned less than PAGE_SIZE we've hit the end.
      // Also stop if we've walked past block 1.
      if (rows.length < PAGE_SIZE || oldestSeenBlock <= 1) exhausted = true;
      offset += rows.length;
      pagesTried++;
      await new Promise((r) => setTimeout(r, 30));
    } catch (e) {
      console.warn('[trx-data] chunk failed:', e.message);
      break;
    }
  }

  // Sort ascending by issueNumber for chart consumption.
  collected.sort((a, b) => (BigInt(a.issueNumber) < BigInt(b.issueNumber) ? -1 : 1));

  return {
    list: collected,
    total: collected.length,
    pageNo: 1,
    pageSize: collected.length,
    hasMore: !exhausted && collected.length < callerLimit,
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

    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5');
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