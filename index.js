import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';

/**
 * SpyTON Scanner Bot (TON)
 *
 * Features
 * 1) Manual scan:
 *    - /scan <CA>
 *    - or send a jetton master address (EQ... / UQ...) in chat
 *
 * 2) Auto-post new Jetton deployments to a channel (like sunpump_new_tokens):
 *    - Polls TON Center API v3 for latest Jetton masters
 *    - When a new master appears, bot posts the Scanner card to your channel
 *
 * Requirements for auto-posting:
 * - Add the bot as ADMIN in your channel
 * - Set SCANNER_CHANNEL to @channelusername OR numeric channel id (-100...)
 *
 * Env
 * - BOT_TOKEN (required)
 * - TONCENTER_API_KEY (optional but recommended)
 * - TONCENTER_BASE (default https://toncenter.com)
 * - SCANNER_CHANNEL (optional; enable auto-post)
 * - POLL_INTERVAL_SEC (default 25)
 *
 * Buttons (your links)
 * - DTRADE_REF (default 11TYq7LInG)  -> https://t.me/dtrade?start=<ref>_<ca>
 * - PROMOTE_URL (default https://t.me/Vseeton)
 * - TRENDING_URL (default https://t.me/SpyTonTrending)
 */

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in .env');
  process.exit(1);
}

const TONCENTER_BASE = (process.env.TONCENTER_BASE || 'https://toncenter.com').replace(/\/+$/, '');
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || ''; // optional but recommended

const SCANNER_CHANNEL = process.env.SCANNER_CHANNEL || ''; // @channel OR -100...
const POLL_INTERVAL_SEC = Number(process.env.POLL_INTERVAL_SEC || 25);

const DTRADE_REF = process.env.DTRADE_REF || '11TYq7LInG';
const PROMOTE_URL = process.env.PROMOTE_URL || 'https://t.me/Vseeton';
const TRENDING_URL = process.env.TRENDING_URL || 'https://t.me/SpyTonTrending';

// Explorers
const CODE_EXPLORER_BASE = (process.env.CODE_EXPLORER_BASE || 'https://tonviewer.com/').replace(/\/+$/, '') + '/';
const HOLDERS_EXPLORER_BASE = (process.env.HOLDERS_EXPLORER_BASE || 'https://tonscan.org/jetton/').replace(/\/+$/, '') + '/';
const ADDRESS_EXPLORER_BASE = (process.env.ADDRESS_EXPLORER_BASE || 'https://tonscan.org/address/').replace(/\/+$/, '') + '/';

const bot = new Telegraf(BOT_TOKEN);

