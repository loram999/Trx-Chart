# Trx-Chart

Live TRX candlestick chart with **6Lottery / 777BIGWIN** trading integration.

## Features

- **Live Chart** — TRX candlestick (M1 / M15 / H1) with drawing tools, S/R, trend lines, auto-support/resistance
- **AI Prediction** — Confidence-weighted next-issue forecast (B/S signal)
- **Login** — 6Lottery / 777BIGWIN account login (Phone + Password)
- **Quick Trade** — BIG / SMALL one-tap bets under the prediction block
- **Game Results** — Last 10 TRX draws (with period, number, B/S color)
- **History** — Last 10 bets (Win/Lose, amount, period, draw result)
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
| `getHistory` | `{ token, tokenHeader, baseUrl }` | `{ history: [...10] }` |

`selectType`: `13` = BIG, `14` = SMALL, `11` = GREEN, `12` = VIOLET, `10` = RED
