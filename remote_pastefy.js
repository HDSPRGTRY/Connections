'use strict';
// Remote copy of Live state on a PRIVATE Pastefy paste. Used so state survives a
// redeploy that wipes DATA_DIR. Only the state JSON goes here; artifacts are rebuilt
// from their sources on restore.
//
// load(): returns the stored state (null if the paste is empty). Throws when the paste
//         is unreachable or unreadable, so the caller keeps local state and never writes.
// save(obj): returns true when stored, false otherwise.
// If no paste id is given, load() creates a private paste and logs its id once, so it
// can be saved to LIVE_STATE_PASTE on the host.

function createPastefyRemote(opts) {
    const apiKey = opts.apiKey || '';
    const api = String(opts.api || 'https://pastefy.app/api/v2').replace(/\/+$/, '');
    const fetchFn = opts.fetch || globalThis.fetch;
    const log = opts.log || (() => {});
    let pasteId = opts.pasteId || '';

    async function req(method, p, body) {
        if (!apiKey || typeof fetchFn !== 'function') return null;
        try {
            const r = await fetchFn(api + p, {
                method,
                headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined
            });
            if (!r.ok) return null;
            try { return await r.json(); } catch (e) { return null; }
        } catch (e) { return null; }
    }

    return {
        async load() {
            if (!pasteId) {
                const created = await req('POST', '/paste', {
                    title: 'LIVE-STATE (do not touch)', content: '{}', visibility: 'PRIVATE', type: 'PASTE' });
                const nid = created && created.paste && created.paste.id;
                if (!nid) throw new Error('could not create the live state paste');
                pasteId = nid;
                log('[live] state paste created: ' + nid + ' (set LIVE_STATE_PASTE to this id on the host)');
                return null;
            }
            const cur = await req('GET', '/paste/' + encodeURIComponent(pasteId));
            if (!cur || typeof cur.content !== 'string') throw new Error('live state paste unreachable');
            const text = cur.content.trim();
            if (!text || text === '{}') return null;
            return JSON.parse(text);          // throws on corruption: caller stays read-only
        },
        async save(obj) {
            if (!pasteId) return false;
            return !!(await req('PUT', '/paste/' + encodeURIComponent(pasteId), { content: JSON.stringify(obj) }));
        },
        get pasteId() { return pasteId; }
    };
}

module.exports = { createPastefyRemote };
