import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import cron from 'node-cron';
import { Pool } from 'pg';

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN');

const TRENDING_CHANNEL = process.env.TRENDING_CHANNEL || '@SpyTonTrending';
const LEADERBOARD_CHAT = process.env.LEADERBOARD_CHAT || TRENDING_CHANNEL; // where to post daily board
const TZ = process.env.TZ || 'Africa/Lagos'; // GMT+1

// Admin IDs: comma-separated numeric telegram user ids
const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

// Postgres connection (Railway provides DATABASE_URL when you add Postgres)
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('Missing DATABASE_URL. Add a Postgres database in Railway and set DATABASE_URL.');
}

const DAILY_HOUR = parseInt(process.env.DAILY_HOUR || '20', 10); // 20:00
const DAILY_MIN = parseInt(process.env.DAILY_MIN || '0', 10);

const bot = new Telegraf(BOT_TOKEN);
const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.PGSSLMODE ? { rejectUnauthorized: false } : undefined });

// ===== DB =====
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invites (
      inviter_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      chat_id BIGINT NOT NULL,
      invite_link TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (inviter_id, chat_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS joins (
      chat_id BIGINT NOT NULL,
      inviter_id BIGINT NOT NULL,
      joined_user_id BIGINT NOT NULL,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (chat_id, joined_user_id)
    );
  `);
}

function isAdmin(ctx) {
  return ADMIN_IDS.has(String(ctx.from?.id || ''));
}

async function upsertUser(tgUser) {
  if (!tgUser?.id) return;
  await pool.query(
    `INSERT INTO users (user_id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name;`,
    [tgUser.id, tgUser.username || null, tgUser.first_name || null]
  );
}

async function ensureInviteLink(inviterId, chatId) {
  const existing = await pool.query(
    `SELECT invite_link FROM invites WHERE inviter_id=$1 AND chat_id=$2`,
    [inviterId, chatId]
  );
  if (existing.rowCount > 0) return existing.rows[0].invite_link;

  // Create a unique invite link tied to inviter id.
  // NOTE: Requires bot to be admin in the channel with "Invite Users" permission.
  const inviteLink = await bot.telegram.createChatInviteLink(chatId, {
    name: `ref_${inviterId}`,
    creates_join_request: false,
  });

  await pool.query(
    `INSERT INTO invites (inviter_id, chat_id, invite_link) VALUES ($1,$2,$3)
     ON CONFLICT (inviter_id, chat_id) DO UPDATE SET invite_link=EXCLUDED.invite_link;`,
    [inviterId, chatId, inviteLink.invite_link]
  );

  return inviteLink.invite_link;
}

async function getTrendingChatId() {
  // We need the numeric chat id to create invite links.
  // If user provides TRENDING_CHAT_ID env, use that. Otherwise, resolve via getChat.
  const forced = process.env.TRENDING_CHAT_ID;
  if (forced) return parseInt(forced, 10);

  const chat = await bot.telegram.getChat(TRENDING_CHANNEL);
  return chat.id;
}

async function getTop(chatId, limit=10) {
  const res = await pool.query(
    `SELECT u.user_id, u.username, u.first_name, COUNT(j.joined_user_id)::INT AS joins
     FROM joins j
     JOIN users u ON u.user_id = j.inviter_id
     WHERE j.chat_id = $1
     GROUP BY u.user_id, u.username, u.first_name
     ORDER BY joins DESC
     LIMIT $2;`,
    [chatId, limit]
  );
  return res.rows;
}

function fmtName(row) {
  if (row.username) return `@${row.username}`;
  return row.first_name ? row.first_name : String(row.user_id);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

async function sendLeaderboard() {
  const chatId = await getTrendingChatId();
  const top = await getTop(chatId, 10);

  let text = `🧿 <b>SpyTON Daily Boost Leaderboard</b>\n<b>Channel:</b> ${escapeHtml(TRENDING_CHANNEL)}\n\n`;
  if (!top.length) {
    text += `No referrals yet today.\n\nType /ref in @SpyTonRadarBot to get your invite link.`;
  } else {
    top.forEach((r, i) => {
      text += `${i+1}. <b>${escapeHtml(fmtName(r))}</b> — <b>${r.joins}</b> joins\n`;
    });
    text += `\nGet your invite link: DM <b>@SpyTonRadarBot</b> and type <b>/ref</b>`;
  }

  await bot.telegram.sendMessage(LEADERBOARD_CHAT, text, { parse_mode: 'HTML', disable_web_page_preview: true });
}

// ===== BOT UX =====
bot.start(async (ctx) => {
  await upsertUser(ctx.from);
  const msg =
`🧿 <b>SpyTON Boost Bot</b>

I help you grow <b>${TRENDING_CHANNEL}</b> with a personal invite link.

Commands:
• <b>/ref</b> — Get your referral link
• <b>/stats</b> — See your invites
• <b>/top</b> — Leaderboard

Share your link in groups. Every join counts.`;
  await ctx.reply(msg, { parse_mode: 'HTML', disable_web_page_preview: true });
});

bot.command('ref', async (ctx) => {
  await upsertUser(ctx.from);

  const chatId = await getTrendingChatId();
  try {
    const link = await ensureInviteLink(ctx.from.id, chatId);
    const text =
`✅ <b>Your SpyTON referral link</b>
${escapeHtml(link)}

Share it anywhere. Every user who joins <b>${TRENDING_CHANNEL}</b> with this link counts for you.`;
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (e) {
    console.error(e);
    await ctx.reply(
      `I couldn't create your invite link.\n\nFix: add this bot as <b>Admin</b> in ${TRENDING_CHANNEL} with permission: <b>Invite Users</b>.`,
      { parse_mode: 'HTML' }
    );
  }
});

