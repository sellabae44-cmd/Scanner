# SpyTON Scanner Bot (Telegram)

This repo sends the **SpyTON Scanner — New Jetton Detected** card with **exactly 3 buttons**:

1. **🟦 Buy with Dtrade** (fat / full-width row)
2. **📣 Promote Your Token**
3. **🔥 Trending**

It auto-attaches the CA into the Dtrade deep link using Telegram `start=` payload:
`https://t.me/dtrade?start=<REF>_<CA>`

## Setup

1) Install deps:
```bash
npm install
```

2) Create `.env` from `.env.example`:
```bash
cp .env.example .env
```

3) Put your bot token:
- `BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN`

4) Run:
```bash
npm start
```

## Usage

- Send a token CA (TON address like `EQ...`) to the bot
- Or use: `/scan EQ...`

## Notes
- Telegram `start` payload is limited to 64 characters and uses only: `A-Z a-z 0-9 _ -`
- TON friendly addresses are base64url and usually safe.
