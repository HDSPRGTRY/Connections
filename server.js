const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const path = require('path');
const crypto = require('crypto');

// Express server for Render health checks
const app = express();
app.use(express.json()); // Parse JSON request bodies
app.get('/', (req, res) => res.send('Discord Bot Running'));

// Luau obfuscator page (static UI + shared engine, same deploy)
// NOTE: /modules/*.js must be served as application/javascript or the
// browser refuses the dynamic import() with
// "Failed to fetch dynamically imported module".
const JS_MIME = 'application/javascript; charset=utf-8';
function sendJs(res, absPath) {
    res.type('.js');
    res.setHeader('Content-Type', JS_MIME);
    res.sendFile(absPath, (err) => {
        if (err && !res.headersSent) {
            console.error('[static] send failed:', absPath, err.message);
            res.status(err.status || 404).send('Not found');
        }
    });
}
app.get(['/obfuscator', '/obfuscator/'], (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'obfuscator.html'), (err) => {
        if (err && !res.headersSent) {
            console.error('[static] obfuscator.html missing:', err.message);
            res.status(404).send('obfuscator.html not found on server');
        }
    }));
app.get('/engine.js', (req, res) =>
    sendJs(res, path.join(__dirname, 'obfuscator', 'engine.js')));
app.get('/modules/:file', (req, res) => {
    const f = String(req.params.file || '');
    // Only allow plain .js filenames — no dirs, no traversal.
    if (!/^[A-Za-z0-9_.-]+\.js$/.test(f)) {
        return res.status(400).send('Bad module name');
    }
    sendJs(res, path.join(__dirname, 'obfuscator', 'modules', f));
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Never let Discord / misc async errors take Express down (would 503 every
// route, including /modules/*.js which the obfuscator dynamic-imports).
process.on('unhandledRejection', (err) => {
    console.error('[process] unhandledRejection (kept alive):', err && err.message ? err.message : err);
});
process.on('uncaughtException', (err) => {
    console.error('[process] uncaughtException (kept alive):', err && err.message ? err.message : err);
});

// Keep-alive: ping server every 25 seconds to prevent cold starts
// (guarded: Node 16 has no global fetch — a bare fetch() would throw
// synchronously and could crash the process on old runtimes).
const HAS_FETCH = typeof fetch !== 'undefined';
if (HAS_FETCH) {
    const keepAliveTimer = setInterval(() => {
        try {
            Promise.resolve(fetch(`http://localhost:${PORT}`)).catch(err =>
                console.error('Keep-alive ping failed:', err && err.message ? err.message : err));
        } catch (err) {
            console.error('Keep-alive ping failed:', err && err.message ? err.message : err);
        }
    }, 25000);
    if (keepAliveTimer.unref) keepAliveTimer.unref(); // does not keep the process alive by itself
} else {
    console.warn('[server] global fetch unavailable (Node <18) — keep-alive ping disabled');
}

// Discord Bot Setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const CHANNEL_ID = process.env.CHANNEL_ID; // Discord channel ID for sync
const BOT_TOKEN = process.env.BOT_TOKEN;

// Store user states: username -> { message, data }
const userStates = new Map();

client.on('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    console.log(`Syncing in channel: ${CHANNEL_ID}`);
});

// Handle user messages (weapon updates)
client.on('messageCreate', async (message) => {
    // Ignore bot messages and messages from wrong channel
    if (message.author.bot || message.channelId !== CHANNEL_ID) return;

    try {
        const data = JSON.parse(message.content);

        if (data.username && data.gun !== undefined && data.knife !== undefined) {
            // Store or update user state
            const existingState = userStates.get(data.username);

            if (existingState && existingState.message) {
                // Edit existing message
                await existingState.message.edit(message.content);
                userStates.set(data.username, {
                    message: existingState.message,
                    data: data
                });
            } else {
                // Send new message
                const sentMessage = await message.channel.send(message.content);
                userStates.set(data.username, {
                    message: sentMessage,
                    data: data
                });
            }

            // Delete user's command message
            await message.delete();
        }
    } catch (error) {
        console.error('Error processing message:', error);
    }
});

// API endpoint to get all user states (for polling fallback)
app.get('/states', (req, res) => {
    const states = {};
    userStates.forEach((value, key) => {
        states[key] = value.data;
    });
    res.json(states);
});

// API endpoint to get specific user state
app.get('/state/:username', (req, res) => {
    const state = userStates.get(req.params.username);
    if (state) {
        res.json(state.data);
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

// API endpoint to update user state (from game clients)
app.post('/state/:username', (req, res) => {
    console.log(`POST /state/${req.params.username} received`);
    console.log('Body:', req.body);

    const username = req.params.username;
    const data = req.body;

    if (!data || !data.username) {
        console.log('Invalid data - missing username');
        return res.status(400).json({ error: 'Invalid data' });
    }

    // Store user state in memory only (fast)
    userStates.set(username, {
        message: null, // Don't use Discord messages for real-time sync
        data: data
    });

    console.log(`State stored for ${username}`);
    res.json({ success: true });
});

// ---- Vault (additive; no route above is modified) ----
// Short-lived session secrets for obfuscated scripts. Nothing here changes
// bot behavior: existing endpoints, Discord flow, and states are untouched.
// Secrets live in Render env vars; Pastefy (optional) holds only an audit
// trail, never anything the system depends on.
const VAULT_BOOTSTRAP = process.env.VAULT_BOOTSTRAP || '';
const VAULT_BOOTSTRAP_PREV = process.env.VAULT_BOOTSTRAP_PREV || '';
const VAULT_SECRETS = (() => {
    try { return JSON.parse(process.env.VAULT_SECRETS || '{}'); }
    catch (e) { return {}; }
})();
const PASTEFY_API_KEY = process.env.PASTEFY_API_KEY || '';
const PASTEFY_API = process.env.PASTEFY_API || 'https://pastefy.app/api/v2';
const TOKEN_TTL_MS = 10 * 60 * 1000;
const NONCE_TTL_MS = 60 * 1000;

const vaultTokens = new Map(); // token -> {userId, jobId, exp, count, win}
const vaultNonces = new Map(); // nonce -> exp
const vaultSweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [t, r] of vaultTokens) if (r.exp <= now) vaultTokens.delete(t);
    for (const [t, e] of vaultNonces) if (e <= now) vaultNonces.delete(t);
}, 60000);
if (vaultSweepTimer.unref) vaultSweepTimer.unref();

function fnv64hex(str) {
    let h = 0xcbf29ce484222325n;
    const buf = Buffer.from(str, 'utf8');
    for (const b of buf) {
        h ^= BigInt(b);
        h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return h.toString(16).padStart(16, '0');
}

// Best-effort audit sink to a PRIVATE Pastefy paste. Never gating: failures
// are swallowed, gameplay never waits on it. Disabled without a key.
let auditPasteId = process.env.VAULT_AUDIT_PASTE || '';
async function pastefyReq(method, p, body) {
    if (!PASTEFY_API_KEY) return null;
    if (typeof fetch === 'undefined') return null; // Node <18: audit disabled
    try {
        const r = await fetch(PASTEFY_API + p, {
            method,
            headers: {
                'Authorization': 'Bearer ' + PASTEFY_API_KEY,
                'Content-Type': 'application/json'
            },
            body: body ? JSON.stringify(body) : undefined
        });
        if (!r.ok) return null;
        try { return await r.json(); } catch (e) { return null; }
    } catch (e) { return null; }
}
function vaudit(ev) {
    if (!PASTEFY_API_KEY) return;
    taskAvoidBlock();
    async function taskAvoidBlock() {
        try {
            const line = JSON.stringify(Object.assign({ t: Date.now() }, ev)) + '\n';
            if (!auditPasteId) {
                const created = await pastefyReq('POST', '/paste', {
                    title: 'VAULT-AUDIT (do not touch)',
                    content: line,
                    visibility: 'PRIVATE',
                    type: 'PASTE'
                });
                const nid = created && created.paste && created.paste.id;
                if (nid) {
                    auditPasteId = nid;
                    console.log('[vault] audit paste created: ' + nid);
                } else return;
            } else {
                const cur = await pastefyReq('GET', '/paste/' + encodeURIComponent(auditPasteId));
                const old = cur && typeof cur.content === 'string' ? cur.content : '';
                const next = (old + line).slice(-20000);
                await pastefyReq('PUT', '/paste/' + encodeURIComponent(auditPasteId), { content: next });
            }
        } catch (e) { /* audit never throws */ }
    }
}

// Short-lived nonce for proof freshness (60s, single use).
app.get('/vault/nonce', (req, res) => {
    const nonce = crypto.randomBytes(16).toString('hex');
    vaultNonces.set(nonce, Date.now() + NONCE_TTL_MS);
    res.json({ ok: true, nonce, expiresIn: 60 });
});

// Exchange a bootstrap proof for a 10-minute token. The bootstrap itself is
// never transmitted: proof = FNV1a64(bootstrap + \0 + nonce + \0 +
// username + \0 + userId + \0 + jobId), computed live in-game. The server
// tries its known bootstraps (current + grace-window previous); Lua has no
// SHA-256 to name one, so no bootstrapId is needed.
app.post('/vault/issue', (req, res) => {
    const body = req.body || {};
    const nonce = String(body.nonce || '');
    const nx = nonce && vaultNonces.get(nonce);
    vaultNonces.delete(nonce);
    if (!nx || nx <= Date.now()) {
        return res.status(401).json({ error: 'stale nonce' });
    }
    const cands = [VAULT_BOOTSTRAP]
        .concat(VAULT_BOOTSTRAP_PREV.split(',').map(s => s.trim()).filter(Boolean))
        .filter(Boolean);
    // Hierarchical keys: a script proves with FNV(master | scriptId) used
    // in place of the raw master, so every script id gets a distinct secret
    // without new env vars — one master in env serves unlimited scripts,
    // and a leaked script key cannot mint proofs for any other id. Empty
    // scriptId keeps the legacy raw-master path for older outputs.
    const sidRaw = String(body.scriptId || '');
    const sid = /^[A-Za-z0-9_-]{1,64}$/.test(sidRaw) ? sidRaw : '';
    if (sid !== '') {
        const revoked = (process.env.VAULT_REVOKED || '').split(',')
            .map(s => s.trim()).filter(Boolean);
        if (revoked.indexOf(sid) >= 0) {
            vaudit({ ev: 'issue', ok: false, why: 'revoked', user: String(body.username || '') });
            return res.status(401).json({ error: 'revoked' });
        }
    }
    const tail = '\0' + nonce + '\0'
        + String(body.username || '') + '\0'
        + String(body.userId || '') + '\0' + String(body.jobId || '');
    let hex = null;
    for (const h of cands) {
        try {
            const k = sid !== '' ? fnv64hex(h + '|' + sid) : h;
            if (fnv64hex(k + tail) === String(body.proof || '').toLowerCase()) { hex = h; break; }
        } catch (e) { /* try next */ }
    }
    if (!hex) {
        vaudit({ ev: 'issue', ok: false, why: 'bad proof', user: String(body.username || '') });
        return res.status(401).json({ error: 'bad proof' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    vaultTokens.set(token, {
        userId: String(body.userId || ''),
        jobId: String(body.jobId || ''),
        exp: Date.now() + TOKEN_TTL_MS,
        count: 0,
        win: Date.now()
    });
    vaudit({ ev: 'issue', ok: true, user: String(body.username || '') });
    res.json({ ok: true, token, expiresIn: 600 });
});

// Spend a token for one secret value. Token is bound to the presenting
// userId/jobId, capped at 40 calls/min, dead after 10 minutes.
app.post('/vault/fetch', (req, res) => {
    const body = req.body || {};
    const rec = body.token && vaultTokens.get(body.token);
    if (!rec || rec.exp <= Date.now()) {
        if (body.token) vaultTokens.delete(body.token);
        return res.status(401).json({ error: 'bad token' });
    }
    if (String(body.userId || '') !== rec.userId || String(body.jobId || '') !== rec.jobId) {
        return res.status(401).json({ error: 'binding' });
    }
    const now = Date.now();
    if (now - rec.win > 60000) { rec.win = now; rec.count = 0; }
    rec.count += 1;
    if (rec.count > 40) return res.status(429).json({ error: 'rate' });
    const key = String(body.key || '');
    if (!Object.prototype.hasOwnProperty.call(VAULT_SECRETS, key)) {
        return res.status(404).json({ error: 'no such key' });
    }
    res.json({ ok: true, value: VAULT_SECRETS[key] });
});

// ---- Admin (ADMIN_KEY-gated). Fetch list lives in a private Pastefy paste. ----
// Fetching any public raw link is allowed. Private, loopback and link-local
// addresses are refused on every redirect hop, so the server cannot be pointed
// at Render's internal network.
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const dnsP = require('dns').promises;
const netMod = require('net');
let adminPasteId = process.env.ADMIN_LIST_PASTE || '';
let adminEntries = [];
let adminLoaded = false;
const ADMIN_MAX_ENTRIES = 50;
const ADMIN_FETCH_MAX = 1024 * 1024;
const ADMIN_FETCH_MS = 10000;
const adminFails = new Map(); // ip -> {n, t}

function adminKeyOk(given) {
    if (!ADMIN_KEY || typeof given !== 'string' || !given) return false;
    const a = Buffer.from(given, 'utf8'), b = Buffer.from(ADMIN_KEY, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Admin auth: a signed-in browser gets an HttpOnly cookie, so the key is typed once per
// browser session. Cookie sessions must also send X-Requested-With on writes; a cross-site
// page cannot add that header without a CORS preflight, which blocks cross-site writes.
const ADMIN_COOKIE = 'admin_session';
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
const adminSessions = new Map(); // sha256(token) -> expiresAt (memory only: a restart asks for the key again)
function sha256hex(v) { return crypto.createHash('sha256').update(v, 'utf8').digest('hex'); }
function isHttps(req) {
    return !!req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function cookieAdmin(req) {
    const m = /(?:^|;\s*)admin_session=([A-Za-z0-9_-]{20,})/.exec(String(req.headers.cookie || ''));
    if (!m) return false;
    const h = sha256hex(m[1]);
    const exp = adminSessions.get(h);
    if (!exp) return false;
    if (Date.now() > exp) { adminSessions.delete(h); return false; }
    adminSessions.set(h, Date.now() + ADMIN_SESSION_MS);   // sliding expiry
    return true;
}
function setAdminCookie(req, res) {
    const tok = crypto.randomBytes(32).toString('base64url');
    adminSessions.set(sha256hex(tok), Date.now() + ADMIN_SESSION_MS);
    const secure = isHttps(req) ? '; Secure' : '';
    res.set('Set-Cookie', ADMIN_COOKIE + '=' + tok + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + (ADMIN_SESSION_MS / 1000) + secure);
}
function clearAdminCookie(req, res) {
    const m = /(?:^|;\s*)admin_session=([A-Za-z0-9_-]{20,})/.exec(String(req.headers.cookie || ''));
    if (m) adminSessions.delete(sha256hex(m[1]));
    res.set('Set-Cookie', ADMIN_COOKIE + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' + (isHttps(req) ? '; Secure' : ''));
}
function adminThrottled(ip) {
    const rec = adminFails.get(ip);
    return !!(rec && rec.n >= 20 && Date.now() - rec.t < 10 * 60 * 1000);
}
function adminFailed(ip) {
    const rec = adminFails.get(ip);
    const r = rec && Date.now() - rec.t < 10 * 60 * 1000 ? rec : { n: 0, t: Date.now() };
    r.n += 1;
    adminFails.set(ip, r);
}
function requireAdmin(req, res, next) {
    if (!ADMIN_KEY) return res.status(503).json({ error: 'admin disabled (ADMIN_KEY not set)' });
    if (cookieAdmin(req)) {
        if (req.method !== 'GET' && req.get('x-requested-with') !== 'admin') {
            return res.status(403).json({ error: 'missing request header' });
        }
        return next();
    }
    // Header-key path, kept for scripts and curl.
    const ip = String(req.ip || '');
    if (adminThrottled(ip)) return res.status(429).json({ error: 'too many attempts, try later' });
    if (!adminKeyOk(req.get('x-admin-key') || '')) {
        adminFailed(ip);
        return res.status(401).json({ error: 'unauthorized' });
    }
    adminFails.delete(ip);
    next();
}

// Session endpoints for the admin page.
app.get('/admin/api/session', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!ADMIN_KEY) return res.json({ ok: false, reason: 'disabled' });
    res.json({ ok: cookieAdmin(req) });
});
app.post('/admin/api/login', (req, res) => {
    const ip = String(req.ip || '');
    if (!ADMIN_KEY) return res.status(503).json({ error: 'admin disabled (ADMIN_KEY not set)' });
    if (adminThrottled(ip)) return res.status(429).json({ error: 'too many attempts, try later' });
    if (!adminKeyOk(String((req.body || {}).key || ''))) {
        adminFailed(ip);
        return res.status(401).json({ error: 'wrong admin key' });
    }
    adminFails.delete(ip);
    setAdminCookie(req, res);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true });
});
app.post('/admin/api/logout', (req, res) => {
    if (req.get('x-requested-with') !== 'admin') return res.status(403).json({ error: 'missing request header' });
    clearAdminCookie(req, res);
    res.json({ ok: true });
});

function isPrivateAddress(ip) {
    const v = netMod.isIP(ip);
    if (v === 4) {
        const p = ip.split('.').map(Number);
        if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
        if (p[0] === 169 && p[1] === 254) return true;
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
        if (p[0] === 192 && p[1] === 168) return true;
        if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // carrier-grade NAT
        if (p[0] >= 224) return true; // multicast and reserved
        return false;
    }
    if (v === 6) {
        const l = ip.toLowerCase();
        if (l === '::' || l === '::1') return true;
        if (/^f[cd]/.test(l)) return true;          // fc00::/7
        if (/^fe[89ab]/.test(l)) return true;       // fe80::/10
        if (l.startsWith('::ffff:')) {              // IPv4-mapped: judge the embedded IPv4
            const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
            return m ? isPrivateAddress(m[1]) : true;
        }
        return false;
    }
    return true; // not an address: refuse
}

async function checkPublicUrl(raw) {
    let u;
    try { u = new URL(String(raw || '')); } catch (e) { throw new Error('invalid url'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('only http and https links');
    if (u.username || u.password) throw new Error('credentials in url not allowed');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const addrs = netMod.isIP(host) ? [{ address: host }] : await dnsP.lookup(host, { all: true });
    if (!addrs || !addrs.length) throw new Error('host did not resolve');
    for (const a of addrs) if (isPrivateAddress(a.address)) throw new Error('address not allowed');
    return u;
}

async function adminFetchText(rawUrl, allowHost) {
    if (typeof fetch === 'undefined') throw new Error('fetch unavailable on this Node version');
    let u = await checkPublicUrl(rawUrl);
    if (allowHost && !allowHost(u.hostname)) throw new Error('this host is not on the fetch list');
    for (let hop = 0; hop < 4; hop++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ADMIN_FETCH_MS);
        try {
            const r = await fetch(u.toString(), {
                redirect: 'manual',
                signal: ctrl.signal,
                headers: { 'User-Agent': 'obfuscator-admin-fetch/1.0', 'Accept': 'text/plain, */*' }
            });
            const loc = r.headers.get('location');
            if (r.status >= 300 && r.status < 400 && loc) {
                u = await checkPublicUrl(new URL(loc, u).toString());
                if (allowHost && !allowHost(u.hostname)) throw new Error('redirect to a host that is not on the fetch list');
                continue;
            }
            if (!r.ok) throw new Error('upstream HTTP ' + r.status);
            const declared = Number(r.headers.get('content-length') || 0);
            if (declared > ADMIN_FETCH_MAX) throw new Error('response too large');
            if (!r.body) return { status: r.status, text: '' };
            const reader = r.body.getReader();
            const chunks = [];
            let total = 0;
            for (;;) {
                const step = await reader.read();
                if (step.done) break;
                total += step.value.length;
                if (total > ADMIN_FETCH_MAX) { ctrl.abort(); throw new Error('response too large'); }
                chunks.push(Buffer.from(step.value));
            }
            return { status: r.status, text: Buffer.concat(chunks).toString('utf8') };
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error('too many redirects');
}

// Loads the list once. adminLoaded stays false when Pastefy is unset or unreachable,
// and saves are refused in that state so an outage can never overwrite the list.
async function adminLoad() {
    if (adminLoaded) return true;
    if (!PASTEFY_API_KEY) return false;
    if (!adminPasteId) {
        const created = await pastefyReq('POST', '/paste', {
            title: 'ADMIN-FETCH-LIST (do not touch)',
            content: '[]',
            visibility: 'PRIVATE',
            type: 'PASTE'
        });
        const nid = created && created.paste && created.paste.id;
        if (!nid) return false;
        adminPasteId = nid;
        adminEntries = [];
        adminLoaded = true;
        console.log('[admin] list paste created: ' + nid + ' (set ADMIN_LIST_PASTE to this id on Render)');
        return true;
    }
    const cur = await pastefyReq('GET', '/paste/' + encodeURIComponent(adminPasteId));
    if (!cur || typeof cur.content !== 'string') return false;
    try {
        const parsed = JSON.parse(cur.content || '[]');
        if (!Array.isArray(parsed)) return false;
        adminEntries = parsed;
        adminLoaded = true;
        return true;
    } catch (e) { return false; }
}

async function adminSave(previous) {
    const ok = !!(await pastefyReq('PUT', '/paste/' + encodeURIComponent(adminPasteId), {
        content: JSON.stringify(adminEntries)
    }));
    if (!ok) adminEntries = previous; // roll back so memory matches storage
    return ok;
}

async function adminReady(req, res, next) {
    let ok = false;
    try { ok = await adminLoad(); } catch (e) { ok = false; }
    if (!ok) return res.status(503).json({ error: 'list storage not configured or unreachable' });
    next();
}

app.get('/admin/api/entries', requireAdmin, adminReady, (req, res) => {
    res.json({ ok: true, entries: adminEntries.map(e => ({ id: e.id, label: e.label, url: e.url })) });
});

app.post('/admin/api/entries', requireAdmin, adminReady, async (req, res) => {
    const label = String((req.body || {}).label || '').trim().slice(0, 60) || 'untitled';
    const url = String((req.body || {}).url || '').trim();
    if (adminEntries.length >= ADMIN_MAX_ENTRIES) return res.status(400).json({ error: 'list is full' });
    try { await checkPublicUrl(url); } catch (e) { return res.status(400).json({ error: e.message }); }
    const previous = adminEntries.slice();
    adminEntries = adminEntries.concat([{ id: crypto.randomBytes(6).toString('hex'), label: label, url: url, added: Date.now() }]);
    if (!(await adminSave(previous))) return res.status(502).json({ error: 'could not save the list' });
    res.json({ ok: true, entries: adminEntries.map(e => ({ id: e.id, label: e.label, url: e.url })) });
});

app.delete('/admin/api/entries/:id', requireAdmin, adminReady, async (req, res) => {
    const previous = adminEntries.slice();
    adminEntries = adminEntries.filter(e => e.id !== req.params.id);
    if (adminEntries.length === previous.length) return res.status(404).json({ error: 'no such entry' });
    if (!(await adminSave(previous))) return res.status(502).json({ error: 'could not save the list' });
    res.json({ ok: true, entries: adminEntries.map(e => ({ id: e.id, label: e.label, url: e.url })) });
});

// Public source fetch for the obfuscator page. Only listed hosts (FETCH_HOSTS), 30 requests
// per client per 10 minutes, the same private-address and size checks as the admin fetch.
app.set('trust proxy', 1); // Render's proxy: req.ip becomes the real client address
const FETCH_HOSTS = new Set((process.env.FETCH_HOSTS || 'fast-note.com,pastefy.app,raw.githubusercontent.com,gist.githubusercontent.com,pastebin.com')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
const pubFetchHits = new Map(); // ip -> {n, t}
const PUB_FETCH_MAX = 30;
const PUB_FETCH_WINDOW_MS = 10 * 60 * 1000;
app.post('/api/fetch-source', async (req, res) => {
    const ip = String(req.ip || '');
    const now = Date.now();
    if (pubFetchHits.size > 5000) pubFetchHits.clear();
    const rec = pubFetchHits.get(ip);
    const cur = rec && now - rec.t < PUB_FETCH_WINDOW_MS ? rec : { n: 0, t: now };
    if (cur.n >= PUB_FETCH_MAX) return res.status(429).json({ error: 'too many fetches, try again in a few minutes' });
    cur.n += 1;
    pubFetchHits.set(ip, cur);
    const url = String((req.body || {}).url || '').trim();
    try {
        const r = await adminFetchText(url, (host) => FETCH_HOSTS.has(String(host).toLowerCase()));
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, status: r.status, text: r.text });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/admin/api/fetch', requireAdmin, async (req, res) => {
    const url = String((req.body || {}).url || '').trim();
    try {
        const r = await adminFetchText(url);
        console.log('[admin] fetch ' + new URL(url).hostname + ' -> ' + r.status);
        res.json({ ok: true, status: r.status, text: r.text });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/admin/api/entries/:id/fetch', requireAdmin, adminReady, async (req, res) => {
    const entry = adminEntries.find(e => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'no such entry' });
    try {
        const r = await adminFetchText(entry.url);
        res.json({ ok: true, status: r.status, text: r.text });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// ---- Live VM: per-script config, builds, versioned artifacts, sessions ----
// Stored under DATA_DIR (default ./data). On Render this path is wiped on every
// deploy/restart unless a persistent disk is mounted there; see the notes.
const { createLive, mountLiveRoutes } = require('./live.js');
const { internals: engineInternals } = require('./obfuscator/engine.js');
const LIVE_ENGINE_PATH = path.join(__dirname, 'obfuscator', 'engine.js');
const liveEngineVersion = 'engine-' + crypto.createHash('sha256')
    .update(require('fs').readFileSync(LIVE_ENGINE_PATH)).digest('hex').slice(0, 12);
const live = createLive({
    dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
    engineVersion: liveEngineVersion,
    internals: engineInternals,
    obfuscate: (src, seed, settings) => require('./obfuscator/engine.js').obfuscate(src, seed, settings),
    checkUrl: (url) => checkPublicUrl(url),
    fetchSource: async (url) => {
        const r = await adminFetchText(url);
        if (r.status !== 200) throw new Error('source returned HTTP ' + r.status);
        return r.text;
    },
    log: (m) => console.log(m)
});
mountLiveRoutes(app, live, requireAdmin);

if (!BOT_TOKEN) {
    console.warn('[discord] BOT_TOKEN missing — bot login skipped, web endpoints still live');
} else {
    client.on('error', (e) => console.error('[discord] client error (kept alive):', e && e.message ? e.message : e));
    Promise.resolve(client.login(BOT_TOKEN)).catch((e) =>
        console.error('[discord] login failed (web endpoints still live):', e && e.message ? e.message : e));
}