bot.command('stats', async (ctx) => {
  await upsertUser(ctx.from);
  const chatId = await getTrendingChatId();
  const res = await pool.query(
    `SELECT COUNT(*)::INT AS joins
     FROM joins
     WHERE chat_id=$1 AND inviter_id=$2;`,
    [chatId, ctx.from.id]
  );
  const joins = res.rows?.[0]?.joins ?? 0;
  await ctx.reply(`🧿 Your referrals: ${joins}`, { disable_web_page_preview: true });
});

bot.command('top', async (ctx) => {
  const chatId = await getTrendingChatId();
  const top = await getTop(chatId, 10);
  if (!top.length) {
    await ctx.reply(`No referrals yet.\nDM @SpyTonRadarBot and type /ref to start.`, { disable_web_page_preview: true });
    return;
  }
  let text = `🧿 <b>SpyTON Top Referrers</b>\n\n`;
  top.forEach((r, i) => {
    text += `${i+1}. <b>${escapeHtml(fmtName(r))}</b> — <b>${r.joins}</b>\n`;
  });
  await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true });
});

// ===== Track joins in Trending =====
// Fires only if bot is admin in the channel and receives member updates
bot.on('chat_member', async (ctx) => {
  try {
    const update = ctx.update.chat_member;
    const chatId = update.chat.id;

    // Only track for trending channel id
    const trendingId = await getTrendingChatId();
    if (chatId !== trendingId) return;

    const newMember = update.new_chat_member;
    const oldMember = update.old_chat_member;

    // Detect a new join (left -> member)
    const wasOut = ['left', 'kicked'].includes(oldMember.status);
    const isIn = ['member', 'administrator', 'creator'].includes(newMember.status);
    if (!wasOut || !isIn) return;

    const joinedUser = newMember.user;
    await upsertUser(joinedUser);

    // Telegram provides invite_link used for join in chat_member update
    const inviteLink = update.invite_link?.invite_link;
    if (!inviteLink) return; // join not via our tracked link

    // Find inviter by invite link
    const inv = await pool.query(
      `SELECT inviter_id FROM invites WHERE chat_id=$1 AND invite_link=$2`,
      [chatId, inviteLink]
    );
    if (inv.rowCount === 0) return;

    const inviterId = inv.rows[0].inviter_id;
    if (String(inviterId) === String(joinedUser.id)) return; // no self-ref

    // Store join (dedupe by (chat_id, joined_user_id))
    await pool.query(
      `INSERT INTO joins (chat_id, inviter_id, joined_user_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (chat_id, joined_user_id) DO NOTHING;`,
      [chatId, inviterId, joinedUser.id]
    );
  } catch (e) {
    console.error('chat_member handler error:', e);
  }
});

// ===== Admin: backup & restore =====
bot.command('backup', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const users = await pool.query(`SELECT * FROM users ORDER BY created_at ASC LIMIT 5000;`);
  const invites = await pool.query(`SELECT * FROM invites LIMIT 5000;`);
  const joins = await pool.query(`SELECT * FROM joins LIMIT 100000;`);
  const blob = { users: users.rows, invites: invites.rows, joins: joins.rows, exported_at: new Date().toISOString() };

  const jsonStr = JSON.stringify(blob, null, 2);
  const buf = Buffer.from(jsonStr, 'utf-8');
  await ctx.replyWithDocument({ source: buf, filename: `spyton-referral-backup-${Date.now()}.json` });
});

bot.command('restore', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply('Send the backup JSON file as a document, then I will restore it.', { disable_web_page_preview: true });
});

// Restore handler: admin sends a JSON doc
bot.on('document', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const doc = ctx.message.document;
  if (!doc?.file_name?.endsWith('.json')) return;

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const res = await fetch(fileLink.href);
    const data = await res.json();

    await pool.query('BEGIN');
    // Insert users
    for (const u of (data.users || [])) {
      await pool.query(
        `INSERT INTO users (user_id, username, first_name, created_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name;`,
        [u.user_id, u.username, u.first_name, u.created_at || new Date().toISOString()]
      );
    }
    // Invites
    for (const i of (data.invites || [])) {
      await pool.query(
        `INSERT INTO invites (inviter_id, chat_id, invite_link, created_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (inviter_id, chat_id) DO UPDATE SET invite_link=EXCLUDED.invite_link;`,
        [i.inviter_id, i.chat_id, i.invite_link, i.created_at || new Date().toISOString()]
      );
    }
    // Joins
    for (const j of (data.joins || [])) {
      await pool.query(
        `INSERT INTO joins (chat_id, inviter_id, joined_user_id, joined_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (chat_id, joined_user_id) DO NOTHING;`,
        [j.chat_id, j.inviter_id, j.joined_user_id, j.joined_at || new Date().toISOString()]
      );
    }

    await pool.query('COMMIT');
    await ctx.reply('✅ Restore complete.');
  } catch (e) {
    try { await pool.query('ROLLBACK'); } catch (_) {}
    console.error('restore error:', e);
    await ctx.reply('❌ Restore failed. Ensure the file is a valid backup JSON from /backup.');
  }
});

// ===== Daily leaderboard schedule (20:00 GMT+1 by default) =====
// cron format: "m h * * *"
const cronExpr = `${DAILY_MIN} ${DAILY_HOUR} * * *`;
cron.schedule(cronExpr, async () => {
  try {
    await sendLeaderboard();
  } catch (e) {
    console.error('leaderboard schedule error:', e);
  }
}, { timezone: TZ });

bot.launch().then(async () => {
  await initDb();
  console.log(`SpyTON Referral Bot running ✅`);
  console.log(`Leaderboard schedule: ${cronExpr} TZ=${TZ}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
