'use strict';
// Live VM manager: per-script saved config, one-off builds, versioned artifacts
// with atomic publication, and recurring "Live" sessions. Pure logic; the Express
// routes are mounted by mountLiveRoutes() so the core can be tested without HTTP.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROFILES = ['light', 'medium', 'heavy', 'maximum'];
const LIMITS = {
    maxScripts: 20,
    maxGenerations: 5,          // artifacts kept per script (current included)
    minIntervalMs: 6000,        // spec target: 6 s
    maxIntervalMs: 60 * 60 * 1000,
    minTtlMs: 60 * 1000,
    minRotateMs: 1000,          // token rotation: 0 = off, otherwise 1 s to 24 h
    maxRotateMs: 24 * 60 * 60 * 1000,
    maxTtlMs: 7 * 24 * 60 * 60 * 1000,
    maxOutputBytes: 8 * 1024 * 1024,
    maxNameLen: 60
};
const CLEANUP_MS = 60 * 1000;

function sha256(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }
function newId(n) { return crypto.randomBytes(n || 6).toString('hex'); }

// Decoys: 20 to 80 strings per build, shaped exactly like the rotating link
// (/live/<id>/latest?token=<token>). Fresh on every build, so they never repeat.
const DECOY_MIN = 20, DECOY_MAX = 80;
function makeDecoys() {
    const n = DECOY_MIN + crypto.randomInt(DECOY_MAX - DECOY_MIN + 1);
    const strings = [];
    for (let i = 0; i < n; i++) strings.push('/live/' + newId(6) + '/latest?token=' + newId(24));
    return { count: n, strings: strings };
}
function tokenOk(given, expected) {
    if (typeof given !== 'string' || typeof expected !== 'string' || !given || !expected) return false;
    const a = Buffer.from(given, 'utf8'), b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Structural validation of obfuscator output. This is not a Luau parser: it checks
// that the output lexes, that block keywords balance, and that no JS-side
// placeholder ("undefined"/"NaN") leaked into the code as an identifier.
function validateOutput(internals, code) {
    if (typeof code !== 'string' || code.length === 0) throw new Error('obfuscator returned empty output');
    if (Buffer.byteLength(code, 'utf8') > LIMITS.maxOutputBytes) throw new Error('output exceeds size limit');
    const toks = internals.tokenize(code);            // throws on lexer failure
    if (!Array.isArray(toks) || toks.length === 0) throw new Error('output produced no tokens');
    let depth = 0, pendingLoopDo = 0;
    for (const t of toks) {
        const type = t[0], v = t[1];
        if (type === 'ID' && (v === 'undefined' || v === 'NaN')) throw new Error('leaked placeholder identifier: ' + v);
        if (type !== 'KW') continue;
        if (v === 'function' || v === 'if' || v === 'repeat') depth++;
        else if (v === 'while' || v === 'for') { depth++; pendingLoopDo++; }
        else if (v === 'do') { if (pendingLoopDo > 0) pendingLoopDo--; else depth++; }
        else if (v === 'end' || v === 'until') depth--;
        if (depth < 0) throw new Error('unbalanced block keywords');
    }
    if (depth !== 0) throw new Error('unbalanced block keywords (depth ' + depth + ')');
    return true;
}

// Refuses sources that are obviously not Lua (HTML/JSON error pages, empty pastes,
// plain prose) before the engine runs. Not a parser: a file that is valid-looking
// but syntactically wrong will still be caught only by the output checks.
function checkSource(internals, src) {
    if (typeof src !== 'string' || !src.trim()) throw new Error('source is empty');
    const head = src.replace(/^\uFEFF/, '').trimStart();
    if (head.charAt(0) === '<' || /<!doctype|<html[\s>]/i.test(head.slice(0, 500))) {
        throw new Error('source looks like an HTML page, not Lua (check the link)');
    }
    const toks = internals.tokenize(src);
    const luaish = toks.some(t => (t[0] === 'KW') || (t[0] === 'SYM' && (t[1] === '=' || t[1] === '(')));
    if (!luaish) throw new Error('source has no Lua statements');
    return true;
}

// Keep only plain numeric counters from the engine's stats (for the dashboard).
function summarizeStats(st) {
    const o = {};
    if (st && typeof st === 'object') Object.keys(st).forEach(k => { if (typeof st[k] === 'number') o[k] = st[k]; });
    return o;
}

function validateConfig(input, prev) {
    const c = input || {};
    const errors = [];
    const out = Object.assign({}, prev || {});
    const name = String(c.name == null ? (out.name || 'untitled') : c.name).trim().slice(0, LIMITS.maxNameLen);
    out.name = name || 'untitled';
    if (c.sourceUrl !== undefined || !out.sourceUrl) out.sourceUrl = String(c.sourceUrl || '').trim();
    if (c.profile !== undefined) out.profile = c.profile;
    if (!out.profile) out.profile = 'maximum';
    if (PROFILES.indexOf(out.profile) < 0) errors.push('profile must be one of ' + PROFILES.join(', '));
    if (c.vm !== undefined) out.vm = c.vm === true || c.vm === 'true';
    if (out.vm === undefined) out.vm = true;
    if (c.intervalMs !== undefined) out.intervalMs = Number(c.intervalMs);
    if (out.intervalMs === undefined) out.intervalMs = LIMITS.minIntervalMs;
    if (!Number.isFinite(out.intervalMs) || out.intervalMs < LIMITS.minIntervalMs || out.intervalMs > LIMITS.maxIntervalMs) {
        errors.push('intervalMs must be between ' + LIMITS.minIntervalMs + ' and ' + LIMITS.maxIntervalMs);
    }
    if (c.ttlMs !== undefined) out.ttlMs = Number(c.ttlMs);
    if (out.ttlMs === undefined) out.ttlMs = 24 * 60 * 60 * 1000;
    // 0 = open: artifacts never expire.
    if (!Number.isFinite(out.ttlMs) || (out.ttlMs !== 0 && (out.ttlMs < LIMITS.minTtlMs || out.ttlMs > LIMITS.maxTtlMs))) {
        errors.push('ttlMs must be 0 (open) or between ' + LIMITS.minTtlMs + ' and ' + LIMITS.maxTtlMs);
    }
    if (c.rotateEveryMs !== undefined) out.rotateEveryMs = Number(c.rotateEveryMs);
    if (out.rotateEveryMs === undefined) out.rotateEveryMs = 0;
    if (out.rotateEveryMs !== 0 && (!Number.isFinite(out.rotateEveryMs) || out.rotateEveryMs < LIMITS.minRotateMs || out.rotateEveryMs > LIMITS.maxRotateMs)) {
        errors.push('rotateEveryMs must be 0 (off) or between ' + LIMITS.minRotateMs + ' and ' + LIMITS.maxRotateMs);
    }
    return { config: out, errors: errors };
}

function settingsOf(rec) {
    return { profile: rec.profile, vm: rec.vm === true };
}

function createLive(opts) {
    const dataDir = opts.dataDir;
    const fetchSource = opts.fetchSource;          // async (url) -> string
    const checkUrl = opts.checkUrl || (async () => {}); // async (url) -> throws if refused
    const obfuscate = opts.obfuscate;              // (src, seed, settings) -> {code, stats}
    const internals = opts.internals;              // { tokenize }
    const engineVersion = opts.engineVersion || 'unknown';
    const now = opts.now || (() => Date.now());
    const schedule = opts.schedule || ((fn, ms) => setTimeout(fn, ms));
    const cancelSchedule = opts.cancelSchedule || ((t) => clearTimeout(t));
    const log = opts.log || (() => {});

    const root = path.join(dataDir, 'live');
    const stateFile = path.join(root, 'scripts.json');
    const artDir = path.join(root, 'artifacts');
    fs.mkdirSync(artDir, { recursive: true });

    // ---- persistence -------------------------------------------------------
    let db = { scripts: {} };
    try {
        const raw = fs.readFileSync(stateFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.scripts === 'object') db = parsed;
    } catch (e) { /* first run or unreadable: start empty */ }

    function saveDb() {
        const tmp = stateFile + '.' + newId(4) + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
        fs.renameSync(tmp, stateFile);   // atomic replace on POSIX
        queueRemoteSave();
    }

    // Optional remote copy (e.g. a private Pastefy paste) so state survives a redeploy
    // that wipes the disk. Saves are debounced. Until hydrate() has read the remote
    // copy successfully, nothing is written to it, so an outage cannot erase state.
    const remote = opts.remote || null;   // { load(): obj|null (throws on outage), save(obj): bool }
    let remoteReady = false, remoteTimer = null, remoteBusy = false;
    function queueRemoteSave(delay) {
        if (!remote || !remoteReady || remoteTimer) return;
        remoteTimer = setTimeout(async () => {
            remoteTimer = null;
            if (remoteBusy) { queueRemoteSave(1000); return; }
            remoteBusy = true;
            try {
                const snapshot = JSON.parse(JSON.stringify(db));   // plain object; remote does its own encoding
                const ok = await remote.save(snapshot);
                if (!ok) throw new Error('storage refused the save');
            } catch (e) {
                log('[live] remote save failed, retrying in 10 s: ' + (e && e.message));
                queueRemoteSave(10000);
            } finally { remoteBusy = false; }
        }, delay === undefined ? 1500 : delay);
        if (remoteTimer.unref) remoteTimer.unref();
    }
    function artPath(scriptId, genId) { return path.join(artDir, scriptId, genId + '.lua'); }
    function writeArtifact(file, text) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.' + newId(4) + '.tmp';
        fs.writeFileSync(tmp, text);
        fs.renameSync(tmp, file);
    }
    function removeArtifact(scriptId, gen) {
        try { fs.unlinkSync(artPath(scriptId, gen.id)); } catch (e) { /* already gone */ }
    }

    // ---- runtime (memory only) --------------------------------------------
    const rt = new Map();
    function rtOf(id) {
        if (!rt.has(id)) rt.set(id, { timer: null, building: false, cancelled: false, running: false,
            lastError: null, lastBuildMs: null, lastFetchMs: null, nextAt: null, nextRotAt: null,
            overlapSkips: 0, lastTickAt: null, lastSuccessAt: null, tickCount: 0, epoch: 0 });
        return rt.get(id);
    }
    function currentGen(rec) {
        return rec.generations.find(g => g.id === rec.currentGen) || null;
    }
    function isExpired(gen) {
        if (!gen) return true;
        if (gen.expiresAt === null) return false;   // open: never expires
        return now() >= gen.expiresAt;
    }

    // ---- config API --------------------------------------------------------
    function publicView(rec) {
        const r = rtOf(rec.id);
        const cur = currentGen(rec);
        let status;
        if (!rec.running) status = 'Stopped';
        else if (r.lastError && !r.lastSuccessAt) status = 'Error';
        else if (!r.lastSuccessAt) status = 'Starting';
        else if (r.lastError) status = 'Error';
        else status = 'Running';
        return {
            id: rec.id, name: rec.name, sourceUrl: rec.sourceUrl, profile: rec.profile, vm: rec.vm,
            intervalMs: rec.intervalMs, ttlMs: rec.ttlMs, rotateEveryMs: rec.rotateEveryMs || 0,
            token: rec.token, tokenRotatedAt: rec.tokenRotatedAt || null, configVersion: rec.configVersion,
            reference: {
                key: rec.refKey, path: '/live/ref/' + rec.refKey, rotatedAt: rec.refRotatedAt || null,
                accessCount: rec.refAccess ? rec.refAccess.count : 0, lastAccessAt: rec.refAccess ? rec.refAccess.lastAt : null
            },
            loaderState: !cur ? 'none' : (isExpired(cur) ? 'expired' : 'valid'),
            updatedAt: rec.updatedAt, status: status, running: rec.running,
            url: '/live/' + rec.id + '/latest',
            current: cur ? {
                id: cur.id, createdAt: cur.createdAt, expiresAt: cur.expiresAt, expired: isExpired(cur),
                sourceHash: cur.sourceHash.slice(0, 12), obfuscatorVersion: cur.obfuscatorVersion,
                bytes: cur.bytes, seed: cur.seed, stats: cur.stats || {}
            } : null,
            nextRotationAt: r.running && rec.rotateEveryMs ? r.nextRotAt : null,
            lastSuccessAt: r.lastSuccessAt, lastError: r.lastError, lastBuildMs: r.lastBuildMs,
            lastFetchMs: r.lastFetchMs, nextAt: r.running ? r.nextAt : null, overlapSkips: r.overlapSkips,
            generations: rec.generations.slice(-LIMITS.maxGenerations).map(g => ({
                id: g.id, createdAt: g.createdAt, expiresAt: g.expiresAt, bytes: g.bytes, current: g.id === rec.currentGen
            }))
        };
    }

    function list() { return Object.values(db.scripts).map(publicView); }
    function get(id) { return db.scripts[id] ? publicView(db.scripts[id]) : null; }

    async function save(id, input) {
        const exists = id ? db.scripts[id] : null;
        if (id && !exists) return { ok: false, status: 404, error: 'no such script' };
        if (!exists && Object.keys(db.scripts).length >= LIMITS.maxScripts) {
            return { ok: false, status: 400, error: 'script limit reached (' + LIMITS.maxScripts + ')' };
        }
        const checked = validateConfig(input, exists);
        if (checked.errors.length) return { ok: false, status: 400, error: checked.errors.join('; ') };
        const cfg = checked.config;
        if (!cfg.sourceUrl) return { ok: false, status: 400, error: 'sourceUrl is required' };
        try { await checkUrl(cfg.sourceUrl); } catch (e) { return { ok: false, status: 400, error: e.message }; }

        const at = new Date(now()).toISOString();
        const changed = !exists || cfg.sourceUrl !== exists.sourceUrl || cfg.profile !== exists.profile || cfg.vm !== exists.vm;
        const rec = exists ? db.scripts[id] : {
            id: newId(6), token: newId(24), createdAt: at, running: false, generations: [],
            currentGen: null, nextSeq: 1, configVersion: 0
        };
        Object.assign(rec, { name: cfg.name, sourceUrl: cfg.sourceUrl, profile: cfg.profile, vm: cfg.vm,
            intervalMs: cfg.intervalMs, ttlMs: cfg.ttlMs, rotateEveryMs: cfg.rotateEveryMs, updatedAt: at });
        if (changed) rec.configVersion += 1;
        ensureReference(rec);
        db.scripts[rec.id] = rec;
        try { saveDb(); } catch (e) {
            if (!exists) delete db.scripts[rec.id];
            return { ok: false, status: 502, error: 'could not write config: ' + e.message };
        }
        return { ok: true, script: publicView(rec) };
    }

    // Permanent loader reference: a random key that stays the same across builds and token
    // rotations. Only rotateReference() changes it, which revokes the old loader at once.
    function ensureReference(rec) {
        if (!rec.refKey) rec.refKey = newId(20);
        if (!rec.refAccess) rec.refAccess = { count: 0, lastAt: null };
    }
    function rotateReference(id) {
        const rec = db.scripts[id];
        if (!rec) return { ok: false, status: 404, error: 'no such script' };
        const prev = rec.refKey;
        rec.refKey = newId(20);
        rec.refRotatedAt = new Date(now()).toISOString();
        try { saveDb(); } catch (e) { rec.refKey = prev; return { ok: false, status: 502, error: 'could not save' }; }
        return { ok: true, script: publicView(rec) };
    }

    function rotateToken(id) {
        const rec = db.scripts[id];
        if (!rec) return { ok: false, status: 404, error: 'no such script' };
        const prev = rec.token;
        rec.token = newId(24);
        try { saveDb(); } catch (e) { rec.token = prev; return { ok: false, status: 502, error: 'could not save' }; }
        return { ok: true, script: publicView(rec) };
    }

    function remove(id) {
        const rec = db.scripts[id];
        if (!rec) return { ok: false, status: 404, error: 'no such script' };
        stopSession(id);
        delete db.scripts[id];
        try { saveDb(); } catch (e) { db.scripts[id] = rec; return { ok: false, status: 502, error: 'could not save' }; }
        try { fs.rmSync(path.join(artDir, id), { recursive: true, force: true }); } catch (e) { /* best effort */ }
        rt.delete(id);
        return { ok: true };
    }

    // ---- building ----------------------------------------------------------
    // Returns { ok, status, skipped?, generation?, error? }. Never publishes a
    // partial artifact and never changes the current pointer unless the new
    // artifact has been validated and written.
    async function buildOnce(id, reason) {
        const rec = db.scripts[id];
        if (!rec) return { ok: false, status: 404, error: 'no such script' };
        const r = rtOf(id);
        if (r.building) {
            r.overlapSkips += 1;
            return { ok: false, status: 409, error: 'a build is already running for this script' };
        }
        r.building = true; r.cancelled = false;
        const t0 = now();
        const settings = settingsOf(rec);
        try {
            const tf = now();
            const src = await fetchSource(rec.sourceUrl);
            r.lastFetchMs = now() - tf;
            if (typeof src !== 'string' || !src.trim()) throw new Error('source is empty');
            const key = sha256(src) + ':' + sha256(JSON.stringify(settings)) + ':' + engineVersion;
            const cur = currentGen(rec);
            // Unchanged input is skipped only if the artifact file is still on disk.
            if (reason === 'tick' && cur && cur.key === key && !isExpired(cur) && fs.existsSync(artPath(id, cur.id))) {
                r.lastSuccessAt = now();
                r.lastError = null;
                return { ok: true, skipped: 'unchanged', generation: publicView(rec).current };
            }
            if (r.cancelled) return { ok: false, status: 409, error: 'cancelled' };

            checkSource(internals, src);
            const seed = crypto.randomInt(1, 2147483647);
            const decoys = makeDecoys();
            const out = obfuscate(src, seed, Object.assign({}, settings, { decoys: decoys.count, decoyStrings: decoys.strings }));
            if (r.cancelled) return { ok: false, status: 409, error: 'cancelled' };
            const code = out && out.code;
            validateOutput(internals, code);

            if (!db.scripts[id]) return { ok: false, status: 404, error: 'script was deleted during build' };
            const gen = {
                id: newId(8), seq: rec.nextSeq, createdAt: new Date(now()).toISOString(),
                expiresAt: rec.ttlMs === 0 ? null : now() + rec.ttlMs, sourceHash: sha256(src), settingsHash: sha256(JSON.stringify(settings)),
                key: key, obfuscatorVersion: engineVersion, bytes: Buffer.byteLength(code, 'utf8'), seed: seed,
                stats: summarizeStats(out.stats)
            };
            const file = artPath(id, gen.id);
            // 1) write the new artifact  2) swap the pointer  3) persist.  If 3 fails, roll back.
            writeArtifact(file, code);
            const prevGens = rec.generations.slice();
            const prevCurrent = rec.currentGen;
            const prevSeq = rec.nextSeq;
            rec.generations.push(gen);
            rec.nextSeq += 1;
            rec.currentGen = gen.id;
            const dropped = [];
            while (rec.generations.length > LIMITS.maxGenerations) {
                const g = rec.generations.find(x => x.id !== rec.currentGen);
                if (!g) break;
                rec.generations = rec.generations.filter(x => x !== g);
                dropped.push(g);
            }
            try { saveDb(); } catch (e) {
                rec.generations = prevGens; rec.currentGen = prevCurrent; rec.nextSeq = prevSeq;
                try { fs.unlinkSync(file); } catch (x) { /* ignore */ }
                throw new Error('could not persist generation: ' + e.message);
            }
            dropped.forEach(g => removeArtifact(id, g));
            r.lastSuccessAt = now();
            r.lastError = null;
            log('[live] ' + rec.name + ' published ' + gen.id + ' (' + reason + ', ' + gen.bytes + ' bytes)');
            return { ok: true, generation: publicView(rec).current };
        } catch (e) {
            if (db.scripts[id]) {
                r.lastError = { message: e.message, at: new Date(now()).toISOString(), reason: reason };
            }
            log('[live] build failed for ' + id + ': ' + e.message);
            return { ok: false, status: 500, error: e.message };
        } finally {
            r.building = false;
            r.lastBuildMs = now() - t0;
            if (r.rebuildPending) {
                r.rebuildPending = false;
                const again = db.scripts[id];
                if (again && again.running && again.rotateEveryMs) schedule(() => requestRebuild(id), 0);
            }
        }
    }

    // ---- token rotation ----------------------------------------------------
    // Automatic rotation (only while a session runs). The previous token stays valid for
    // one rotation interval, so a request that started just before a change still works.
    function rotateTokenNow(rec) {
        rec.previousToken = rec.token;
        rec.previousTokenExp = now() + (rec.rotateEveryMs || LIMITS.minRotateMs);
        rec.token = newId(24);
        rec.tokenRotatedAt = new Date(now()).toISOString();
        try { saveDb(); } catch (e) { log('[live] could not save rotated token: ' + e.message); }
    }
    // Every rotation rebuilds the artifact, so the permanent link's content moves with the
    // rotating link (new seed, new decoys). Requests that arrive during a build are
    // coalesced into one follow-up build; the permanent link keeps serving the last
    // completed generation until the new one is validated and published.
    function requestRebuild(id) {
        const r = rtOf(id);
        if (r.building) { r.rebuildPending = true; return; }
        buildOnce(id, 'rotate').catch(() => {});
    }
    function rotationLoop(id, epoch) {
        const r = rtOf(id);
        if (r.epoch !== epoch) return;
        r.rotTimer = null;
        const rec = db.scripts[id];
        if (!rec || !rec.running || !rec.rotateEveryMs) return;
        rotateTokenNow(rec);
        requestRebuild(id);
        r.nextRotAt = now() + rec.rotateEveryMs;
        r.rotTimer = schedule(() => rotationLoop(id, epoch), rec.rotateEveryMs);
    }
    function armRotation(id, epoch) {
        const rec = db.scripts[id];
        const r = rtOf(id);
        if (rec && rec.rotateEveryMs) {
            r.nextRotAt = now() + rec.rotateEveryMs;
            r.rotTimer = schedule(() => rotationLoop(id, epoch), rec.rotateEveryMs);
        }
    }

    // ---- sessions ----------------------------------------------------------
    // Each start/stop bumps r.epoch. A tick only builds or reschedules if its epoch
    // is still current, so an old chain can never outlive a stop or restart.
    async function tick(id, epoch) {
        const r = rtOf(id);
        if (r.epoch !== epoch) return;
        r.timer = null;
        if (!db.scripts[id] || !db.scripts[id].running) return;
        const started = now();
        r.lastTickAt = started;
        r.tickCount += 1;
        await buildOnce(id, 'tick');
        if (r.epoch !== epoch) return;
        if (!db.scripts[id] || !db.scripts[id].running) return;
        // Chained scheduling: the next tick is armed only after this one finishes,
        // so recurring builds for one script can never overlap.
        const delay = Math.max(0, db.scripts[id].intervalMs - (now() - started));
        r.nextAt = now() + delay;
        r.timer = schedule(() => tick(id, epoch), delay);
    }

    function startSession(id) {
        const rec = db.scripts[id];
        if (!rec) return { ok: false, status: 404, error: 'no such script' };
        const r = rtOf(id);
        if (rec.running) return { ok: true, script: publicView(rec) };
        rec.running = true;
        try { saveDb(); } catch (e) { rec.running = false; return { ok: false, status: 502, error: 'could not save' }; }
        r.epoch += 1;
        const epoch = r.epoch;              // capture now: the arrow must not read it later
        r.nextAt = now();
        r.timer = schedule(() => tick(id, epoch), 0);
        armRotation(id, epoch);
        return { ok: true, script: publicView(rec) };
    }

    function stopSession(id) {
        const rec = db.scripts[id];
        const r = rtOf(id);
        if (r.timer) { cancelSchedule(r.timer); r.timer = null; }
        if (r.rotTimer) { cancelSchedule(r.rotTimer); r.rotTimer = null; }
        r.nextRotAt = null;
        r.rebuildPending = false;
        r.epoch += 1;                       // invalidates the running tick chain
        r.cancelled = true;                 // discards an in-flight build before publish
        r.nextAt = null;
        if (rec && rec.running) {
            rec.running = false;
            try { saveDb(); } catch (e) { rec.running = true; return { ok: false, status: 502, error: 'could not save' }; }
        }
        return { ok: true, script: rec ? publicView(rec) : null };
    }

    // Resume sessions that were running before a restart.
    function resumeSessions() {
        Object.keys(db.scripts).forEach(id => {
            if (db.scripts[id].running) {
                const r = rtOf(id);
                r.epoch += 1;
                const epoch = r.epoch;
                r.timer = schedule(() => tick(id, epoch), 0);
                armRotation(id, epoch);
                r.nextAt = now();
            }
        });
    }

    // Cleanup: drop expired superseded artifacts and stop sessions for deleted scripts.
    function cleanup() {
        let changed = false;
        Object.keys(db.scripts).forEach(id => {
            const rec = db.scripts[id];
            const keep = [];
            rec.generations.forEach(g => {
                if (g.id !== rec.currentGen && isExpired(g)) { removeArtifact(id, g); changed = true; }
                else keep.push(g);
            });
            rec.generations = keep;
        });
        rt.forEach((r, id) => { if (!db.scripts[id] && (r.timer || r.building)) stopSession(id); });
        if (changed) { try { saveDb(); } catch (e) { /* retry next pass */ } }
        return changed;
    }

    // ---- delivery ----------------------------------------------------------
    // Returns { status, body? }. Token is compared in constant time.
    function deliverCurrent(id, rec) {
        const cur = currentGen(rec);
        if (!cur) return { status: 404, error: 'no build yet' };
        if (isExpired(cur)) return { status: 410, error: 'artifact expired' };
        try {
            return { status: 200, body: fs.readFileSync(artPath(id, cur.id), 'utf8'), generation: cur.id };
        } catch (e) {
            return { status: 503, error: 'artifact missing on disk' };
        }
    }

    function getLatest(id, token) {
        const rec = db.scripts[id];
        if (!rec) return { status: 404 };
        const previousOk = !!rec.previousToken && now() < (rec.previousTokenExp || 0) && tokenOk(token, rec.previousToken);
        if (!tokenOk(token, rec.token) && !previousOk) return { status: 401 };
        return deliverCurrent(id, rec);
    }

    // The permanent loader path. Resolves the stable key to whatever generation is current.
    // Unknown and revoked keys both return 404, so a probe cannot tell them apart.
    let refSavedAt = 0;
    function resolveReference(key) {
        if (typeof key !== 'string' || key.length < 20) return { status: 404 };
        const id = Object.keys(db.scripts).find(k => tokenOk(key, db.scripts[k].refKey));
        if (!id) return { status: 404 };
        const rec = db.scripts[id];
        const out = deliverCurrent(id, rec);
        if (out.status === 200) {
            ensureReference(rec);
            rec.refAccess.count += 1;
            rec.refAccess.lastAt = new Date(now()).toISOString();
            // Persist counters at most once a minute; they are diagnostic, not security state.
            if (now() - refSavedAt > 60 * 1000) { refSavedAt = now(); try { saveDb(); } catch (e) { /* retry later */ } }
        }
        return out;
    }

    // Restores state from the remote copy (if any), then resumes sessions and rebuilds any
    // current artifact whose file is missing (the disk is wiped on redeploy). Call once
    // at startup, before serving requests.
    function stopAllTimers() {
        rt.forEach((r) => {
            if (r.timer) cancelSchedule(r.timer);
            if (r.rotTimer) cancelSchedule(r.rotTimer);
            r.timer = null; r.rotTimer = null; r.cancelled = true; r.epoch += 1;
        });
    }
    async function hydrate() {
        let loaded = null, loadOk = !remote;
        if (remote) {
            try { loaded = await remote.load(); loadOk = true; }
            catch (e) { log('[live] remote state unavailable, using local state; remote saves paused: ' + (e && e.message)); }
        }
        stopAllTimers();
        if (loadOk && loaded && typeof loaded === 'object' && loaded.scripts && typeof loaded.scripts === 'object') db = loaded;
        Object.keys(db.scripts).forEach(id => ensureReference(db.scripts[id]));
        try { saveDb(); } catch (e) { log('[live] local save failed: ' + e.message); }
        remoteReady = !!remote && loadOk;
        if (remoteReady) queueRemoteSave(0);
        resumeSessions();
        for (const id of Object.keys(db.scripts)) {
            const cur = currentGen(db.scripts[id]);
            if (cur && !fs.existsSync(artPath(id, cur.id)) && !rtOf(id).building) {
                await buildOnce(id, 'restore');
            }
        }
        return { scripts: Object.keys(db.scripts).length, remote: remoteReady };
    }

    // ---- boot --------------------------------------------------------------
    let migrated = false;
    Object.keys(db.scripts).forEach(id => { const before = db.scripts[id].refKey; ensureReference(db.scripts[id]); if (before !== db.scripts[id].refKey) migrated = true; });
    if (migrated) { try { saveDb(); } catch (e) { /* retried on the next save */ } }

    const cleanupTimer = setInterval(cleanup, CLEANUP_MS);
    if (cleanupTimer.unref) cleanupTimer.unref();
    resumeSessions();

    return {
        list, get, save, remove, rotateToken, rotateReference, buildOnce, startSession, stopSession, hydrate,
        getLatest, resolveReference, cleanup, tick, resumeSessions,
        _state: () => db,
        _stop: () => { clearInterval(cleanupTimer); rt.forEach(r => { if (r.timer) cancelSchedule(r.timer); }); }
    };
}

