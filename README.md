# SpyTON Referral / Boost Bot (Best)

This bot grows **@SpyTonTrending** by giving users their own invite link and tracking joins.

## What you get
- Postgres persistence (data survives redeploys)
- `/ref` to generate unique invite link
- Tracks which invite link a user joined with
- Daily leaderboard posted at **20:00 (GMT+1)** by default
- Admin `/backup` and restore via sending the backup JSON back to the bot

## Railway setup (recommended)
1) Deploy this repo to Railway
2) Add a **Postgres** database in Railway
3) Ensure `DATABASE_URL` is available (Railway sets it automatically)
4) Set Variables:
   - `BOT_TOKEN` = your bot token
   - `TRENDING_CHANNEL` = @SpyTonTrending
   - `TZ` = Africa/Lagos
   - `DAILY_HOUR` = 20
   - `DAILY_MIN` = 0
   - `ADMIN_IDS` = your numeric Telegram user id (comma-separated list)

5) Add the bot as **Admin** in @SpyTonTrending with permissions:
   - Invite Users (required)
   - Post Messages (required if posting leaderboard directly in channel)
   - Delete Messages (optional)

## Commands
- `/ref` - get referral link
- `/stats` - your join count
- `/top` - top referrers
- Admin: `/backup` to export data, send backup JSON to restore

## Notes
Telegram only provides the used invite link in join updates if the bot has access to those updates (admin in the channel).
