const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const path = require('path');
const crypto = require('crypto');

// Express server for Render health checks
const app = express();
app.use(express.json()); // Parse JSON request bodies
app.get('/', (req, res) => res.send('Discord Bot Running'));

// GNG obfuscator page (static UI + shared engine, same deploy)
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
    setInterval(() => {
        try {
            Promise.resolve(fetch(`http://localhost:${PORT}`)).catch(err =>
                console.error('Keep-alive ping failed:', err && err.message ? err.message : err));
        } catch (err) {
            console.error('Keep-alive ping failed:', err && err.message ? err.message : err);
        }
    }, 25000);
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

// ---- GNG vault (additive; no route above is modified) ----
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
setInterval(() => {
    const now = Date.now();
    for (const [t, r] of vaultTokens) if (r.exp <= now) vaultTokens.delete(t);
    for (const [t, e] of vaultNonces) if (e <= now) vaultNonces.delete(t);
}, 60000);

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
                    title: 'GNG-VAULT-AUDIT (do not touch)',
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

if (!BOT_TOKEN) {
    console.warn('[discord] BOT_TOKEN missing — bot login skipped, web endpoints still live');
} else {
    client.on('error', (e) => console.error('[discord] client error (kept alive):', e && e.message ? e.message : e));
    Promise.resolve(client.login(BOT_TOKEN)).catch((e) =>
        console.error('[discord] login failed (web endpoints still live):', e && e.message ? e.message : e));
}
