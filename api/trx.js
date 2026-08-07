/**
 * TRX Trading API — 6Lottery / 777BIGWIN login, balance, issue, bet, results, history
 * Ported from Code-Space (Telegram bot) webapi helpers.
 */
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const BASE_URLS = {
  '6Lottery': 'https://6lotteryapi.com/api/webapi/',
  '777BIGWIN': 'https://api.bigwinqaz.com/api/webapi/',
};

const ORIGIN = 'https://6win598.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0';

function log(level, msg) {
  console.log(`[${level}] ${new Date().toISOString()} - ${msg}`);
}

function generateSignature(data) {
  const f = {};
  const exclude = ['signature', 'track', 'xosoBettingData'];
  Object.keys(data)
    .sort()
    .forEach((k) => {
      const v = data[k];
      if (v !== null && v !== '' && !exclude.includes(k)) {
        f[k] = v === 0 ? 0 : v;
      }
    });
  return crypto.createHash('md5').update(JSON.stringify(f)).digest('hex').toUpperCase();
}

function numberToBS(num) {
  const n = parseInt(num, 10);
  if (isNaN(n)) return '?';
  return n >= 5 ? 'B' : 'S';
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const agent = isHttps
      ? new https.Agent({ rejectUnauthorized: false, keepAlive: true })
      : undefined;

    const bodyStr = options.body
      ? typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body)
      : null;

    const headers = {
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': UA,
      Connection: 'Keep-Alive',
      'Ar-Origin': ORIGIN,
      Origin: ORIGIN,
      Referer: `${ORIGIN}/`,
      ...(options.headers || {}),
    };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers,
        agent,
        timeout: options.timeout || 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ data: JSON.parse(data), status: res.statusCode });
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function createSession(baseUrl, token, tokenHeader) {
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const auth = `${tokenHeader || 'Bearer '}${token}`;
  return {
    post: async (endpoint, body) => {
      return makeRequest(root + endpoint, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json; charset=UTF-8',
          'Ar-Origin': ORIGIN,
          Origin: ORIGIN,
          Referer: `${ORIGIN}/`,
          'User-Agent': UA,
        },
        body,
      });
    },
  };
}

function normalizePhone(phone) {
  const p = String(phone || '').replace(/\D/g, '');
  if (p.startsWith('95')) return p;
  return `95${p}`;
}

async function loginRequest(phone, password, site = '6Lottery') {
  let baseUrl = BASE_URLS[site] || BASE_URLS['6Lottery'];
  if (!baseUrl.endsWith('/')) baseUrl += '/';

  const loginData = {
    username: normalizePhone(phone),
    pwd: password,
    phonetype: 1,
    logintype: 'mobile',
    packId: '',
    deviceId: '5dcab3e06db88a206975e91ea6ac7c87',
    language: 7,
    random: crypto.randomBytes(16).toString('hex'),
  };
  loginData.signature = generateSignature(loginData);
  loginData.timestamp = Math.floor(Date.now() / 1000);

  const response = await makeRequest(baseUrl + 'Login', {
    method: 'POST',
    body: loginData,
    timeout: 15000,
  });

  const res = response.data;
  if (res.code === 0 && res.data) {
    const tokenHeader = res.data.tokenHeader || 'Bearer ';
    const token = res.data.token || '';
    const session = createSession(baseUrl, token, tokenHeader);
    return { response: res, session, baseUrl, token, tokenHeader };
  }
  return { response: res, session: null, baseUrl };
}

async function getBalance(session) {
  const body = {
    language: 7,
    random: '71ebd56cff7d4679971c482807c33f6f',
  };
  body.signature = generateSignature(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);

  const response = await session.post('GetBalance', body);
  const res = response.data;
  if (res.code === 0 && res.data) {
    const amount = res.data.Amount ?? res.data.amount ?? res.data.balance;
    if (amount !== undefined && amount !== null) return parseFloat(amount);
  }
  return null;
}

async function getUserInfo(session) {
  const body = {
    language: 7,
    random: '4fc9f8f8d6764a5f934d4c6a468644e0',
  };
  body.signature = generateSignature(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);

  const response = await session.post('GetUserInfo', body);
  const res = response.data;
  if (res.code === 0 && res.data) {
    return {
      user_id: res.data.userId,
      username: res.data.userName,
      nickname: res.data.nickName,
      balance: res.data.amount,
      photo: res.data.userPhoto,
    };
  }
  return null;
}

