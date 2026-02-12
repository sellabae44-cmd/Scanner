import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';

/**
 * SpyTON Scanner Bot (TON)
 * - Detects a CA in /scan <CA> or when user sends a TON address-like string
 * - Sends a formatted "New Jetton Detected" message with 3 buttons:
 *    1) Buy with Dtrade (fat button)
 *    2) Promote Your Token
 *    3) Trending
 *
 * NOTE: This is the UI layer. You can later plug a real scanner/indexer into sendScannerAlert().
 */

// === CONFIG ===
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in .env');
  process.exit(1);
}

const DTRADE_REF = process.env.DTRADE_REF || '11TYq7LInG'; // your referral code
const PROMOTE_URL = process.env.PROMOTE_URL || 'https://t.me/Vseeton';
const TRENDING_URL = process.env.TRENDING_URL || 'https://t.me/SpyTonTrending';

// Optional explorer base (Tonviewer works well)
const EXPLORER_BASE = process.env.EXPLORER_BASE || 'https://tonviewer.com/';

const bot = new Telegraf(BOT_TOKEN);

// Telegram "start" payload allowed chars: A-Z a-z 0-9 _ -
// Max length: 64 chars. TON friendly addresses are usually base64url-safe.
function makeStartPayload(ref, ca) {
  const raw = `${ref}_${ca}`;
  // sanitize any unsupported chars just in case:
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, '-');
  return safe.slice(0, 64);
}

function buildKeyboard(ca) {
  const payload = makeStartPayload(DTRADE_REF, ca);
  const dtradeUrl = `https://t.me/dtrade?start=${payload}`;

  return Markup.inlineKeyboard([
    [Markup.button.url('🟦 Buy with Dtrade', dtradeUrl)],
    [
      Markup.button.url('📣 Promote Your Token', PROMOTE_URL),
      Markup.button.url('🔥 Trending', TRENDING_URL),
    ],
  ]);
}

function formatLinksRow({ ca, deployer }) {
  const codeUrl = `${EXPLORER_BASE}${encodeURIComponent(ca)}`;
  const deployerUrl = deployer ? `${EXPLORER_BASE}${encodeURIComponent(deployer)}` : `${EXPLORER_BASE}${encodeURIComponent(ca)}`;
  const holdersUrl = `${EXPLORER_BASE}${encodeURIComponent(ca)}`;

  // Telegram HTML parse mode
  return `<a href="${codeUrl}">Code</a> | <a href="${deployerUrl}">Deployer</a> | <a href="${holdersUrl}">Holders</a>`;
}

function renderScannerMessage(data) {
  const {
    name = 'Unknown',
    symbol = 'UNKNOWN',
    supply = '—',
    decimals = '—',
    ca,
    deployer = '—',
    adminMint = '—',
    creatorBalance = '—',
    linksText = 'TG | Web | X (if found)',
  } = data;

  const body =
`🧿 <b>SpyTON Scanner — New Jetton Detected</b>

<b>Name:</b> ${escapeHtml(name)}
<b>Symbol:</b> ${escapeHtml(symbol)}
<b>Supply:</b> ${escapeHtml(String(supply))} (${escapeHtml(String(decimals))} decimals)

<b>CA:</b> <code>${escapeHtml(ca)}</code>
<b>Deployer:</b> <code>${escapeHtml(deployer)}</code>
<b>Admin/Mint:</b> ${escapeHtml(adminMint)}
<b>Creator Balance:</b> ${escapeHtml(String(creatorBalance))}

<b>Links:</b> ${escapeHtml(linksText)}

${formatLinksRow({ ca, deployer })}`;

  return body;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Basic TON friendly address detection (looks like EQ... / UQ... base64url)
function extractTonAddress(text) {
  if (!text) return null;
  const m = String(text).match(/\b[EU]Q[A-Za-z0-9_-]{45,70}\b/);
  return m ? m[0] : null;
}

/**
 * Send a scanner alert (you can call this from your real scanner/indexer).
 * @param {string|number} chatId Telegram chat id
 * @param {object} data Message data
 */
export async function sendScannerAlert(chatId, data) {
  if (!data?.ca) throw new Error('sendScannerAlert requires data.ca');
  await bot.telegram.sendMessage(chatId, renderScannerMessage(data), {
    parse_mode: 'HTML',
    ...buildKeyboard(data.ca),
    disable_web_page_preview: true,
  });
}

// === COMMANDS ===
bot.start(async (ctx) => {
  const msg =
`🧿 <b>SpyTON Scanner</b>

Send a token CA (TON address) or use:
/scan <code>EQ...</code>

I will reply with the SpyTON Scanner card + 3 buttons.`;
  await ctx.reply(msg, { parse_mode: 'HTML', disable_web_page_preview: true });
});

bot.command('scan', async (ctx) => {
  const parts = ctx.message.text.split(/\s+/).slice(1);
  const ca = parts[0] ? extractTonAddress(parts[0]) : null;

  if (!ca) {
    await ctx.reply('Send like: /scan EQ...', { disable_web_page_preview: true });
    return;
  }

  // Demo values — replace with real fetched token info later.
  const demo = {
    name: 'Lumina',
    symbol: 'LMN',
    supply: '1,000,000,000',
    decimals: 9,
    ca,
    deployer: 'EQ...deployer',
    adminMint: '✅ Mintable / ⚠️ Admin set',
    creatorBalance: '47.57 TON',
    linksText: 'TG | Web | X (if found)',
  };

  await ctx.reply(renderScannerMessage(demo), {
    parse_mode: 'HTML',
    ...buildKeyboard(ca),
    disable_web_page_preview: true,
  });
});

// If user just sends an address, auto-scan
bot.on('text', async (ctx) => {
  const ca = extractTonAddress(ctx.message.text);
  if (!ca) return;

  const demo = {
    name: 'Unknown',
    symbol: 'UNKNOWN',
    supply: '—',
    decimals: '—',
    ca,
    deployer: '—',
    adminMint: '—',
    creatorBalance: '—',
    linksText: 'TG | Web | X (if found)',
  };

  await ctx.reply(renderScannerMessage(demo), {
    parse_mode: 'HTML',
    ...buildKeyboard(ca),
    disable_web_page_preview: true,
  });
});

bot.catch((err) => {
  console.error('Bot error:', err);
});

bot.launch().then(() => console.log('SpyTON Scanner bot is running ✅'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