// Telegram "start" payload allowed chars: A-Z a-z 0-9 _ - ; max 64 chars.
function makeStartPayload(ref, ca) {
  const raw = `${ref}_${ca}`;
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
  const codeUrl = `${CODE_EXPLORER_BASE}${encodeURIComponent(ca)}`;
  const deployerUrl = deployer && deployer !== '—'
    ? `${ADDRESS_EXPLORER_BASE}${encodeURIComponent(deployer)}`
    : `${CODE_EXPLORER_BASE}${encodeURIComponent(ca)}`;
  const holdersUrl = `${HOLDERS_EXPLORER_BASE}${encodeURIComponent(ca)}`;

  // Telegram HTML parse mode
  return `<a href="${codeUrl}">Code</a> | <a href="${deployerUrl}">Deployer</a> | <a href="${holdersUrl}">Holders</a>`;
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

function toTon(nano) {
  const v = Number(nano);
  if (!Number.isFinite(v)) return null;
  return v / 1e9;
}

function formatNumberWithCommas(n) {
  const s = String(n);
  // handle bigint-like strings
  const parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function formatSupply(totalSupplyRaw, decimals) {
  if (totalSupplyRaw == null) return '—';
  const rawStr = String(totalSupplyRaw);

  // If decimals is unknown, show raw integer.
  const dec = Number(decimals);
  if (!Number.isFinite(dec) || dec < 0 || dec > 18) return formatNumberWithCommas(rawStr);

  // BigInt safe formatting
  try {
    const bi = BigInt(rawStr);
    const base = BigInt(10) ** BigInt(dec);
    const intPart = bi / base;
    const fracPart = bi % base;

    let frac = fracPart.toString().padStart(dec, '0');
    // trim trailing zeros
    frac = frac.replace(/0+$/, '');
    const out = frac ? `${intPart.toString()}.${frac}` : intPart.toString();
    return formatNumberWithCommas(out);
  } catch {
    return formatNumberWithCommas(rawStr);
  }
}

function pickMeta(content, keys) {
  if (!content || typeof content !== 'object') return null;
  for (const k of keys) {
    if (content[k] != null && String(content[k]).trim() !== '') return content[k];
  }
  return null;
}

function buildSocialLinks(jettonContent) {
  const content = jettonContent || {};
  const tg =
    pickMeta(content, ['telegram', 'tg', 'telegram_url', 'telegramUrl']) ||
    (content.social && pickMeta(content.social, ['telegram', 'tg']));
  const web =
    pickMeta(content, ['website', 'site', 'url', 'homepage']) ||
    (content.social && pickMeta(content.social, ['website', 'site', 'url']));
  const x =
    pickMeta(content, ['twitter', 'x', 'twitter_url', 'x_url']) ||
    (content.social && pickMeta(content.social, ['twitter', 'x']));

  const parts = [];
  if (tg) parts.push(`<a href="${escapeHtml(String(tg))}">TG</a>`);
  else parts.push('TG ?');

  if (web) parts.push(`<a href="${escapeHtml(String(web))}">Web</a>`);
  else parts.push('Web ?');

  if (x) parts.push(`<a href="${escapeHtml(String(x))}">X</a>`);
  else parts.push('X ?');

  return parts.join(' | ');
}

async function toncenterGet(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) qs.append(k, String(item));
    } else {
      qs.append(k, String(v));
    }
  }

  const url = `${TONCENTER_BASE}${path}?${qs.toString()}`;
  const headers = { accept: 'application/json' };
  if (TONCENTER_API_KEY) headers['X-API-Key'] = TONCENTER_API_KEY;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`TONCenter ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchJettonMaster(ca) {
  // Returns { address, admin_address, jetton_content, mintable, total_supply, last_transaction_lt }
  const r = await toncenterGet('/api/v3/jetton/masters', { address: [ca], limit: 1, offset: 0 });
  const jm = (r && r.jetton_masters && r.jetton_masters[0]) ? r.jetton_masters[0] : null;
  return jm;
}

async function fetchDeployerFromFirstTx(ca) {
  // First tx (ascending lt). Usually deployer wallet is in in_msg.source for internal deploy.
  const r = await toncenterGet('/api/v3/transactions', { account: [ca], limit: 1, offset: 0, sort: 'asc' });
  const tx = (r && r.transactions && r.transactions[0]) ? r.transactions[0] : null;
  const src = tx?.in_msg?.source;
  return src && String(src).trim() ? String(src) : '—';
}

async function fetchAccountBalanceTon(address) {
  if (!address || address === '—') return null;
  const r = await toncenterGet('/api/v3/accountStates', { address: [address], limit: 1, offset: 0 });
  const st = (r && r.account_states && r.account_states[0]) ? r.account_states[0] : null;
  const bal = st?.balance;
  const ton = toTon(bal);
  return ton == null ? null : ton;
}

function renderScannerMessage(data) {
  const {
    name = 'Unknown',
    symbol = 'UNKNOWN',
    supply = '—',
    decimals = '—',
    ca,
    deployer = '—',
    mintable = null,
    adminAddress = null,
    creatorBalanceTon = null,
    socialLinks = 'TG ? | Web ? | X ?',
  } = data;

  const mintText =
    mintable === true ? '✅ Mintable' : mintable === false ? '❌ Not mintable' : '—';
  const adminText =
    adminAddress && adminAddress !== '—' ? '⚠️ Admin set' : '✅ Admin renounced';

  const creatorBalText =
    creatorBalanceTon == null ? '—' : `${creatorBalanceTon.toFixed(2)} TON`;

  const body =
`🧿 <b>SpyTON Scanner — New Jetton Detected</b>

<b>Name:</b> ${escapeHtml(name)}
<b>Symbol:</b> ${escapeHtml(symbol)}
<b>Supply:</b> ${escapeHtml(String(supply))} (${escapeHtml(String(decimals))} decimals)

<b>CA:</b>
<code>${escapeHtml(ca)}</code>
<b>Deployer:</b> <code>${escapeHtml(deployer)}</code>
<b>Admin/Mint:</b> ${mintText} / ${adminText}
<b>Creator Balance:</b> ${escapeHtml(creatorBalText)}

<b>Links:</b> ${socialLinks}