async function getGameIssue(session) {
  const body = {
    typeId: 13,
    language: 7,
    random: '7d76f361dc5d4d8c98098ae3d48ef7af',
  };
  body.signature = generateSignature(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await session.post('GetTrxGameIssue', body);
      if (response.data && response.data.code === 0) return response.data;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
      else return response.data;
    } catch (e) {
      if (attempt >= 2) return { error: e.message };
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return { error: 'Failed after retries' };
}

async function placeBet(session, issueNumber, selectType, amount) {
  const unitAmount = Number(amount);
  const betBody = {
    typeId: 13,
    issuenumber: String(issueNumber),
    language: 7,
    gameType: 2,
    amount: unitAmount,
    betCount: 1,
    selectType: parseInt(selectType, 10),
    random: 'f9ec46840a374a65bb2abad44dfc4dc3',
  };
  betBody.signature = generateSignature(betBody).toUpperCase();
  betBody.timestamp = Math.floor(Date.now() / 1000);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await session.post('GameTrxBetting', betBody);
      return response.data;
    } catch (e) {
      if (attempt >= 2) return { error: e.message };
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return { error: 'Failed after retries' };
}

async function getTRXGameResults(session) {
  const urls = [
    'https://draw.ar-lottery01.com/TrxWinGo/TrxWinGo_1M/GetHistoryIssuePage.json',
    'https://draw.ar-lottery03.com/TrxWinGo/TrxWinGo_1M/GetHistoryIssuePage.json',
    'https://draw.ar-lottery02.com/TrxWinGo/TrxWinGo_1M/GetHistoryIssuePage.json',
  ];
  for (const url of urls) {
    try {
      const response = await makeRequest(url + '?ts=' + Date.now(), {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
          Connection: 'Keep-Alive',
        },
      });
      const data = response.data;
      if (data && data.list) return { code: 0, data: { list: data.list } };
      if (data && data.data && data.data.list) return { code: 0, data: data.data };
    } catch (e) {
      log('WARN', `TRX draw API failed (${url}): ${e.message}`);
    }
  }

  if (!session) return { code: -1, msg: 'No session for fallback' };

  try {
    const body = {
      pageNo: 1,
      pageSize: 10,
      gameCode: 'TrxWinGo_1M',
      language: 7,
      random: '367817611041',
    };
    body.signature = generateSignature(body).toUpperCase();
    body.timestamp = Math.floor(Date.now() / 1000);
    const response = await session.post('GetHistoryIssuePage', body);
    return response.data;
  } catch (e) {
    return { error: e.message };
  }
}

async function getRecentBets(session) {
  const body = {
    pageNo: 1,
    pageSize: 10,
    language: 7,
    random: '71ebd56cff7d4679971c482807c33f6f',
  };
  body.signature = generateSignature(body).toUpperCase();
  body.timestamp = Math.floor(Date.now() / 1000);

  try {
    const response = await session.post('GetBetRecord', body);
    const data = response.data;
    if (data && data.code === 0 && data.data && data.data.list) {
      return data.data.list;
    }
    return [];
  } catch (e) {
    log('ERROR', `GetBetRecord error: ${e.message}`);
    return [];
  }
}

function mapSelectTypeToChoice(selectType) {
  const t = parseInt(selectType, 10);
  if (t === 13) return 'B';
  if (t === 14) return 'S';
  if (t === 11) return 'G';
  if (t === 12) return 'V';
  if (t === 10) return 'R';
  return String(selectType ?? '?');
}

function mapBetRecord(item) {
  const period =
    item.issueNumber || item.issuenumber || item.period || item.issue || '';
  const amount = parseFloat(item.amount ?? item.betAmount ?? item.money ?? 0) || 0;
  const selectType = item.selectType ?? item.select_type ?? item.betContent;
  const choice = mapSelectTypeToChoice(selectType);
  const resultNumber =
    item.number ?? item.result ?? item.openNumber ?? item.gameResult ?? null;

  let state = item.state ?? item.status ?? item.settleState;
  let result = 'PENDING';
  let profit = parseFloat(item.profit ?? item.winAmount ?? item.bonus ?? 0) || 0;

  const stateStr = String(state).toUpperCase();
  if (state === 1 || stateStr === 'WIN' || stateStr === '1') {
    result = 'WIN';
    if (!profit && item.winAmount) profit = parseFloat(item.winAmount) || 0;
  } else if (state === 2 || stateStr === 'LOSE' || stateStr === 'LOSS' || stateStr === '2') {
    result = 'LOSE';
    if (!profit) profit = -amount;
  } else if (profit > 0) {
    result = 'WIN';
  } else if (profit < 0) {
    result = 'LOSE';
  }

  return {
    period: String(period),
    choice,
    amount,
    result,
    profit,
    resultNumber: resultNumber !== null && resultNumber !== undefined ? String(resultNumber) : null,
  };
}

function mapGameResult(item) {
  const period = item.issueNumber || item.issuenumber || item.period || '';
  const number = item.number ?? item.openNumber ?? item.result ?? '';
  const n = parseInt(number, 10);
  return {
    period: String(period),
    number: String(number),
    bs: numberToBS(n),
    blockTime: item.blockTime || item.block_time || item.openTime || null,
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
      resolve(req.body);
      return;
    }
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(payload));
}

