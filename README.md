# Trx-Chart

Live TRX candlestick chart with **6Lottery / 777BIGWIN** trading integration.

## Features

- **Live Chart** — TRX candlestick (M1 / M15 / H1) with drawing tools, S/R, trend lines, auto-support/resistance
- **AI Prediction** — Confidence-weighted next-issue forecast (B/S signal)
- **Login** — 6Lottery / 777BIGWIN account login (Phone + Password)
- **Quick Trade** — BIG / SMALL one-tap bets under the prediction block
- **Game Results** — Last 10 TRX draws (with period, number, B/S color)
- **History** — Your account's bet records (Win/Lose, amount, period, draw result) — auto-detects provider from login, paginated
- **Vercel Ready** — Static `index.html` + serverless `api/trx.js`

## Deploy on Vercel

1. Import `loram999/Trx-Chart` in Vercel
2. Framework Preset: **Other**
3. No env vars required — credentials are stored in the user browser only

## Local development

```bash
npx serve .
```

The `api/trx.js` serverless function will be unavailable locally — deploy to Vercel for live trading.

## API endpoints (Vercel serverless)

`POST /api/trx?action=<action>`

| Action | Body | Returns |
|---|---|---|
| `login` | `{ phone, password, site }` | `{ token, baseUrl, balance, user }` |
| `getBalance` | `{ token, tokenHeader, baseUrl }` | `{ balance }` |
| `getIssue` | `{ token, tokenHeader, baseUrl }` | `{ issueNumber }` |
| `placeBet` | `{ token, tokenHeader, baseUrl, issueNumber, selectType, amount }` | `{ data }` |
| `getGameResults` | `{ token?, tokenHeader?, baseUrl? }` | `{ results: [...10] }` |
| `getHistory` | `{ token, tokenHeader, baseUrl, pageNo?, pageSize?, source? }` | `{ history, pageNo, pageSize, total, hasMore }` |

`selectType`: `13` = BIG, `14` = SMALL, `11` = GREEN, `12` = VIOLET, `10` = RED

### `getHistory` details

- **Default source**: `GetTRXMyEmerdList` (account's full bet list). Pass `"source": "legacy"` to fall back to `GetBetRecord`.
- **Auto-detect provider** from `baseUrl` — `https://6lotteryapi.com` → `6Lottery`, `https://api.bigwinqaz.com` → `777BIGWIN`. The correct `Ar-Origin` header is applied automatically.
- **Pagination**: `pageNo` (1-based, default 1), `pageSize` (default 20, max 100). Response includes `total` and `hasMore` when the upstream provides them.

## `/api/trx-data` — public draw history

`GET /api/trx-data?pageNo=1&pageSize=2000&limit=10000`

Returns the public TRX draw list used by the chart. Supports `pageNo`/`pageSize` query params (the upstream `GetHistoryIssuePage.json` may cap the total); the response is now wrapped:

```json
{ "list": [...], "pageNo": 1, "pageSize": 2000, "returned": 2000, "total": null, "hasMore": true }
```

The frontend falls back to plain-array handling if the server returns the legacy shape.

## Token security

- Bearer tokens are **never** stored in this repo. They live in the user's browser localStorage (`trx_credentials`) and are forwarded to the serverless functions per request.
- If you self-host on Vercel and want a server-side default token, add `VITE_6LOTTERY_TOKEN` / `VITE_777BIGWIN_TOKEN` to your project env vars and read via `process.env`. Never commit tokens.
- **Rotate tokens regularly** — they expire (see JWT `exp` claim) and contain personal data (phone, IP, user id).