${formatLinksRow({ ca, deployer })}`;

  return body;
}

async function buildJettonCard(ca) {
  const master = await fetchJettonMaster(ca);
  if (!master) {
    // Not a jetton master or not indexed yet
    return {
      ca,
      name: 'Unknown',
      symbol: 'UNKNOWN',
      supply: '—',
      decimals: '—',
      deployer: '—',
      mintable: null,
      adminAddress: '—',
      creatorBalanceTon: null,
      socialLinks: 'TG ? | Web ? | X ?',
    };
  }

  const content = master.jetton_content || {};
  const name = pickMeta(content, ['name', 'title']) || 'Unknown';
  const symbol = pickMeta(content, ['symbol', 'ticker']) || 'UNKNOWN';
  const decimals = Number(pickMeta(content, ['decimals'])) || 9;

  const supply = formatSupply(master.total_supply, decimals);
  const deployer = await fetchDeployerFromFirstTx(ca);
  const creatorBalanceTon = await fetchAccountBalanceTon(deployer);
  const socialLinks = buildSocialLinks(content);

  return {
    ca,
    name,
    symbol,
    supply,
    decimals,
    deployer,
    mintable: master.mintable,
    adminAddress: master.admin_address || '—',
    creatorBalanceTon,
    socialLinks,
  };
}

/**
 * Send scanner alert to any chat/channel
 */
export async function sendScannerAlert(chatId, ca) {
  const data = await buildJettonCard(ca);

  await bot.telegram.sendMessage(chatId, renderScannerMessage(data), {
    parse_mode: 'HTML',
    ...buildKeyboard(ca),
    disable_web_page_preview: true,
  });
}

// === COMMANDS ===
bot.start(async (ctx) => {
  const msg =
`🧿 <b>SpyTON Scanner</b>

Send a Jetton CA (TON address) or use:
<code>/scan EQ...</code>

If you set <b>SCANNER_CHANNEL</b>, I will also auto-post new Jetton deployments to your channel.`;
  await ctx.reply(msg, { parse_mode: 'HTML', disable_web_page_preview: true });
});

bot.command('scan', async (ctx) => {
  const parts = ctx.message.text.split(/\s+/).slice(1);
  const ca = parts[0] ? extractTonAddress(parts[0]) : null;

  if (!ca) {
    await ctx.reply('Send like: /scan EQ...', { disable_web_page_preview: true });
    return;
  }

  try {
    const data = await buildJettonCard(ca);
    await ctx.reply(renderScannerMessage(data), {
      parse_mode: 'HTML',
      ...buildKeyboard(ca),
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error(e);
    await ctx.reply('Scanner error. Check TONCENTER_API_KEY / TONCENTER_BASE and try again.', { disable_web_page_preview: true });
  }
});

// If user just sends an address, auto-scan (reply in same chat)
bot.on('text', async (ctx) => {
  const ca = extractTonAddress(ctx.message.text);
  if (!ca) return;

  try {
    const data = await buildJettonCard(ca);
    await ctx.reply(renderScannerMessage(data), {
      parse_mode: 'HTML',
      ...buildKeyboard(ca),
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error(e);
    // silent fail in chat to avoid spam
  }
});

// === AUTO WATCHER ===
let watcherStarted = false;
let lastSeenLt = 0n; // BigInt

async function initLastSeenLt() {
  const r = await toncenterGet('/api/v3/jetton/masters', { limit: 50, offset: 0 });
  const list = (r && r.jetton_masters) ? r.jetton_masters : [];
  const lts = list.map((j) => {
    try { return BigInt(j.last_transaction_lt || '0'); } catch { return 0n; }
  });
  lastSeenLt = lts.reduce((a, b) => (b > a ? b : a), 0n);
}

async function pollNewJettons() {
  const r = await toncenterGet('/api/v3/jetton/masters', { limit: 100, offset: 0 });
  const list = (r && r.jetton_masters) ? r.jetton_masters : [];

  // sort by lt desc
  const sorted = list
    .map((j) => {
      let lt = 0n;
      try { lt = BigInt(j.last_transaction_lt || '0'); } catch { lt = 0n; }
      return { ...j, _lt: lt };
    })
    .sort((a, b) => (a._lt === b._lt ? 0 : a._lt > b._lt ? -1 : 1));

  const fresh = sorted.filter((j) => j._lt > lastSeenLt);

  if (fresh.length === 0) return;

  // post oldest first so channel reads chronologically
  const toPost = fresh.sort((a, b) => (a._lt === b._lt ? 0 : a._lt > b._lt ? 1 : -1));

  // move cursor
  lastSeenLt = fresh.reduce((a, j) => (j._lt > a ? j._lt : a), lastSeenLt);

  for (const j of toPost) {
    const ca = j.address;
    try {
      await sendScannerAlert(SCANNER_CHANNEL, ca);
      // light delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      console.error('Auto-post failed:', e?.message || e);
    }
  }
}

async function startWatcherIfConfigured() {
  if (watcherStarted) return;
  if (!SCANNER_CHANNEL) return;

  watcherStarted = true;
  try {
    await initLastSeenLt();
    console.log('Watcher ready. lastSeenLt=', lastSeenLt.toString());
  } catch (e) {
    console.error('Watcher init failed:', e?.message || e);
  }

  setInterval(async () => {
    try {
      await pollNewJettons();
    } catch (e) {
      console.error('Watcher poll error:', e?.message || e);
    }
  }, Math.max(10, POLL_INTERVAL_SEC) * 1000);
}

bot.catch((err) => {
  console.error('Bot error:', err);
});

bot.launch().then(async () => {
  console.log('SpyTON Scanner bot is running ✅');
  await startWatcherIfConfigured();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
