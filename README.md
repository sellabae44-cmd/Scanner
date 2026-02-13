# SpyTON Scanner Bot (TON)

A Telegram bot that:
1) **Scans** a Jetton contract address (CA) and returns a SpyTON-style card + 3 buttons  
2) **Auto-posts new Jetton deployments** to your scanner channel (like SunTools / SunPump new-tokens)

## 1) Quick start (Railway)

1. Push this repo to GitHub (or upload ZIP to Railway)
2. In Railway → Variables, set:

- `BOT_TOKEN` (required)
- `TONCENTER_API_KEY` (recommended)
- `SCANNER_CHANNEL` (optional but needed for auto-post)  
  Example: `@SpyTonScanner` or `-1001234567890`

3. Deploy.
4. Add the bot as **ADMIN** to your channel.

## 2) How to use in Telegram

- `/start`
- `/scan EQ...`
- Or just send an address `EQ...` and it will respond.

## 3) Auto-post new tokens (Jettons)

When `SCANNER_CHANNEL` is set, the bot polls TON Center v3 endpoint:

- `/api/v3/jetton/masters` (latest Jetton masters)

When a new Jetton master appears, it posts the SpyTON Scanner card to your channel.

> Note: “Any new token on TON” is interpreted as “new Jetton master contract indexed by TON Center”.

## 4) Customize the 3 buttons

Edit Railway Variables:

- `DTRADE_REF` → your Dtrade referral code (the bot auto-adds `_CA` into the start payload)
- `PROMOTE_URL`
- `TRENDING_URL`

## 5) Notes / troubleshooting

- If deployer link was wrong before: this version derives deployer from the **first transaction** on the jetton master (ascending LT).
- If you see `Unknown` metadata, the jetton may not have on-chain metadata / not indexed yet.
- If auto-post is not working:
  - ensure the bot is admin in the channel
  - ensure `SCANNER_CHANNEL` is correct (try `@channelusername`)
  - set a `TONCENTER_API_KEY` to avoid rate limits



### Metadata & Social Links
This bot tries to auto-fill Name/Symbol/Links from off-chain metadata (often stored in `uri` / `ipfs://...`).
Set `IPFS_GATEWAY` if you prefer a different gateway.


### Deployer address
Deployer is shown shortened (e.g. `0:abcd…wxyz`) and is clickable.
