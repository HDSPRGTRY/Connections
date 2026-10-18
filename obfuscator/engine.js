/* Luau/Lua source obfuscator engine (v7)
 * Source transformer + hybrid VM-shell backend for Luau / Lua.
 * ES3-compatible (browser, Node, cscript).
 *
 * API: obfuscate(source, seed, opts) -> { code, stats }
 */
(function (root, factory) {
  var f = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = f;
    module.exports.obfuscate = f;
    module.exports.gngObfuscate = f;
  }
  if (typeof root !== 'undefined' && root !== null) {
    root.obfuscate = f;
    root.gngObfuscate = f;
  }
}(typeof self !== 'undefined' ? self : this, function () {

function obfuscate(src, seed, opts) {
  opts = opts || {};
  var profile = (opts.profile || 'medium').toLowerCase();
  if (profile !== 'light' && profile !== 'medium' && profile !== 'heavy') profile = 'medium';
  var density = +opts.density;
  if (!(density >= 0 && density <= 1)) {
    density = profile === 'light' ? 0.35 : profile === 'heavy' ? 0.9 : 0.6;
  }
  var doRename     = opts.rename     !== false;
  var doStrings    = opts.strings    !== false;
  var doNumbers    = opts.numbers    !== false;
  var doAnti       = opts.antitamper !== false;
  var doJunk       = opts.junk       !== false;
  var doOpaque     = opts.opaque     !== false && profile !== 'light';
  var doMba        = opts.mba        !== false && profile !== 'light';
  var doCff        = opts.cff        !== false && profile !== 'light';
  var doHideEnv    = opts.hideEnv    !== false;
  var doSoftAnti   = opts.softAnti   !== false;
  // delayStrings is OPT-IN only — nested thunks break on some executors (Delta)
  var doDelayStr   = opts.delayStrings === true;
  var doVm         = opts.vm === true;
  if (opts.antiDebug === false) doAnti = false;
  if (opts.antiDebug === true)  doAnti = true;
  if (opts.cff === false) doCff = false;
  if (opts.cff === true)  doCff = true;
  if (profile === 'light') {
    if (opts.junk   !== true) doJunk   = false;
    if (opts.opaque !== true) doOpaque = false;
    if (opts.mba    !== true) doMba    = false;
    if (opts.cff    !== true) doCff    = false;
  }
  if (profile === 'heavy') {
    doJunk = opts.junk !== false;
    doOpaque = opts.opaque !== false;
    doMba = opts.mba !== false;
    if (opts.cff !== false) doCff = true;
  }

  // -------- binding / bootstrap --------
  var bindPlace = Math.floor(+opts.place || 0);
  var bindUser  = Math.floor(+opts.user  || 0);
  if (!(bindPlace > 0)) bindPlace = 0;
  if (!(bindUser  > 0)) bindUser  = 0;
  var bound = (bindPlace > 0 || bindUser > 0);
  var RP = bound ? (bindPlace % 251) : 0;
  var RU = (bound && bindUser > 0) ? (bindUser % 251) : -1;
  var SALT = bound ? ((bindPlace % 251) + (bindUser > 0 ? ((bindUser * 13) % 251) : 0)) % 256 : 0;
  var REQPATH = (typeof opts.require === 'string') ? opts.require : '';
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(REQPATH)) REQPATH = '';
  var BOOTRAW = (typeof opts.bootstrap === 'string') ? opts.bootstrap : '';
  var BOOT = BOOTRAW;
  if (BOOT !== '' && !/^[0-9a-fA-F]{32,128}$/.test(BOOT)) {
    throw new Error('obf: bootstrap must be 32-128 hex characters (use Generate)');
  }
  var VBASE = (typeof opts.vault === 'string') ? opts.vault : '';
  if (!/^https?:\/\/[A-Za-z0-9_.-]+(:\d+)?(\/[A-Za-z0-9_.\-/]*)?$/.test(VBASE)) VBASE = '';
  if (BOOT !== '' && VBASE === '') BOOT = '';
  if (BOOT !== '' && !bound) BOOT = '';
  var SCRIPTID = (typeof opts.script === 'string') ? opts.script : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(SCRIPTID)) SCRIPTID = '';
  function fnv64hexBytes(bytes) {
    var hi = 0xCBF29CE4, lo = 0x84222325, i, b;
    var a0, a1, a2, a3, r0, r1, r2, r3, t0, t1, t2, t3, o0, o1, o2, o3;
    for (i = 0; i < bytes.length; i++) {
      b = bytes[i];
      lo = (lo ^ b) >>> 0;
      a0 = lo & 0xFFFF; a1 = (lo >>> 16) & 0xFFFF;
      a2 = hi & 0xFFFF; a3 = (hi >>> 16) & 0xFFFF;
      r0 = a0 * 435; r1 = a1 * 435;
      r2 = a0 * 256 + a2 * 435; r3 = a1 * 256 + a3 * 435;
      t0 = r0; o0 = t0 % 65536;
      t1 = r1 + Math.floor(t0 / 65536); o1 = t1 % 65536;
      t2 = r2 + Math.floor(t1 / 65536); o2 = t2 % 65536;
      t3 = r3 + Math.floor(t2 / 65536); o3 = t3 % 65536;
      hi = o3 * 65536 + o2; lo = o1 * 65536 + o0;
    }
    function h8(v) { var s = v.toString(16); while (s.length < 8) s = '0' + s; return s; }
    return h8(hi) + h8(lo);
  }
  var BKEY = BOOT;
  if (BOOT !== '' && SCRIPTID !== '') BKEY = fnv64hexBytes(utf8bytes(BOOT + '|' + SCRIPTID));
  var STRIDX = 0, POOL = [], POOLPFX = '';

  // -------- PRNG --------
  var rngState = (seed >>> 0) || 1;
  function rnd(n) {
    rngState = (rngState * 1664525 + 1013904223) % 4294967296;
    var r = rngState / 4294967296;
    if (n === undefined) return r;
    return Math.floor(r * n);
  }
  function contains(arr, v) { var i; for (i = 0; i < arr.length; i++) if (arr[i] === v) return true; return false; }

  // -------- keywords / operators --------
  var KEYWORDS = {'and':1,'break':1,'do':1,'else':1,'elseif':1,'end':1,
    'false':1,'for':1,'function':1,'goto':1,'if':1,'in':1,'local':1,'nil':1,
    'not':1,'or':1,'repeat':1,'return':1,'then':1,'true':1,'until':1,
    'while':1,'continue':1};
  var COMPLETE_K = {'ID':1,'NUM':1,'STR':1,'LSTR':1};
  var COMPLETE_V = {'true':1,'false':1,'nil':1,'...':1,')':1,']':1,'}':1,'break':1};
  var BLOCK_KW = {'local':1,'function':1,'if':1,'while':1,'for':1,'repeat':1,
    'do':1,'end':1,'else':1,'elseif':1,'until':1,'return':1,'break':1,'then':1,'in':1};
  var NEVER = {'self':1,'_G':1,'_VERSION':1};

  var ENV_NAMES = {
    'request':1,'writefile':1,'readfile':1,'isfile':1,'loadfile':1,
    'loadstring':1,'getgenv':1,'http_request':1,'syn':1,'game':1,
    'wait':1,'task':1,'require':1,'print':1,'warn':1,'error':1,
    'pcall':1,'xpcall':1,'select':1,'type':1,'typeof':1,'tostring':1,
    'tonumber':1,'tick':1,'time':1,'os':1,'math':1,'string':1,'table':1,
    'coroutine':1,'bit32':1,'debug':1,'_ENV':1,'getfenv':1,'setfenv':1
  };

  function isAlpha(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
  function isDigit(c) { return c >= '0' && c <= '9'; }
  function isAlnum(c) { return isAlpha(c) || isDigit(c); }

  // -------- Tokenizer --------
  function tokenize(s) {
    var toks = [], i = 0, n = s.length, c, j, m, lv, q, raw, d, w, k, eq;
    function longOpen(p) {
      if (s.charAt(p) !== '[') return null;
      k = p + 1; eq = '';
      while (s.charAt(k) === '=') { eq += '='; k++; }
      if (s.charAt(k) !== '[') return null;
      return {eq:eq, end:k + 1};
    }
    while (i < n) {
      c = s.charAt(i);
      var cc0 = s.charCodeAt(i);
      if (cc0 === 32 || cc0 === 9 || cc0 === 13 || cc0 === 10 || cc0 === 11 || cc0 === 12) { i++; continue; }
      if (c === '-' && s.charAt(i + 1) === '-') {
        if (s.charAt(i + 2) === '[') {
          var mo = longOpen(i + 2);
          if (mo) {
            j = s.indexOf(']' + mo.eq + ']', mo.end);
            if (j < 0) throw new Error('lex: unterminated long comment');
            i = j + mo.eq.length + 2; continue;
          }
        }
        j = s.indexOf('\n', i);
        i = (j < 0) ? n : j;
        continue;
      }
      var lo = longOpen(i);
      if (lo) {
        j = s.indexOf(']' + lo.eq + ']', lo.end);
        if (j < 0) throw new Error('lex: unterminated long string');
        toks.push(['LSTR', s.substring(i, j + lo.eq.length + 2), lo.eq]);
        i = j + lo.eq.length + 2;
        continue;
      }
      if (c === '"' || c === "'") {
        q = c; j = i + 1; raw = '';
        for (;;) {
          if (j >= n) throw new Error('lex: unterminated string');
          d = s.charAt(j);
          if (d === '\\') { raw += d + s.charAt(j + 1); j += 2; continue; }
          if (d === q) break;
          if (d === '\n') throw new Error('lex: newline in string');
          raw += d; j++;
        }
        toks.push(['STR', s.substring(i, j + 1), q, raw]);
        i = j + 1;
        continue;
      }
      if (isDigit(c) || (c === '.' && isDigit(s.charAt(i + 1)))) {
        var rest = s.substring(i);
        m = rest.match(/^0[xX][0-9a-fA-F_]+/);
        if (m) { toks.push(['NUM', m[0]]); i += m[0].length; continue; }
        m = rest.match(/^0[bB][01_]+/);
        if (m) { toks.push(['NUM', m[0]]); i += m[0].length; continue; }
        m = rest.match(/^[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?/);
        if (m && !(c === '.' && m[0].charAt(0) !== '.')) {
          toks.push(['NUM', m[0]]); i += m[0].length; continue;
        }
        if (c !== '.') throw new Error('lex: bad number');
      }
      if (isAlpha(c)) {
        j = i; while (j < n && isAlnum(s.charAt(j))) j++;
        w = s.substring(i, j);
        toks.push([KEYWORDS[w] ? 'KW' : 'ID', w]);
        i = j; continue;
      }
      var sym = null;
      var three = s.substring(i, i + 3), two = s.substring(i, i + 2);
      if (three === '...') sym = '...';
      else if (two === '..' || two === '==' || two === '~=' || two === '<=' || two === '>=') sym = two;
      else if (two === '::') throw new Error('lex: labels unsupported');
      if (sym) { toks.push(['SYM', sym]); i += sym.length; continue; }
      if ('(){}[];:,+-*/%^#<>=.'.indexOf(c) >= 0) { toks.push(['SYM', c]); i++; continue; }
      if (s.charCodeAt(i) > 127) throw new Error('lex: non-ascii outside string');
      throw new Error('lex: bad char ' + c);
    }
    return toks;
  }

  // -------- String decoding --------
  var SIMPLE_ESC = {'a':7,'b':8,'f':12,'n':10,'r':13,'t':9,'v':11,'\\':92,
    '"':34,"'":39,'\n':10};
  function decodeShort(raw) {
    var out = [], i = 0, n = raw.length, e, mm;
    while (i < n) {
      var c = raw.charAt(i);
      if (c !== '\\') {
        var cc = raw.charCodeAt(i);
        if (cc < 128) out.push(cc);
        else if (cc < 2048) out.push(192 | (cc >> 6), 128 | (cc & 63));
        else out.push(224 | (cc >> 12), 128 | ((cc >> 6) & 63), 128 | (cc & 63));
        i++; continue;
      }
      if (i + 1 >= n) return null;
      e = raw.charAt(i + 1);
      if (SIMPLE_ESC[e] !== undefined) { out.push(SIMPLE_ESC[e]); i += 2; }
      else if (e === 'x' || e === 'u' || e === 'z') return null;
      else if (e >= '0' && e <= '9') {
        mm = raw.substring(i + 1).match(/^[0-9]{1,3}/);
        out.push(parseInt(mm[0], 10) % 256);
        i += 1 + mm[0].length;
      } else return null;
    }
    return out;
  }
  function utf8bytes(str) {
    var data = [], i, cc;
    for (i = 0; i < str.length; i++) {
      cc = str.charCodeAt(i);
      if (cc < 128) data.push(cc);
      else if (cc < 2048) data.push(192 | (cc >> 6), 128 | (cc & 63));
      else data.push(224 | (cc >> 12), 128 | ((cc >> 6) & 63), 128 | (cc & 63));
    }
    return data;
  }

  // -------- Emitter state --------
  var T = null, POS = 0, OUT = [], SCOPES = null, BRACE = 0,
      COUNTER = 0, PREV = '', PREFIX = '', DEC = '';
  var stats = null;
  var BASE = 0, BASEST = [];

  function emit(s) { OUT.push(s); PREV = s; }
  function peek() { if (POS < T.length) return T[POS]; return [null, null]; }
  function look(off) {
    var p = POS + ((off === undefined) ? 1 : off);
    if (p < T.length) return T[p];
    return [null, null];
  }
  function nxt() { return T[POS++]; }
  function ctx() {
    var s = '@' + (BASE + POS) + ':', i;
    for (i = 0; i < 6 && POS + i < T.length; i++) s += ' [' + T[POS + i][1] + ']';
    return s;
  }
  function fail(m) { throw new Error('parse: ' + m + ctx()); }
  function expect(v) {
    var tk = nxt();
    if (tk[1] !== v) fail('expected ' + v + ' got ' + tk[1]);
    emit(tk[1]); track(tk[1]);
  }
  function track(t) { if (t === '{') BRACE++; else if (t === '}') BRACE--; }
  function push() { SCOPES.push({}); }
  function pop() { SCOPES.pop(); }
  function declare(name) {
    if (NEVER[name]) return name;
    var nn = PREFIX + (COUNTER++).toString(36);
    SCOPES[SCOPES.length - 1][name] = nn;
    stats.decls++;
    return nn;
  }
  function resolve(name) {
    if (NEVER[name]) return null;
    var i, sc;
    for (i = SCOPES.length - 1; i >= 0; i--) {
      sc = SCOPES[i];
      if (Object.prototype.hasOwnProperty.call(sc, name)) return sc[name];
    }
    return null;
  }

  // -------- cryptBytes + KCHAIN --------
  // k is NOT stored in the source. Per-slot keys are chained: the first
  // slot's k is derived from KCHAIN and K, subsequent slots step the chain.
  // Both k and q appear in emitted source as <the slot index> only — the
  // decryptor reconstructs k and q at runtime from K (anti-tamper adjusted).
  var KCHAIN = null;
  function initKChain() {
    KCHAIN = [];
    for (var i = 0; i < 64; i++) KCHAIN.push(1 + rnd(255));
  }
  initKChain();

  function cryptBytes(data) {
    var q = STRIDX;
    var slotChain = (q * 17 + SALT * 5 + 131) % KCHAIN.length;
    var k = (KCHAIN[slotChain] + q) % 256;
    if (k === 0) k = 1;
    var hx = '';
    var i, b, roll, roll2, k2, ok;
    STRIDX++;
    k2 = ((k * 37 + q * 91 + SALT * 13) & 255) || 1;
    roll = (k * 131 + SALT * 17 + q * 29) & 255;
    roll2 = (k2 * 53 + q * 17) & 255;
    for (i = 0; i < data.length; i++) {
      // --- layer 1: chained stream (inner) ---
      roll = (roll * 73 + i * 11 + k) & 255;
      roll2 = (roll2 * 47 + i * 19 + k2) & 255;
      b = (data[i] + k + SALT + (q * 7) + (i * 3)) & 255;
      b = b ^ roll;
      b = (b + roll2) & 255;
      // --- layer 2: outer XOR + nibble-swap (keyed by slot+index) ---
      ok = ((q * 31 + 17 + i * 13) & 255) || 1;
      b = b ^ ok;
      b = ((b & 15) << 4) | (b >> 4);
      hx += (b < 16 ? '0' : '') + b.toString(16);
    }
    // record the ciphertext + slot index; the runtime reconstructs k/q
    return { hex: hx, slot: q };
  }

  // -------- string emission --------
  function emitStrTok(tok) {
    var data;
    if (tok[0] === 'LSTR') {
      var lv = tok[2];
      var inner = tok[1].substring(2 + lv.length, tok[1].length - 2 - lv.length);
      data = utf8bytes(inner);
    } else {
      data = decodeShort(tok[3]);
      if (data === null) { emit(tok[1]); stats.str_plain++; return; }
    }
    var la = look(0);
    if (la[1] === '=' && BRACE > 0) { emit(tok[1]); stats.str_plain++; return; }
    if (!doStrings) { emit(tok[1]); stats.str_plain++; return; }
    var ck = cryptBytes(data);
    POOL.push(ck);
    var ph = POOLPFX + (POOL.length - 1);
    if (PREV === '[' && la[1] === ']') emit('[' + ph + ']');
    // Avoid double-parens: _E(x)((y)) can fail on some executors; emit bare call
    else if (PREV === '(' || PREV === ',') emit(ph);
    else emit('(' + ph + ')');
    stats.str_enc++;
  }

  // -------- numbers (fixed) --------
  function emitNum(text) {
    if (!doNumbers) { emit(text); return; }
    var t = text.replace(/_/g, '');
    var mhex = t.match(/^0[xX]([0-9a-fA-F]+)$/);
    if (mhex) {
      var hv = parseInt(mhex[1], 16);
      if (hv >= 0 && hv <= 0xFFFFFFFF) {
        var kk = rnd(5);
        if (kk === 0) emit('(0x' + hv.toString(16) + ')');
        else if (kk === 1) emit('(' + hv + ')');
        else if (kk === 2 && hv > 3) { var hi = Math.floor(hv / 65536), lo = hv - hi * 65536; emit('(' + hi + '*65536+' + lo + ')'); }
        else if (kk === 3) { var a = rnd(hv + 1); emit('(' + a + '+' + (hv - a) + ')'); }
        else emit('(0x' + hv.toString(16) + ')');
        stats.num_mangled++;
        return;
      }
      emit(text); return;
    }
    var mbin = t.match(/^0[bB]([01]+)$/);
    if (mbin) {
      var bv = parseInt(mbin[1], 2);
      if (bv >= 0 && bv <= 0xFFFFFFFF) {
        var kkb = rnd(3);
        if (kkb === 0) emit('(' + bv + ')');
        else if (kkb === 1 && bv > 3) { var hib = Math.floor(bv / 65536), lob = bv - hib * 65536; emit('(' + hib + '*65536+' + lob + ')'); }
        else emit('(' + bv + ')');
        stats.num_mangled++;
        return;
      }
      emit(text); return;
    }
    if (/^[0-9]+$/.test(t)) {
      var v = parseInt(t, 10);
      if (v >= 0 && v <= 0x1FFFFFFFFFFFFF) {
        var mode = rnd(doMba ? 6 : 4);
        if (mode === 0) emit('0x' + v.toString(16));
        else if (mode === 1) { var a = rnd(v + 1); emit('(' + a + '+' + (v - a) + ')'); }
        else if (mode === 2 && v > 3) { var hi3 = Math.floor(v / 65536), lo3 = v - hi3 * 65536; emit('(' + hi3 + '*65536+' + lo3 + ')'); }
        else if (mode === 3 && v > 0) { var t2 = rnd(v + 1); emit('((' + (v - t2) + ')+' + t2 + ')'); }
        else if (doMba && mode === 4 && v > 3) emit('((' + (v * 2) + ')-(' + v + '))');
        else { var a2 = rnd(v + 1); emit('(' + a2 + '+' + (v - a2) + ')'); }
        stats.num_mangled++;
        return;
      }
      emit('tonumber("' + t + '")');
      stats.num_mangled++;
      return;
    }
    if (/^[0-9][0-9_]*(\.[0-9_]*)?([eE][+-]?[0-9]+)?$/.test(t)) {
      var fv = parseFloat(t);
      if (fv === fv) {
        var delta = (1 + rnd(7)) * (rnd(2) ? 0.001 : 0.01);
        var kd = rnd(4);
        if (kd === 0) emit('(' + (fv + delta) + '-' + delta + ')');
        else if (kd === 1) emit('(' + fv + ' * 2 - ' + fv + ')');
        else if (kd === 2) emit('(' + (fv * 1000) + ' * 0.001)');
        else emit(t);
        if (kd !== 3) { stats.num_mangled++; return; }
      }
    }
    emit(text);
  }

  // -------- opaque predicates (non-foldable) --------
  function opaqueTrue() {
    var k = rnd(6);
    if (k === 0) return "((#'\\x1f\\x20\\x1e')==3)";
    if (k === 1) return "((#'\\x01\\x02\\x03\\x04')==4)";
    if (k === 2) return "((1+2)*3==9)";
    if (k === 3) return "(({1,2,3})[3]==3)";
    if (k === 4) return "((tostring(0)=='0'))";
    return '((#\"\\x00\\x01\\x02\")==3)';
  }
  function opaqueFalse() {
    var k = rnd(4);
    if (k === 0) return "((#'\\x00\\x00\\x00\\x00')==3)";
    if (k === 1) return "(({1,2})[1]==2)";
    if (k === 2) return '((1+2)*3==8)';
    return '(1==0)';
  }

  // -------- identifier emission (with hideEnv) --------
  function emitId(name) {
    if (PREV !== '.' && PREV !== ':') {
      var la = look(0);
      if (!(la[1] === '=' && BRACE > 0)) {
        var nn = doRename ? resolve(name) : null;
        if (nn) { emit(nn); stats.renamed++; return; }
        if (doHideEnv && ENV_NAMES[name]) {
          var data = utf8bytes(name);
          var ck = cryptBytes(data);
          POOL.push(ck);
          var ph = POOLPFX + (POOL.length - 1);
          // Delta rejects f()(args). Single-call IIFE with randomized locals.
          if (la[1] === '(') {
            var t1 = _rsym(2 + rnd(2)), t2 = _rsym(2 + rnd(2));
            emit('(function(...)\nlocal ' + t1 + '=' + ENVFN + '(' + ph + ')\nreturn ' + t1 + '(...)\nend)');
          } else {
            emit(ENVFN + '(' + ph + ')');
          }
          stats.env_enc = (stats.env_enc || 0) + 1;
          return;
        }
      }
    }
    emit(name);
  }

  // -------- pool builder --------
  function buildPoolCode(pool, delayStr) {
    var nreal = pool.length;
    if (nreal === 0) {
      return {
        code: '',
        access: function () { return '(' + PREFIX + 'P0[1])'; },
        slotCount: 0, poolCount: 0, decCount: 0
      };
    }
    var NP = Math.min(6, Math.max(3, Math.ceil(nreal / 20)));
    var subPools = [];
    var i, j;
    for (i = 0; i < NP; i++) subPools.push([]);
    var off = rnd(NP);
    for (i = 0; i < nreal; i++) {
      var p = (i + off) % NP;
      subPools[p].push({ idx: i, entry: pool[i] });
    }
    var seeds = [];
    for (i = 0; i < NP; i++) {
      var idxs = [];
      for (j = 0; j < subPools[i].length; j++) idxs.push(j);
      for (j = idxs.length - 1; j > 0; j--) {
        var sw = rnd(j + 1);
        var tmp = idxs[j]; idxs[j] = idxs[sw]; idxs[sw] = tmp;
      }
      seeds.push(idxs);
    }
    var NDEC = Math.min(6, Math.max(1, Math.floor(nreal / 40)));

    // Decryptor: reconstructs k and q from slot + K (K is anti-tamper-adjusted
    // SALT). The chain step is (slot * 17 + K*5 + 131) % 64; the per-slot key
    // is ((KCHAIN[chainStep] + slot) % 256) — KCHAIN is embedded inline via
    // a compact string. To keep source short we store KCHAIN in the decryptor
    // preamble as a single decimal digit string and index it.
    var chainPacked = '';
    for (i = 0; i < KCHAIN.length; i++) {
      chainPacked += (KCHAIN[i] < 10 ? '00' : (KCHAIN[i] < 100 ? '0' : '')) + KCHAIN[i];
    }
    // Random internal names (bound from outer scope when available)
    var chN = (typeof CHVAR !== 'undefined' && CHVAR) ? CHVAR : (PREFIX + 'c');
    var bxN = (typeof BXFN !== 'undefined' && BXFN) ? BXFN : (PREFIX + 'x');
    var kyN = (typeof KEYFN !== 'undefined' && KEYFN) ? KEYFN : (PREFIX + 'y');
    // Per-decryptor random local names to break template matching
    function rloc() {
      var s = '', k;
      for (k = 0; k < 2 + rnd(2); k++) s += _alpha.charAt(rnd(26));
      return s;
    }

    var decCode = '';
    decCode += 'local ' + chN + '="' + chainPacked + '"\n'
      + 'local function ' + bxN + '(a,b)\n'
      + 'a=a%256\nb=b%256\nlocal r=0\n'
      + 'for i=0,7 do\n'
      + 'local x=a%2\nlocal y=b%2\n'
      + 'if x~=y then r=r+2^i end\n'
      + 'a=math.floor(a/2)\nb=math.floor(b/2)\n'
      + 'end\nreturn r\nend\n'
      + 'local function ' + kyN + '(s,kk)\n'
      + 'local p=((s*17+kk*5+131)%' + KCHAIN.length + ')*3+1\n'
      + 'local v=tonumber(' + chN + ':sub(p,p+2))\n'
      + 'local k=(v+s)%256\nif k==0 then k=1 end\nreturn k\nend\n';

    // Dual decryptor styles (forward + reverse) — both multi-line for Delta
    NDEC = Math.min(6, Math.max(2, NDEC));
    var decNames = [];
    for (i = 0; i < NDEC; i++) {
      var dn = PREFIX + rloc() + i.toString(36);
      decNames.push(dn);
      var lk = rloc(), lq = rloc(), lk2 = rloc(), lr = rloc(), lr2 = rloc(), lrs = rloc(), lb = rloc(), lp = rloc();
      // lok = outer-layer key local name
      var lok = rloc();
      if (i % 2 === 0) {
        // forward scan — reverse layer2 then layer1
        decCode += 'local function ' + dn + '(h,s,K)\n'
          + 'local ' + lk + '=' + kyN + '(s,K)\n'
          + 'local ' + lq + '=s\n'
          + 'local ' + lk2 + '=((' + lk + '*37+' + lq + '*91+K*13)%256)\n'
          + 'if ' + lk2 + '==0 then ' + lk2 + '=1 end\n'
          + 'local ' + lr + '=(' + lk + '*131+K*17+' + lq + '*29)%256\n'
          + 'local ' + lr2 + '=(' + lk2 + '*53+' + lq + '*17)%256\n'
          + 'local ' + lrs + '={}\n'
          + 'for i=1,#h,2 do\n'
          + 'local ' + lp + '=(i+1)/2\n'
          + lr + '=(' + lr + '*73+(' + lp + '-1)*11+' + lk + ')%256\n'
          + lr2 + '=(' + lr2 + '*47+(' + lp + '-1)*19+' + lk2 + ')%256\n'
          + 'local ' + lb + '=tonumber(h:sub(i,i+1),16)\n'
          // layer 2 reverse: nibble-swap (self-inverse) then XOR outer key
          + 'local ' + lok + '=((' + lq + '*31+17+(' + lp + '-1)*13)%256)\n'
          + 'if ' + lok + '==0 then ' + lok + '=1 end\n'
          + lb + '=(((' + lb + '%16)*16)+math.floor(' + lb + '/16))%256\n'
          + lb + '=' + bxN + '(' + lb + ',' + lok + ')\n'
          // layer 1 reverse
          + lb + '=((' + lb + '-' + lr2 + ')%256+256)%256\n'
          + lb + '=' + bxN + '(' + lb + ',' + lr + ')\n'
          + lb + '=((' + lb + '-' + lk + '-K-(' + lq + '*7)-((' + lp + '-1)*3))%256+256)%256\n'
          + lrs + '[#' + lrs + '+1]=string.char(' + lb + ')\n'
          + 'end\n'
          + 'return table.concat(' + lrs + ')\n'
          + 'end\n';
      } else {
        // alternate local structure, same two-layer reverse
        decCode += 'local function ' + dn + '(h,s,K)\n'
          + 'local ' + lk + '=' + kyN + '(s,K)\n'
          + 'local ' + lq + '=s\n'
          + 'local ' + lk2 + '=((' + lk + '*37+' + lq + '*91+K*13)%256)\n'
          + 'if ' + lk2 + '==0 then ' + lk2 + '=1 end\n'
          + 'local ' + lr + '=(' + lk + '*131+K*17+' + lq + '*29)%256\n'
          + 'local ' + lr2 + '=(' + lk2 + '*53+' + lq + '*17)%256\n'
          + 'local ' + lrs + '={}\n'
          + 'local ' + lp + '=0\n'
          + 'for i=1,#h,2 do\n'
          + lp + '=' + lp + '+1\n'
          + lr + '=(' + lr + '*73+(' + lp + '-1)*11+' + lk + ')%256\n'
          + lr2 + '=(' + lr2 + '*47+(' + lp + '-1)*19+' + lk2 + ')%256\n'
          + 'local ' + lb + '=tonumber(h:sub(i,i+1),16)\n'
          + 'local ' + lok + '=((' + lq + '*31+17+(' + lp + '-1)*13)%256)\n'
          + 'if ' + lok + '==0 then ' + lok + '=1 end\n'
          + lb + '=(((' + lb + '%16)*16)+math.floor(' + lb + '/16))%256\n'
          + lb + '=' + bxN + '(' + lb + ',' + lok + ')\n'
          + lb + '=((' + lb + '-' + lr2 + ')%256+256)%256\n'
          + lb + '=' + bxN + '(' + lb + ',' + lr + ')\n'
          + lb + '=((' + lb + '-' + lk + '-K-(' + lq + '*7)-((' + lp + '-1)*3))%256+256)%256\n'
          + lrs + '[' + lp + ']=string.char(' + lb + ')\n'
          + 'end\n'
          + 'return table.concat(' + lrs + ')\n'
          + 'end\n';
      }
    }

    // Index-base offsets for computed pool access (hides P[1], P[2] literals)
    var poolCode = '';
    var allSlotInfo = {};
    var poolNames = [];
    var indexBases = [];
    for (i = 0; i < NP; i++) {
      poolNames.push(PREFIX + rloc() + 't' + i.toString(36));
      indexBases.push(1 + rnd(17)); // access as P[base + delta]
    }
    for (i = 0; i < NP; i++) {
      var entries = [];
      // Pad front with decoy nils so real entries sit at base+delta
      var base = indexBases[i];
      var pad = [];
      for (j = 1; j < base; j++) pad.push('0');
      for (j = 0; j < seeds[i].length; j++) {
        var e = subPools[i][seeds[i][j]];
        var didx = rnd(NDEC);
        var dn2 = decNames[didx];
        if (delayStr) {
          entries.push('function() local v=' + dn2 + '("' + e.entry.hex + '",' + e.entry.slot + ',' + PREFIX + 'K) return function() return v end end');
        } else {
          entries.push('function() return ' + dn2 + '("' + e.entry.hex + '",' + e.entry.slot + ',' + PREFIX + 'K) end');
        }
        allSlotInfo[e.idx] = { pool: i, shuffledIdx: base + j, base: base, delta: j };
      }
      if (entries.length > 0) {
        poolCode += 'local ' + poolNames[i] + '={' + pad.concat(entries).join(',') + '}\n';
      }
    }
    decCode += poolCode;

    function access(slotIdx) {
      var info = allSlotInfo[slotIdx];
      if (!info) return poolNames[0] + '[1]';
      // Computed index: P[(base)+(delta)] or P[base+delta] with opaque form
      var form = rnd(3);
      if (form === 0) {
        return poolNames[info.pool] + '[' + info.base + '+' + info.delta + ']';
      } else if (form === 1) {
        return poolNames[info.pool] + '[' + (info.base + info.delta) + ']';
      } else {
        var a = info.base + rnd(3);
        var b = a - info.base;
        return poolNames[info.pool] + '[' + a + '-' + b + '+' + info.delta + ']';
      }
    }

    return {
      code: decCode,
      access: access,
      slotCount: nreal,
      poolCount: NP,
      decCount: NDEC
    };
  }

  // -------- statement scanning (unchanged) --------
  function collectStmt() {
    var start = POS, bd = 0, last = '=', tk, k, t, stack = [], top;
    for (;;) {
      tk = peek(); k = tk[0]; t = tk[1];
      if (k === null) break;
      if (k === 'SYM' && (t === '(' || t === '[' || t === '{')) bd++;
      else if (k === 'SYM' && (t === ')' || t === ']' || t === '}')) {
        bd--;
        if (bd < 0) fail('unbalanced bracket in statement');
      }
      if (k === 'KW') {
        if (t === 'function' || t === 'if' || t === 'repeat') stack.push(t);
        else if (t === 'for' || t === 'while') stack.push({w:t, head:true, pd:bd});
        else if (t === 'do') {
          top = stack.length ? stack[stack.length - 1] : null;
          if (top && typeof top !== 'string' && top.head && bd === top.pd) top.head = false;
          else stack.push('do');
        }
        else if (t === 'end' || t === 'until') {
          if (!stack.length) fail('unbalanced block in statement');
          top = stack.pop();
          if ((t === 'end' && top === 'repeat') || (t === 'until' && top !== 'repeat'))
            fail('mismatched block in statement');
        }
      }
      POS++;
      last = t;
      var complete = (COMPLETE_K[k] === 1) ||
        ((k === 'KW' || k === 'SYM') && COMPLETE_V[t] === 1);
      if (bd === 0 && !stack.length && complete) {
        var la = peek();
        if (la[0] === null || la[1] === ';') {
          if (la[0] !== null) POS++;
          break;
        }
        if (la[0] === 'KW' && BLOCK_KW[la[1]]) break;
        if (la[0] === 'ID' || la[0] === 'NUM' || la[0] === 'STR' || la[0] === 'LSTR') {
          if (!((k === 'ID' && (la[1] === '(' || la[1] === '{')) ||
                (k === 'ID' && (la[0] === 'STR' || la[0] === 'LSTR')))) break;
        }
      }
    }
    return T.slice(start, POS);
  }

  function runBuf(buf, base) {
    var sT = T, sP = POS, sO = OUT, sB = BRACE, sPrev = PREV, chunk, i;
    BASEST.push(BASE); BASE = base;
    T = buf; POS = 0; OUT = [];
    parseBlock([]);
    if (POS !== buf.length) fail('trailing tokens in buffer');
    chunk = OUT;
    T = sT; POS = sP; OUT = sO; BRACE = sB; PREV = sPrev;
    BASE = BASEST.pop();
    for (i = 0; i < chunk.length; i++) emit(chunk[i]);
  }

  function parseBlock(stops) {
    var tk;
    for (;;) {
      tk = peek();
      if (tk[0] === null) {
        if (stops.length) fail('eof, wanted ' + stops.join('/'));
        return;
      }
      if (tk[0] === 'KW' && contains(stops, tk[1])) return;
      if (tk[0] === 'KW' && (tk[1] === 'end' || tk[1] === 'else' || tk[1] === 'elseif' || tk[1] === 'until'))
        fail('unexpected ' + tk[1]);
      parseStmt();
    }
  }

  function parseStmt() {
    var tk = peek();
    if (tk[0] === 'KW' && tk[1] === 'local') parseLocal();
    else if (tk[0] === 'KW' && tk[1] === 'function') parseFunction();
    else if (tk[0] === 'KW' && tk[1] === 'if') parseIf();
    else if (tk[0] === 'KW' && tk[1] === 'while') {
      nxt(); emit('while');
      if (doOpaque && rnd() < density) { emit(opaqueTrue()); emit('and'); stats.opaque = (stats.opaque || 0) + 1; }
      parseUntilKw('do');
      expect('do');
      push(); parseBlock(['end']); expect('end'); pop();
    }
    else if (tk[0] === 'KW' && tk[1] === 'for') parseFor();
    else if (tk[0] === 'KW' && tk[1] === 'repeat') {
      nxt(); emit('repeat');
      push(); parseBlock(['until']); expect('until');
      var ubs = POS, ubuf = collectStmt();
      runBuf(ubuf, BASE + ubs);
      pop();
    }
    else if (tk[0] === 'KW' && tk[1] === 'do') {
      nxt(); emit('do');
      push(); parseBlock(['end']); expect('end'); pop();
    }
    else parseTail();
  }

  function parseTail() {
    var tk, k, t, tok;
    for (;;) {
      tk = peek(); k = tk[0]; t = tk[1];
      if (k === null) return;
      if (k === 'KW' && (t === 'end' || t === 'else' || t === 'elseif' || t === 'until')) return;
      if (k === 'KW' && (t === 'local' || t === 'function' || t === 'if' || t === 'while' ||
          t === 'for' || t === 'repeat' || t === 'do')) { parseStmt(); continue; }
      tok = nxt();
      if (k === 'STR' || k === 'LSTR') emitStrTok(tok);
      else if (k === 'NUM') emitNum(t);
      else if (k === 'ID') emitId(t);
      else { emit(t); track(t); }
    }
  }

  function parseUntilKw(stop) {
    var tk, k, t, tok;
    for (;;) {
      tk = peek(); k = tk[0]; t = tk[1];
      if (k === null) fail('eof seeking ' + stop);
      if (k === 'KW' && t === 'function') { parseFunction(); continue; }
      if (k === 'KW' && (t === 'if' || t === 'while' || t === 'for' || t === 'repeat')) { parseStmt(); continue; }
      if (k === 'KW' && t === stop) return;
      tok = nxt();
      if (k === 'STR' || k === 'LSTR') emitStrTok(tok);
      else if (k === 'NUM') emitNum(t);
      else if (k === 'ID') emitId(t);
      else { emit(t); track(t); }
    }
  }

  function parseLocal() {
    nxt();
    var tk = peek(), i, tok, names, fresh, lbs, lbuf;
    if (tk[0] === 'KW' && tk[1] === 'function') {
      nxt(); emit('local'); emit('function');
      tok = nxt(); emit(declare(tok[1]));
      parseBody(); return;
    }
    names = [];
    for (;;) {
      tok = nxt();
      if (tok[0] !== 'ID') fail('bad local name ' + tok[1]);
      names.push(tok[1]);
      tk = peek();
      if (tk[0] === 'SYM' && tk[1] === ',') { nxt(); continue; }
      break;
    }
    tk = peek();
    if (tk[0] === 'SYM' && tk[1] === '=') {
      nxt();
      var lbs2 = POS, lbuf2 = collectStmt();
      fresh = [];
      for (i = 0; i < names.length; i++) fresh.push(declare(names[i]));
      emit('local');
      for (i = 0; i < fresh.length; i++) { if (i) emit(','); emit(fresh[i]); }
      emit('=');
      runBuf(lbuf2, BASE + lbs2);
    } else {
      emit('local');
      for (i = 0; i < names.length; i++) {
        if (i) emit(',');
        emit(declare(names[i]));
      }
    }
  }

  function parseFunction() {
    nxt(); emit('function');
    var tk = peek(), tok;
    if (tk[0] === 'ID') {
      nxt(); emitId(tk[1]);
      for (;;) {
        tk = peek();
        if (tk[0] === 'SYM' && (tk[1] === '.' || tk[1] === ':')) {
          nxt(); emit(tk[1]);
          tok = nxt(); emit(tok[1]);
        } else break;
      }
    }
    parseBody();
  }

  function parseBody() {
    expect('(');
    push();
    var tok, k, t;
    for (;;) {
      tok = nxt(); k = tok[0]; t = tok[1];
      if (k === 'SYM' && t === ')') { emit(')'); break; }
      if (k === 'SYM' && t === ',') { emit(','); continue; }
      if (k === 'SYM' && t === '...') { emit('...'); continue; }
      if (k === 'ID') { emit(declare(t)); continue; }
      fail('bad param ' + t);
    }
    parseBlock(['end']);
    expect('end');
    pop();
  }

  function parseIf() {
    nxt(); emit('if');
    if (doOpaque && rnd() < density) { emit(opaqueTrue()); emit('and'); stats.opaque = (stats.opaque || 0) + 1; }
    parseUntilKw('then'); expect('then');
    var tk;
    for (;;) {
      push(); parseBlock(['elseif', 'else', 'end']); pop();
      tk = peek();
      if (tk[0] === 'KW' && tk[1] === 'elseif') {
        nxt(); emit('elseif'); parseUntilKw('then'); expect('then'); continue;
      }
      if (tk[0] === 'KW' && tk[1] === 'else') { nxt(); emit('else'); continue; }
      expect('end'); return;
    }
  }

  function parseFor() {
    nxt();
    var names = [], tk, tok, i, mode;
    for (;;) {
      tok = nxt();
      if (tok[0] !== 'ID') fail('bad for name');
      names.push(tok[1]);
      tk = peek();
      if (tk[0] === 'SYM' && tk[1] === ',') { nxt(); continue; }
      break;
    }
    tk = peek();
    if (tk[0] === 'SYM' && tk[1] === '=') mode = '=';
    else if (tk[0] === 'KW' && tk[1] === 'in') mode = 'in';
    else fail('bad for header');
    nxt();
    var start = POS, pd = 0, hdr, hdrOut, j;
    for (;;) {
      tk = peek();
      if (tk[0] === null) fail('eof in for header');
      if (tk[0] === 'SYM' && (tk[1] === '(' || tk[1] === '[' || tk[1] === '{')) pd++;
      else if (tk[0] === 'SYM' && (tk[1] === ')' || tk[1] === ']' || tk[1] === '}')) pd--;
      if (tk[0] === 'KW' && tk[1] === 'do' && pd === 0) break;
      nxt();
    }
    hdr = T.slice(start, POS);
    for (j = 0; j < hdr.length; j++) {
      if (hdr[j][0] === 'KW' && hdr[j][1] === 'function')
        fail('function in for-header unsupported');
    }
    nxt();
    push();
    var sT = T, sP = POS, sO = OUT, sB = BRACE, sPrev = PREV;
    BASEST.push(BASE); BASE = BASE + start;
    T = hdr; POS = 0; OUT = [];
    parseTail();
    if (POS !== hdr.length) fail('trailing tokens in for-header');
    hdrOut = OUT;
    T = sT; POS = sP; OUT = sO; BRACE = sB; PREV = sPrev;
    BASE = BASEST.pop();
    var fresh = [];
    for (i = 0; i < names.length; i++) fresh.push(declare(names[i]));
    emit('for');
    for (i = 0; i < fresh.length; i++) { if (i) emit(','); emit(fresh[i]); }
    emit(mode);
    for (i = 0; i < hdrOut.length; i++) emit(hdrOut[i]);
    emit('do');
    parseBlock(['end']);
    expect('end');
    pop();
  }

  // -------- render (stringify tokens) --------
  function render(pieces) {
    var out = [], prev = '', i, cur, pl, cf;
    for (i = 0; i < pieces.length; i++) {
      cur = pieces[i];
      if (out.length) {
        pl = prev.charAt(prev.length - 1);
        cf = cur.charAt(0);
        if (cur === ',' || cur === ';' || cur === ')' || cur === ']' || cur === '}' ||
            prev === '(' || prev === '[' || prev === '{') { }
        else if (cur === '.' || cur === ':' || prev === '.' || prev === ':') { }
        else if (cur === '(' || prev === ')') { }
        else if ((isAlnum(pl) || pl === '_') && (isAlnum(cf) || cf === '_')) out.push(' ');
        else if (cur === '-' && pl === '-') out.push(' ');
        else if (isDigit(pl) && (isAlnum(cf) || cf === '_' || cf === '.')) out.push(' ');
        else if (isDigit(cf) && (isAlnum(pl) || pl === '_' || pl === '.')) out.push(' ');
        else if (cur === '..' || cur === '...' || prev === '..' || prev === '...') out.push(' ');
      }
      out.push(cur);
      prev = cur;
    }
    return out.join('');
  }

  // -------- CFF: real CFG-based on tokens --------
  // For each `function ... end` in the token array, split its body into
  // statements, verify safe-to-flatten (no mid-body return/break/goto/continue,
  // no repeat-until body that must preserve do-while semantics), then wrap.
  // Skips bodies smaller than CFF_MIN_STMTS statements.
  function applyCFF(tokens, prefix, seedTag) {
    var CFF_MIN_STMTS = 5;
    var out = [];
    var i = 0;
    var n = tokens.length;

    function findBodyEnd(startIdx) {
      // Finds the index of the `end` that closes a block opened at startIdx.
      // Tokens are rendered; openers are function/if/do/while/for/repeat.
      // We do not descend into the string that a return may contain.
      var stack = [];
      var k = startIdx;
      while (k < n) {
        var t = tokens[k];
        if (t === 'function' || t === 'if' || t === 'do' || t === 'while' || t === 'for') {
          stack.push(t);
        } else if (t === 'repeat') {
          stack.push('repeat');
        } else if (t === 'end') {
          if (!stack.length) return k;
          stack.pop();
        } else if (t === 'until') {
          if (stack.length && stack[stack.length - 1] === 'repeat') stack.pop();
        }
        k++;
      }
      return -1;
    }

    while (i < n) {
      var t = tokens[i];
      if (t !== 'function') { out.push(t); i++; continue; }
      out.push(t); i++;
      // Skip parameters
      var paren = 0;
      while (i < n) {
        var tk = tokens[i];
        if (tk === '(') paren++;
        else if (tk === ')') { paren--; if (paren === 0) { out.push(tk); i++; break; } }
        out.push(tk); i++;
      }
      var bodyStart = i;
      var bodyEnd = findBodyEnd(bodyStart);
      if (bodyEnd < 0) { i = bodyStart; continue; }

      // Safety: no return/break/goto/continue at depth 0 in body
      var d = 0, k2 = bodyStart, safe = true, hasBlock = false;
      while (k2 < bodyEnd) {
        var tk2 = tokens[k2];
        if (tk2 === '(' || tk2 === '[' || tk2 === '{') d++;
        else if (tk2 === ')' || tk2 === ']' || tk2 === '}') d--;
        else if (d === 0) {
          if (tk2 === 'return' || tk2 === 'break' || tk2 === 'continue' || tk2 === 'goto') { safe = false; break; }
          // Nested function/if/while/for/do/repeat are fine (they end in `end` or `until`).
        }
        k2++;
      }
      if (!safe) {
        // Copy body verbatim
        for (var q = bodyStart; q < bodyEnd; q++) out.push(tokens[q]);
        out.push(tokens[bodyEnd]); i = bodyEnd + 1; continue;
      }

      // Split into statements at depth-0 `;` or heuristic boundaries
      var stmts = [];
      var st = bodyStart, d2 = 0, k3 = bodyStart;
      while (k3 < bodyEnd) {
        var tk3 = tokens[k3];
        if (tk3 === '(' || tk3 === '[' || tk3 === '{') d2++;
        else if (tk3 === ')' || tk3 === ']' || tk3 === '}') d2--;
        else if (d2 === 0) {
          if (tk3 === ';') {
            stmts.push(tokens.slice(st, k3));
            st = k3 + 1;
          } else if (tk3 === 'local' || tk3 === 'function' || tk3 === 'if' ||
                     tk3 === 'while' || tk3 === 'for' || tk3 === 'repeat' ||
                     tk3 === 'do' || tk3 === 'return') {
            // Check if previous token ended a statement
            if (st < k3) { stmts.push(tokens.slice(st, k3)); st = k3; }
          }
        }
        k3++;
      }
      if (st < bodyEnd) stmts.push(tokens.slice(st, bodyEnd));

      if (stmts.length < CFF_MIN_STMTS) {
        for (var q2 = bodyStart; q2 < bodyEnd; q2++) out.push(tokens[q2]);
        out.push(tokens[bodyEnd]); i = bodyEnd + 1; continue;
      }

      // Collect locals declared in this body (to hoist for scope preservation)
      // We don't actually need to hoist if dispatch is `while true do ... end`
      // and we inject the body inside the while — but locals declared in the
      // body would be visible outside only if we keep `end` at same level.
      // Solution: keep `local` declarations as first statements of block 0
      // inside the while — which is legal, but a `return` at the end exits
      // the while AND the function together. Fine.

      var N = stmts.length;
      var sv = prefix + 's' + (COUNTER++);
      // Encode states as (_s * KMUL + KADD) % N
      var KMUL = 3 + rnd(97);
      var KADD = 1 + rnd(251);
      var stateSeq = [];
      for (var si = 0; si < N; si++) stateSeq.push(si);

      // Emit dispatch
      out.push('local ' + sv + '=');
      out.push('' + (0 * KMUL + KADD)); // encoded state 0
      out.push(';');
      out.push('while true do');
      // Decode state to var _cur
      var cur = prefix + 'u' + (COUNTER++);
      out.push('local ' + cur + '=');
      out.push('((' + sv + '-' + KADD + ')*' + rnd(97) + ')%' + N + ');');
      // Technically that's wrong math (multiplication by arbitrary constant
      // doesn't reverse the modulo). Simpler: emit direct state var and
      // dispatch with opacity through the while condition itself.
      // Replace above with a safe form: state var is the decoded value; the
      // opaque check gates the "loop must terminate" invariant.
      out.pop(); out.pop(); out.pop();
      out.push('local ' + cur + '=0;');
      out.push('while (' + sv + '==' + sv + ') do');
      // Chained if/elseif dispatch
      for (var bi = 0; bi < N; bi++) {
        var isFirst = (bi === 0);
        var isLast = (bi === N - 1);
        out.push(isFirst ? 'if ' : 'elseif ');
        out.push(cur + '==' + bi);
        out.push(' then ');
        // Emit statement tokens
        for (var ti = 0; ti < stmts[bi].length; ti++) out.push(stmts[bi][ti]);
        out.push(';');
        if (!isLast) {
          out.push(cur + '=' + (bi + 1) + ';');
        } else {
          out.push('break;');
        }
      }
      out.push('end');  // end of if/elseif
      out.push('end');  // end of while (dispatch loop)
      out.push(tokens[bodyEnd]); // the original `end`
      i = bodyEnd + 1;
    }
    return out;
  }

  // -------- VM shell (real stack-machine) --------
  function buildVmShell(payload, prefix, stats) {
    var OP = {
      PUSHN: rnd(256), PUSHS: rnd(256),
      PUSHNIL: rnd(256), PUSHTRUE: rnd(256), PUSHFALSE: rnd(256),
      POP: rnd(256), DUP: rnd(256),
      ADD: rnd(256), SUB: rnd(256), MUL: rnd(256), DIV: rnd(256),
      MOD: rnd(256), POW: rnd(256), CAT: rnd(256),
      EQ: rnd(256), NE: rnd(256), LT: rnd(256), LE: rnd(256), GT: rnd(256), GE: rnd(256),
      NOT: rnd(256), NEG: rnd(256), LEN: rnd(256),
      JMP: rnd(256), JZ: rnd(256), JNZ: rnd(256),
      LOADK: rnd(256), STOREK: rnd(256),
      GETG: rnd(256), SETG: rnd(256),
      INDEX: rnd(256), SETINDEX: rnd(256),
      CALL: rnd(256), RETURN: rnd(256),
      HALT: rnd(256),
      CONCATN: rnd(256), MAKEARR: rnd(256),
      PRINT: rnd(256)
    };

    var code = [];
    var nums = [];
    var strs = [];

    function nIdx(v) { for (var q = 0; q < nums.length; q++) if (nums[q] === v) return q; nums.push(v); return nums.length - 1; }
    function sIdx(v) { for (var q = 0; q < strs.length; q++) if (strs[q] === v) return q; strs.push(v); return strs.length - 1; }

    var toks;
    try { toks = tokenize(payload); } catch (e) { return { code: null, reason: 'tokenize failed: ' + e.message }; }

    var i = 0;
    var locals = {};
    var nlocals = 0;

    function compileExpr(term) {
      var p = 0;
      function peekT() { return term[p]; }
      function nextT() { return term[p++]; }
      function parsePrimary() {
        var t = peekT();
        if (!t) return false;
        if (t[0] === 'NUM') { code.push([OP.PUSHN, nIdx(parseFloat(t[1].replace(/_/g, '')))]); nextT(); return true; }
        if (t[0] === 'STR') {
          var raw = t[3];
          var bytes = decodeShort(raw);
          if (bytes === null) return false;
          var s = '';
          for (var k = 0; k < bytes.length; k++) s += String.fromCharCode(bytes[k]);
          code.push([OP.PUSHS, sIdx(s)]); nextT(); return true;
        }
        if (t[1] === 'nil')   { code.push([OP.PUSHNIL, 0]);   nextT(); return true; }
        if (t[1] === 'true')  { code.push([OP.PUSHTRUE, 0]);  nextT(); return true; }
        if (t[1] === 'false') { code.push([OP.PUSHFALSE, 0]); nextT(); return true; }
        if (t[1] === '(') {
          nextT();
          if (!parseExpr()) return false;
          if (!peekT() || peekT()[1] !== ')') return false;
          nextT(); return true;
        }
        if (t[0] === 'ID' && locals[t[1]] !== undefined) {
          code.push([OP.LOADK, locals[t[1]]]); nextT(); return true;
        }
        return false;
      }
      function parseUnary() {
        var t = peekT();
        if (t && t[1] === '-')   { nextT(); if (!parseUnary()) return false; code.push([OP.NEG, 0]); return true; }
        if (t && t[1] === 'not') { nextT(); if (!parseUnary()) return false; code.push([OP.NOT, 0]); return true; }
        if (t && t[1] === '#')   { nextT(); if (!parseUnary()) return false; code.push([OP.LEN, 0]); return true; }
        return parsePrimary();
      }
      function parseExpr() {
        if (!parseUnary()) return false;
        for (;;) {
          var t = peekT();
          if (!t) return true;
          var op = t[1];
          if (op === '+')   { nextT(); if (!parseUnary()) return false; code.push([OP.ADD, 0]); }
          else if (op === '-')   { nextT(); if (!parseUnary()) return false; code.push([OP.SUB, 0]); }
          else if (op === '*')   { nextT(); if (!parseUnary()) return false; code.push([OP.MUL, 0]); }
          else if (op === '/')   { nextT(); if (!parseUnary()) return false; code.push([OP.DIV, 0]); }
          else if (op === '%')   { nextT(); if (!parseUnary()) return false; code.push([OP.MOD, 0]); }
          else if (op === '^')   { nextT(); if (!parseUnary()) return false; code.push([OP.POW, 0]); }
          else if (op === '..')  { nextT(); if (!parseUnary()) return false; code.push([OP.CAT, 0]); }
          else if (op === '==')  { nextT(); if (!parseUnary()) return false; code.push([OP.EQ, 0]); }
          else if (op === '~=')  { nextT(); if (!parseUnary()) return false; code.push([OP.NE, 0]); }
          else if (op === '<')   { nextT(); if (!parseUnary()) return false; code.push([OP.LT, 0]); }
          else if (op === '<=')  { nextT(); if (!parseUnary()) return false; code.push([OP.LE, 0]); }
          else if (op === '>')   { nextT(); if (!parseUnary()) return false; code.push([OP.GT, 0]); }
          else if (op === '>=')  { nextT(); if (!parseUnary()) return false; code.push([OP.GE, 0]); }
          else return true;
        }
      }
      return parseExpr();
    }

    try {
      while (i < toks.length) {
        var tk = toks[i];
        if (tk[0] === 'KW' && tk[1] === 'local') {
          i++;
          var name = toks[i];
          if (!name || name[0] !== 'ID') throw new Error('vm: bad local');
          var nm = name[1];
          i++;
          if (!toks[i] || toks[i][1] !== '=') throw new Error('vm: local needs =');
          i++;
          var start = i;
          var d = 0, j = i;
          while (j < toks.length) {
            var tj = toks[j][1];
            if (tj === '(' || tj === '[' || tj === '{') d++;
            else if (tj === ')' || tj === ']' || tj === '}') d--;
            if (d === 0 && j + 1 < toks.length) {
              var nx = toks[j + 1][1];
              if (nx === ';' || nx === 'local' || nx === 'print' || nx === 'return' || nx === 'if' || nx === 'while' || nx === 'for') break;
            }
            j++;
          }
          var exprToks = toks.slice(start, j);
          if (!compileExpr(exprToks)) throw new Error('vm: unsupported expr');
          var reg = nlocals++;
          locals[nm] = reg;
          code.push([OP.STOREK, reg]);
          if (j < toks.length && toks[j][1] === ';') j++;
          i = j;
        } else if (tk[0] === 'ID' && tk[1] === 'print') {
          i++;
          if (toks[i][1] !== '(') throw new Error('vm: print needs (');
          i++;
          var s2 = i, d2 = 1;
          while (i < toks.length && d2 > 0) {
            var tx = toks[i][1];
            if (tx === '(') d2++;
            else if (tx === ')') d2--;
            if (d2 > 0) i++;
          }
          var argToks = toks.slice(s2, i);
          if (!compileExpr(argToks)) throw new Error('vm: unsupported print arg');
          if (!toks[i] || toks[i][1] !== ')') throw new Error('vm: print missing )');
          i++;
          code.push([OP.PRINT, 0]);
        } else {
          throw new Error('vm: unsupported toplevel: ' + tk[1]);
        }
      }
    } catch (e) {
      return { code: null, reason: e.message };
    }
    code.push([OP.HALT, 0]);

    var numPool = 'local ' + prefix + 'N={' + nums.join(',') + '};';
    var strHex = [];
    for (var si = 0; si < strs.length; si++) {
      var s = strs[si];
      var hx = '';
      for (var kk = 0; kk < s.length; kk++) {
        var h = s.charCodeAt(kk).toString(16);
        while (h.length < 4) h = '0' + h;
        hx += h;
      }
      strHex.push(hx);
    }
    var strPool = 'local ' + prefix + 'S={' + strHex.map(function (h) { return '"' + h + '"'; }).join(',') + '};';

    var opEntries = [];
    for (var opName in OP) if (Object.prototype.hasOwnProperty.call(OP, opName)) opEntries.push([OP[opName], opName]);
    for (var oi = opEntries.length - 1; oi > 0; oi--) {
      var osw = rnd(oi + 1);
      var otmp = opEntries[oi]; opEntries[oi] = opEntries[osw]; opEntries[osw] = otmp;
    }
    var tblParts = [];
    for (var tbi = 0; tbi < opEntries.length; tbi++) {
      tblParts.push(opEntries[tbi][0] + ':"' + opEntries[tbi][1] + '"');
    }
    var opTbl = 'local ' + prefix + 'T={' + tblParts.join(',') + '};';

    var bc = '[';
    for (var bi2 = 0; bi2 < code.length; bi2++) {
      if (bi2 > 0) bc += ',';
      bc += '[' + code[bi2][0] + ',' + code[bi2][1] + ']';
    }
    bc += ']';

    var runtime = ''
      + 'local ' + prefix + 'st={};'
      + 'local ' + prefix + 'pc=1;'
      + 'local ' + prefix + 'sp=0;'
      + 'local ' + prefix + 'L={};'
      + 'local function ' + prefix + 'po()local v=' + prefix + 'st[' + prefix + 'sp];' + prefix + 'sp=' + prefix + 'sp-1;return v end;'
      + 'local function ' + prefix + 'pu(v)' + prefix + 'sp=' + prefix + 'sp+1;' + prefix + 'st[' + prefix + 'sp]=v end;'
      + 'local ' + prefix + 'B=' + bc + ';'
      + 'local ' + prefix + 'T=' + opTbl + ';'
      + 'local ' + prefix + 'N=' + numPool + ';'
      + 'local ' + prefix + 'S=' + strPool + ';'
      + 'local function ' + prefix + 'gs(i)local h=' + prefix + 'S[i+1];local o={};for k=1,#h,4 do o[#o+1]=string.char(tonumber(h:sub(k,k+3),16))end;return table.concat(o)end;'
      + 'while true do '
      + 'local op=' + prefix + 'B[' + prefix + 'pc];'
      + 'if not op then break end;'
      + 'local n=' + prefix + 'T[op[1]];'
      + 'local a=op[2];'
      + prefix + 'pc=' + prefix + 'pc+1;'
      + 'if n=="PUSHN"then ' + prefix + 'pu(' + prefix + 'N[a+1])'
      + 'elseif n=="PUSHS"then ' + prefix + 'pu(' + prefix + 'gs(a))'
      + 'elseif n=="PUSHNIL"then ' + prefix + 'pu(nil)'
      + 'elseif n=="PUSHTRUE"then ' + prefix + 'pu(true)'
      + 'elseif n=="PUSHFALSE"then ' + prefix + 'pu(false)'
      + 'elseif n=="POP"then ' + prefix + 'po()'
      + 'elseif n=="DUP"then local v=' + prefix + 'po();' + prefix + 'pu(v);' + prefix + 'pu(v)'
      + 'elseif n=="ADD"then local b=' + prefix + 'po();local a2=' + prefix + 'po();' + prefix + 'pu(a2+b)'
      + 'elseif n=="SUB"then local b=' + prefix + 'po();local a2=' + prefix + 'po();' + prefix + 'pu(a2-b)'
      + 'elseif n=="MUL"then local b=' + prefix + 'po();local a2=' + prefix + 'po();' + prefix + 'pu(a2*b)'
      + 'elseif n=="DIV"then local b=' + prefix + 'po();local a2=' + prefix + 'po();' + prefix + 'pu(a2/b)'
      + 'elseif n=="MOD"then local b=' + prefix + 'po();local a2=' + prefix + 'po();' + prefix + 'pu(a2%b)'
      + 'elseif n=="POW"then local b=' + prefix + 'po();local a2=' + prefix + 'po();' + prefix + 'pu(a2^b)'
      + 'elseif n=="CAT"then local b=' + prefix + 'po();local a2=' + prefix + 'po();' + prefix + 'pu(a2..b)'
      + 'elseif n=="EQ"then local b=' + prefix + 'po();local a2=' + prefix + 'po();' + prefix + 'pu(a2==b)'
      + 'elseif n=="NE"then local b=' + prefix + 'po();local a2=' + prefix + 'po();' + prefix + 'pu(a2~=b)'
      + 'elseif n=="LT"then local b=' + prefix + 'po();local a2=' + prefix + 'po();' + prefix + 'pu(a2<b)'
      + 'elseif n=="LE"then local b=' + prefix + 'po();local a2=' + prefix + 'po();' + prefix + 'pu(a2<=b)'
      + 'elseif n=="GT"then local b=' + prefix + 'po();local a2=' + prefix + 'po();' + prefix + 'pu(a2>b)'
      + 'elseif n=="GE"then local b=' + prefix + 'po();local a2=' + prefix + 'po();' + prefix + 'pu(a2>=b)'
      + 'elseif n=="NOT"then ' + prefix + 'pu(not ' + prefix + 'po())'
      + 'elseif n=="NEG"then ' + prefix + 'pu(-' + prefix + 'po())'
      + 'elseif n=="LEN"then ' + prefix + 'pu(#' + prefix + 'po())'
      + 'elseif n=="JMP"then ' + prefix + 'pc=a'
      + 'elseif n=="JZ"then local v=' + prefix + 'po();if not v then ' + prefix + 'pc=a end'
      + 'elseif n=="JNZ"then local v=' + prefix + 'po();if v then ' + prefix + 'pc=a end'
      + 'elseif n=="LOADK"then ' + prefix + 'pu(' + prefix + 'L[a])'
      + 'elseif n=="STOREK"then ' + prefix + 'L[a]=' + prefix + 'po()'
      + 'elseif n=="PRINT"then local v=' + prefix + 'po();print(v)'
      + 'elseif n=="HALT"then break'
      + 'else error("vm:badop")end end;';

    return { code: runtime, opcodeCount: opEntries.length, instrCount: code.length };
  }

  // -------- anti-tamper (soft-fail, executor-friendly) --------
  function buildAntiTamper() {
    // Extremely soft: never corrupts K on normal 3rd-party executors.
    // Newline-separated for Delta compatibility.
    var P = PREFIX;
    var sm = P + 'sm';
    var lines = [];
    lines.push('local ' + sm + '=186');
    lines.push('do local _=type if _ and _(print)~="function" then ' + sm + '=' + sm + '+0 end end');
    lines.push('do if (1+2)*3~=9 then ' + sm + '=' + sm + '+0 end end');
    lines.push('local _k0=' + (SALT | 0));
    lines.push('local ' + P + 'K=(_k0+((' + sm + '>=160 and ' + sm + '<=260) and 0 or 0))%256');
    return lines.join('\n') + '\n';
  }

  // -------- driver --------
  T = tokenize(src);
  SCOPES = [{}]; OUT = []; BRACE = 0; COUNTER = 0; PREV = '';
  stats = {decls:0, renamed:0, str_enc:0, str_plain:0, num_mangled:0, env_enc:0};
  var idents = {}, idre = /[A-Za-z_][A-Za-z0-9_]*/g, mm;
  while ((mm = idre.exec(src)) !== null) idents[mm[0]] = 1;
  var _alpha = 'abcdefghijklmnopqrstuvwxyz';
  function _randPref(n) {
    var s = '_', i;
    for (i = 0; i < n; i++) s += _alpha.charAt(rnd(26));
    return s;
  }
  PREFIX = _randPref(3);
  var hasPre = true, kk, guard = 0;
  while (hasPre && guard < 40) {
    hasPre = false;
    for (kk in idents) if (kk.substring(0, PREFIX.length) === PREFIX) { hasPre = true; break; }
    if (hasPre) PREFIX = _randPref(3 + (guard >> 3));
    guard++;
  }
  DEC = PREFIX + 'd';
  var di = 0;
  while (Object.prototype.hasOwnProperty.call(idents, DEC)) { di++; DEC = PREFIX + 'd' + di; }
  POOLPFX = PREFIX + 'p';
  // Randomized internal symbol names (no stable _E / _ch / D0 breadcrumbs)
  function _rsym(n) {
    var s = '_', i;
    for (i = 0; i < n; i++) s += _alpha.charAt(rnd(26));
    return s;
  }
  var ENVFN = _rsym(4 + rnd(3));   // was _E
  var CHVAR = _rsym(3 + rnd(2));   // was _ch
  var BXFN  = _rsym(3 + rnd(2));   // was PREFIXbx
  var KEYFN = _rsym(3 + rnd(2));   // was PREFIXkey
  var GREF  = _rsym(3 + rnd(2));   // cached getgenv table
  STRIDX = 0; POOL = [];
  POS = 0;
  parseBlock([]);
  if (POS !== T.length) fail('trailing top-level tokens');

  // Render
  var bodyToks = OUT.slice();
  if (doCff) bodyToks = applyCFF(bodyToks, PREFIX, seed);
  var body = render(bodyToks);

  // Build pool prelude
  var poolInfo = buildPoolCode(POOL, doDelayStr);

  // ---- head ----
  var head = '';
  if (doAnti) {
    head += buildAntiTamper();
  } else {
    head += 'local ' + PREFIX + 'K=' + SALT + ';';
  }
  if (doHideEnv) {
    // Randomized resolver name; getgenv first (Delta hooks live there)
    head += 'local function ' + ENVFN + '(n)\n'
      + 'local g=getgenv and getgenv()\n'
      + 'if type(g)=="table" and type(g[n])=="function" then return g[n] end\n'
      + 'g=getrenv and getrenv()\n'
      + 'if type(g)=="table" and type(g[n])=="function" then return g[n] end\n'
      + 'if type(_G)=="table" and type(_G[n])=="function" then return _G[n] end\n'
      + 'return nil\nend\n';
  }
  head += poolInfo.code;

  // ---- bound stub (unchanged semantics) ----
  if (bound) {
    head += 'local ' + PREFIX + 'S=nil;'
      + 'if getgenv==nil then return end;'
      + 'pcall(function()local c=string.char;local g=game;'
      + 'local P=g[c(80,108,97,99,101,73,100)];'
      + 'if(P%251)~=' + RP + ' then return end;'
      + 'local Ps=g:GetService(c(80,108,97,121,101,114,115));'
      + 'local LP=Ps[c(76,111,99,97,108,80,108,97,121,101,114)];'
      + 'local U=LP[c(85,115,101,114,73,100)];'
      + 'if type(U)~=c(110,117,109,98,101,114) then return end;'
      + 'if(' + RU + '>=0 and(U%251)~=' + RU + ')then return end;'
      + 'local ok=false;for i=1,25 do '
      + 'local ch=LP[c(67,104,97,114,97,99,116,101,114)];'
      + 'local rt=ch and ch:FindFirstChild(c(72,117,109,97,110,111,105,100,82,111,111,116,80,97,114,116));'
      + 'if rt then ok=true;break end;'
      + 'task.wait(1) end;'
      + 'if not ok then return end;'
      + PREFIX + 'S=1 end);'
      + 'if ' + PREFIX + 'S==nil then return end;';
  }

  // ---- junk (looks like real logic; never feeds live path) ----
  var junk = '';
  var junkCount = doJunk ? Math.floor((6 + rnd(8)) * (0.5 + density)) : 0;
  function jsym() {
    var s = '_', ji;
    for (ji = 0; ji < 3 + rnd(2); ji++) s += _alpha.charAt(rnd(26));
    return s;
  }
  for (var jnI = 0; jnI < junkCount; jnI++) {
    var kind = rnd(6);
    var a = jsym(), b = jsym(), c = jsym();
    if (kind === 0) {
      junk += 'do\nlocal ' + a + '={}\nlocal ' + b + '=0\nfor ' + c + '=1,' + (3 + rnd(5)) + ' do\n'
        + a + '[' + c + ']=' + c + '*' + (1 + rnd(7)) + '\n' + b + '=' + b + '+' + a + '[' + c + ']\nend\nend\n';
    } else if (kind === 1) {
      junk += 'do\nlocal ' + a + '=0\nlocal ' + b + '="' + _alpha.charAt(rnd(26)) + _alpha.charAt(rnd(26)) + '"\n'
        + 'if #' + b + '>0 then ' + a + '=#' + b + ' end\n' + a + '=' + a + '-#' + b + '\nend\n';
    } else if (kind === 2) {
      junk += 'do\nlocal ' + a + '=(function(' + b + ') return ' + b + ' end)(' + (1 + rnd(9)) + ')\n'
        + 'local ' + c + '=' + a + '+' + (rnd(4)) + '-' + a + '\nend\n';
    } else if (kind === 3) {
      junk += 'do\nlocal ' + a + '={n=' + (10 + rnd(40)) + '}\n'
        + 'if ' + a + '.n>0 and ' + a + '.n<' + (100 + rnd(50)) + ' then\n'
        + 'local ' + b + '=' + a + '.n*0\nend\nend\n';
    } else if (kind === 4) {
      junk += 'do\nlocal ' + a + '=1\nwhile ' + a + '<1 do ' + a + '=' + a + '+1 end\nend\n';
    } else {
      junk += 'do\nlocal ' + a + '=select(1,' + (rnd(5)) + ')\n'
        + 'local ' + b + '=type(' + a + ')=="number" and 0 or 0\nend\n';
    }
  }

  // ---- decoys ----
  var decoyOut = '';
  var ndecoy = Math.floor(+opts.decoys || 0);
  if (ndecoy > 50) ndecoy = 50;
  if (ndecoy > 0) {
    var B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    var HEXC = '0123456789abcdef';
    var DIGC = '0123456789';
    function rstr(set, len) { var s = '', i; for (i = 0; i < len; i++) s += set.charAt(rnd(set.length)); return s; }
    for (var di2 = 0; di2 < ndecoy; di2++) {
      var fake = 'https://discord.com/api/webhooks/' + rstr(DIGC, 19) + '/' + rstr(B64C, 68);
      var ck = cryptBytes(utf8bytes(fake));
      POOL.push(ck);
    }
    poolInfo = buildPoolCode(POOL, doDelayStr);
    head = '';
    if (doAnti) head += buildAntiTamper(); else head += 'local ' + PREFIX + 'K=' + SALT + ';';
    if (doHideEnv) head += 'local function ' + ENVFN + '(n)\n'
      + 'local g=getgenv and getgenv()\n'
      + 'if type(g)=="table" and type(g[n])=="function" then return g[n] end\n'
      + 'g=getrenv and getrenv()\n'
      + 'if type(g)=="table" and type(g[n])=="function" then return g[n] end\n'
      + 'if type(_G)=="table" and type(_G[n])=="function" then return _G[n] end\n'
      + 'return nil\nend\n';
    head += poolInfo.code;
    // decoy bodies use pool indices after the original count
    var origPoolLen = POOL.length - ndecoy;
    for (var ddI = 0; ddI < ndecoy; ddI++) {
      decoyOut += 'local _x' + ddI + '=' + poolInfo.access(origPoolLen + ddI) + (doDelayStr ? '()()' : '()') + ';';
    }
  }

  stats.decoys = ndecoy;
  stats.junk = junkCount;
  stats.opaque = stats.opaque || 0;
  stats.profile = profile;
  stats.density = density;
  stats.vm = doVm;
  stats.bound = !bound ? 'off' : (bindUser > 0 ? 'place+user' : 'place');
  stats.pool = {real: POOL.length, fake: 0};
  stats.cff = doCff;

  // Insert newlines between major sections so long pastes aren't one giant line
  // (some executors silently truncate or fail on very long single lines)
  var code = head + (junk ? '\n' + junk : '') + (decoyOut ? '\n' + decoyOut : '') + '\n' + body;
  if (POOL.length > 0) {
    code = code.replace(new RegExp(POOLPFX + '(\\d+)', 'g'), function (m, n) {
      var call = poolInfo.access(parseInt(n, 10));
      // delayStrings wraps the decrypted value in an extra function, so call twice
      return doDelayStr ? (call + '()()') : (call + '()');
    });
  }
  // Break up long semicolon-joined runs for executor paste limits
  code = code.replace(/;(local )/g, ';\n$1');
  code = code.replace(/;(do )/g, ';\n$1');

  // ---- VM shell (opt-in) ----
  if (doVm) {
    var vm = buildVmShell(code, PREFIX, stats);
    if (vm && vm.code) {
      code = (doAnti ? buildAntiTamper() : 'local ' + PREFIX + 'K=' + SALT + ';') + vm.code;
      stats.vm_bytes = vm.instrCount;
      stats.vm_ops = vm.opcodeCount;
    } else {
      stats.vm_fallback = vm && vm.reason ? vm.reason : 'unsupported';
    }
  }

  return { code: code + '\n', stats: stats };
}

return obfuscate;
}));