// Express wiring. requireAdmin guards the dashboard API; /live/:id/latest is
// token-authenticated for the Roblox side.
function mountLiveRoutes(app, live, requireAdmin) {
    const A = '/admin/api/live';
    app.get(A, requireAdmin, (req, res) => res.json({ ok: true, scripts: live.list() }));
    app.post(A, requireAdmin, async (req, res) => {
        const r = await live.save(req.body && req.body.id, req.body || {});
        if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
        res.json(r);
    });
    app.delete(A + '/:id', requireAdmin, (req, res) => {
        const r = live.remove(req.params.id);
        if (!r.ok) return res.status(r.status).json({ error: r.error });
        res.json({ ok: true });
    });
    app.post(A + '/:id/build', requireAdmin, async (req, res) => {
        const r = await live.buildOnce(req.params.id, 'manual');
        if (!r.ok) return res.status(r.status || 400).json({ error: r.error, script: live.get(req.params.id) });
        res.json({ ok: true, generation: r.generation, script: live.get(req.params.id) });
    });
    app.post(A + '/:id/start', requireAdmin, (req, res) => {
        const r = live.startSession(req.params.id);
        if (!r.ok) return res.status(r.status).json({ error: r.error });
        res.json(r);
    });
    app.post(A + '/:id/stop', requireAdmin, (req, res) => {
        const r = live.stopSession(req.params.id);
        if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
        res.json(r);
    });
    app.post(A + '/:id/rotate-token', requireAdmin, (req, res) => {
        const r = live.rotateToken(req.params.id);
        if (!r.ok) return res.status(r.status).json({ error: r.error });
        res.json(r);
    });
    app.post(A + '/:id/rotate-reference', requireAdmin, (req, res) => {
        const r = live.rotateReference(req.params.id);
        if (!r.ok) return res.status(r.status).json({ error: r.error });
        res.json(r);
    });
    app.get('/live/ref/:key', (req, res) => {
        const r = live.resolveReference(String(req.params.key || ''));
        res.set('Cache-Control', 'no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        if (r.status !== 200) return res.status(r.status).type('text/plain').send(r.error || 'not found');
        res.type('text/plain; charset=utf-8').send(r.body);
    });
    app.get('/live/:id/latest', (req, res) => {
        const r = live.getLatest(req.params.id, String(req.query.token || ''));
        res.set('Cache-Control', 'no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        if (r.status !== 200) return res.status(r.status).type('text/plain').send(r.error || (r.status === 401 ? 'unauthorized' : 'not found'));
        res.type('text/plain; charset=utf-8').send(r.body);
    });
}

module.exports = { createLive, mountLiveRoutes, validateOutput, validateConfig, checkSource, LIMITS, PROFILES, tokenOk };