function sessionFromCreds(creds) {
  if (!creds || !creds.token || !creds.baseUrl) return null;
  return createSession(creds.baseUrl, creds.token, creds.tokenHeader || 'Bearer ');
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const action =
      (req.query && req.query.action) ||
      url.searchParams.get('action') ||
      '';
    const body = req.method === 'POST' ? await readBody(req) : {};
    const q = req.query || Object.fromEntries(url.searchParams.entries());

    // ── login ──
    if (action === 'login') {
      const { phone, password, site } = body;
      if (!phone || !password) {
        sendJson(res, 400, { success: false, error: 'Phone and password required' });
        return;
      }
      const selected = site || '6Lottery';
      const result = await loginRequest(phone, password, selected);
      if (!result.session) {
        sendJson(res, 200, {
          success: false,
          error: result.response?.msg || result.response?.error || 'Login failed',
        });
        return;
      }
      const user = await getUserInfo(result.session);
      const balance =
        (user && user.balance !== undefined ? parseFloat(user.balance) : null) ??
        (await getBalance(result.session)) ??
        0;

      sendJson(res, 200, {
        success: true,
        token: result.token,
        tokenHeader: result.tokenHeader,
        baseUrl: result.baseUrl,
        balance,
        user: user || { nickname: phone, username: phone },
      });
      return;
    }

    // ── getBalance ──
    if (action === 'getBalance') {
      const session = sessionFromCreds(body);
      if (!session) {
        sendJson(res, 401, { success: false, error: 'Not authenticated' });
        return;
      }
      const balance = await getBalance(session);
      if (balance === null) {
        sendJson(res, 200, { success: false, error: 'Could not fetch balance' });
        return;
      }
      sendJson(res, 200, { success: true, balance });
      return;
    }

    // ── getIssue ──
    if (action === 'getIssue') {
      const creds = {
        token: body.token || q.token,
        tokenHeader: body.tokenHeader || q.tokenHeader,
        baseUrl: body.baseUrl || q.baseUrl,
      };
      const session = sessionFromCreds(creds);
      if (!session) {
        sendJson(res, 401, { success: false, error: 'Not authenticated' });
        return;
      }
      const issueRes = await getGameIssue(session);
      if (issueRes.error || issueRes.code !== 0) {
        sendJson(res, 200, {
          success: false,
          error: issueRes.msg || issueRes.error || 'Failed to get issue',
        });
        return;
      }
      const issueNumber =
        issueRes.data?.issueNumber ||
        issueRes.data?.issuenumber ||
        issueRes.data?.issue ||
        null;
      sendJson(res, 200, { success: true, issueNumber, data: issueRes.data });
      return;
    }

    // ── placeBet ──
    if (action === 'placeBet') {
      const session = sessionFromCreds(body);
      if (!session) {
        sendJson(res, 401, { success: false, error: 'Not authenticated' });
        return;
      }
      const { issueNumber, selectType, amount } = body;
      if (!issueNumber || !selectType || !amount) {
        sendJson(res, 400, { success: false, error: 'issueNumber, selectType, amount required' });
        return;
      }
      const betRes = await placeBet(session, issueNumber, selectType, amount);
      if (betRes.error || betRes.code !== 0) {
        sendJson(res, 200, {
          success: false,
          error: betRes.msg || betRes.error || 'Bet failed',
        });
        return;
      }
      sendJson(res, 200, { success: true, data: betRes.data || betRes });
      return;
    }

    // ── getGameResults ──
    if (action === 'getGameResults') {
      const creds = {
        token: body.token || q.token,
        tokenHeader: body.tokenHeader || q.tokenHeader,
        baseUrl: body.baseUrl || q.baseUrl,
      };
      const session = sessionFromCreds(creds);
      const raw = await getTRXGameResults(session);
      const list = (raw && raw.data && raw.data.list) || raw?.list || [];
      const mapped = list.slice(0, 10).map(mapGameResult);
      sendJson(res, 200, { success: true, results: mapped });
      return;
    }

    // ── getHistory ──
    if (action === 'getHistory') {
      const session = sessionFromCreds(body);
      if (!session) {
        sendJson(res, 401, { success: false, error: 'Not authenticated' });
        return;
      }
      const list = await getRecentBets(session);
      const history = list.slice(0, 10).map(mapBetRecord);
      sendJson(res, 200, { success: true, history });
      return;
    }

    sendJson(res, 400, { success: false, error: `Unknown action: ${action}` });
  } catch (e) {
    log('ERROR', e.message);
    sendJson(res, 500, { success: false, error: e.message });
  }
};
