/* Luau/Lua source obfuscator engine (v5-upgraded)
 *
 * Single-target source transformer for Luau / Lua.
 * ES3-compatible (browser, Node, cscript).
 *
 * Transforms (upgraded with techniques from luau-obfuscator-v5):
 *   - Scope-correct local renaming (random short prefix + base36)
 *   - Per-literal string encryption (3-mix: additive + rolling XOR +
 *     position-dependent stream; v5-inspired multi-pass)
 *   - Shuffled constant pool with fake entries
 *   - Integer mangling (hex / split-add / xor / mul-mod)
 *   - Dead locals + optional decoy secrets + denser junk ops
 *   - Multi-layer anti-tamper stub (default on, v5-strengthened):
 *       builtin identity, rawequal on criticals, getfenv shape,
 *       _G metatable, injector-global soft probe, timing canary,
 *       arithmetic/string identity, coroutine integrity, sum gate,
 *       critical-ref lock, poison-key derivation on failed sum
 *
 * Optional Roblox binding (place/user residues, character wait, datatype
 * gauntlet, vault bootstrap) when opts.place / opts.user / opts.bootstrap set.
 *
 * API: obfuscate(source, seed, opts) -> { code, stats }
 *   opts: {
 *     rename, strings, numbers, antitamper, junk  (all default true)
 *     decoys: number,
 *     place, user: number (0 = unbound),
 *     require: dotted game path,
 *     bootstrap, vault, script: vault client options
 *   }
 *
 * Semantics-preserving for the supported subset. Throws on unsupported
 * constructs instead of emitting broken code.
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
  var doRename = opts.rename !== false;
  var doStrings = opts.strings !== false;
  var doNumbers = opts.numbers !== false;
  var doAnti = opts.antitamper !== false;
  var doJunk = opts.junk !== false;
  if (opts.antiDebug === false) doAnti = false;
  if (opts.antiDebug === true) doAnti = true;
  var bindPlace = Math.floor(+opts.place || 0);
  var bindUser = Math.floor(+opts.user || 0);
  if (!(bindPlace > 0)) bindPlace = 0;
  if (!(bindUser > 0)) bindUser = 0;
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
  /* Hierarchical keys: with a script id, bake FNV(master | id) instead of
     the raw master, so each script id gets a distinct secret from the one
     env var (verified against the server copy with exact 64-bit math). */
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
    function h8(v) {
      var s = v.toString(16);
      while (s.length < 8) s = '0' + s;
      return s;
    }
    return h8(hi) + h8(lo);
  }
  var BKEY = BOOT;
  if (BOOT !== '' && SCRIPTID !== '') BKEY = fnv64hexBytes(utf8bytes(BOOT + '|' + SCRIPTID));
  var STRIDX = 0, POOL = [], POOLPFX = '';

  var rngState = (seed >>> 0) || 1;
  function rnd(n) {
    rngState = (rngState * 1664525 + 1013904223) % 4294967296;
    var r = rngState / 4294967296;
    if (n === undefined) return r;
    return Math.floor(r * n);
  }
  function contains(arr, v) {
    var i;
    for (i = 0; i < arr.length; i++) { if (arr[i] === v) return true; }
    return false;
  }

  var KEYWORDS = {'and':1,'break':1,'do':1,'else':1,'elseif':1,'end':1,
    'false':1,'for':1,'function':1,'goto':1,'if':1,'in':1,'local':1,'nil':1,
    'not':1,'or':1,'repeat':1,'return':1,'then':1,'true':1,'until':1,
    'while':1,'continue':1};
  var BINOP = {'+':1,'-':1,'*':1,'/':1,'%':1,'^':1,'..':1,'<':1,'>':1,'<=':1,
    '>=':1,'==':1,'~=':1,'and':1,'or':1,',':1,'(':1,'not':1,'#':1};
  var COMPLETE_K = {'ID':1,'NUM':1,'STR':1,'LSTR':1};
  var COMPLETE_V = {'true':1,'false':1,'nil':1,'...':1,')':1,']':1,'}':1,'break':1};
  var BLOCK_KW = {'local':1,'function':1,'if':1,'while':1,'for':1,'repeat':1,
    'do':1,'end':1,'else':1,'elseif':1,'until':1,'return':1,'break':1,'then':1,'in':1};
  var NEVER = {'self':1,'_G':1,'_VERSION':1};

  function isAlpha(c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
  }
  function isDigit(c) { return c >= '0' && c <= '9'; }
  function isAlnum(c) { return isAlpha(c) || isDigit(c); }

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
      /* NB: no '\v' literal — JScript/ES3 reads it as the letter 'v'.
         charCodeAt(11) is the real vertical tab. */
      var cc0 = s.charCodeAt(i);
      if (cc0 === 32 || cc0 === 9 || cc0 === 13 || cc0 === 10 || cc0 === 11 || cc0 === 12) { i++; continue; }
      if (c === '-' && s.charAt(i + 1) === '-') {
        if (s.charAt(i + 2) === '[') {
          var mo = longOpen(i + 2);
          if (mo) {
            j = s.indexOf(']' + mo.eq + ']', mo.end);
            if (j < 0) throw new Error('lex: unterminated long comment');
            i = j + mo.eq.length + 2;
            continue;
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
          if (d === '\\') {
            if (j + 1 >= n) throw new Error('lex: bad string');
            raw += d + s.charAt(j + 1);
            j += 2;
            continue;
          }
          if (d === q) break;
          if (d === '\n') throw new Error('lex: newline in string');
          raw += d;
          j++;
        }
        toks.push(['STR', s.substring(i, j + 1), q, raw]);
        i = j + 1;
        continue;
      }
      if (isDigit(c) || (c === '.' && isDigit(s.charAt(i + 1)))) {
        var rest = s.substring(i);
        m = rest.match(/^0[xX][0-9a-fA-F_]+/);
        if (m) { toks.push(['NUM', m[0]]); i += m[0].length; continue; }
        m = rest.match(/^[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?/);
        if (m && !(c === '.' && m[0].charAt(0) !== '.')) {
          toks.push(['NUM', m[0]]); i += m[0].length; continue;
        }
        if (c !== '.') throw new Error('lex: bad number');
      }
      if (isAlpha(c)) {
        j = i;
        while (j < n && isAlnum(s.charAt(j))) j++;
        w = s.substring(i, j);
        toks.push([KEYWORDS[w] ? 'KW' : 'ID', w]);
        i = j;
        continue;
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
        i++;
        continue;
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

  var T = null, POS = 0, OUT = [], SCOPES = null, BRACE = 0,
      COUNTER = 0, PREV = '', PREFIX = '', DEC = '';
  var stats = null;
  var BASE = 0, BASEST = [];

  function emit(s) { OUT.push(s); PREV = s; }
  function peek() {
    if (POS < T.length) return T[POS];
    return [null, null];
  }
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
    emit(tk[1]);
    track(tk[1]);
  }
  function track(t) {
    if (t === '{') BRACE++;
    else if (t === '}') BRACE--;
  }
  function push() { SCOPES.push({}); }
  function pop() { SCOPES.pop(); }
  function declare(name) {
    if (NEVER[name]) return name;
    /* short random-looking locals: prefix + base36 counter (not sequential decimal) */
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
  function cryptBytes(data) {
    /* v5-inspired 3-mix encryption:
     *   pass1: additive (k + SALT + idx*7 + pos*3)
     *   pass2: rolling XOR keystream
     *   pass3: secondary stream mix (k2 derived from seed+q)
     * Decoder still only needs (h, k, q) — k2 is reconstructed from k/q. */
    var k = 1 + rnd(255), hx = '', i, b, q = STRIDX, roll, roll2, k2;
    STRIDX++;
    k2 = ((k * 37 + q * 91 + SALT * 13) & 255) || 1;
    roll = (k * 131 + SALT * 17 + q * 29) & 255;
    roll2 = (k2 * 53 + q * 17) & 255;
    for (i = 0; i < data.length; i++) {
      roll = (roll * 73 + i * 11 + k) & 255;
      roll2 = (roll2 * 47 + i * 19 + k2) & 255;
      b = (data[i] + k + SALT + (q * 7) + (i * 3)) & 255;
      b = b ^ roll;
      b = (b + roll2) & 255;
      hx += (b < 16 ? '0' : '') + b.toString(16);
    }
    return [hx, k, q];
  }
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
    else emit('(' + ph + ')');
    stats.str_enc++;
  }
  function emitNum(text) {
    if (doNumbers && /^[0-9]+$/.test(text)) {
      var v = parseInt(text, 10);
      if (v < 2147483648 && v >= 0) {
        var mode = rnd(5);
        if (mode === 0) emit('0x' + v.toString(16));
        else if (mode === 1) {
          var a = rnd(v + 1);
          emit('(' + a + '+' + (v - a) + ')');
        } else if (mode === 2 && v > 1) {
          var x = 1 + rnd(v);
          emit('(bit32 and bit32.bxor(' + (v ^ x) + ',' + x + ')or(' + v + '))');
        } else if (mode === 3 && v > 3) {
          var m = 2 + rnd(7);
          emit('(' + (v * m) + '%' + (v * m + 1) + '==' + v + ' and ' + v + ' or ' + v + ')');
        } else {
          var a2 = rnd(v + 1);
          emit('(' + a2 + '+' + (v - a2) + ')');
        }
        stats.num_mangled++;
        return;
      }
    }
    emit(text);
  }
  function emitId(name) {
    if (PREV !== '.' && PREV !== ':') {
      var la = look(0);
      if (!(la[1] === '=' && BRACE > 0)) {
        var nn = doRename ? resolve(name) : null;
        if (nn) { emit(nn); stats.renamed++; return; }
      }
    }
    emit(name);
  }

  function collectStmt() {
    /* Statement-end scanner with a real block stack: only `function`
       bodies can nest statements inside an expression, but if/for/while
       blocks inside them must still balance (notably `elseif X then`
       contributes NO extra level). Header-`do` of for/while does not
       push (it belongs to the header, closed by the body's `end`). */
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
      if (k === 'KW' && (t === 'if' || t === 'while' || t === 'for' || t === 'repeat')) {
        parseStmt(); continue;
      }
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
      parseBody();
      return;
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
      var lbs = POS, lbuf = collectStmt();
      fresh = [];
      for (i = 0; i < names.length; i++) fresh.push(declare(names[i]));
      emit('local');
      for (i = 0; i < fresh.length; i++) { if (i) emit(','); emit(fresh[i]); }
      emit('=');
      runBuf(lbuf, BASE + lbs);
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
    parseUntilKw('then');
    expect('then');
    var tk;
    for (;;) {
      push(); parseBlock(['elseif', 'else', 'end']); pop();
      tk = peek();
      if (tk[0] === 'KW' && tk[1] === 'elseif') {
        nxt(); emit('elseif');
        parseUntilKw('then');
        expect('then');
        continue;
      }
      if (tk[0] === 'KW' && tk[1] === 'else') { nxt(); emit('else'); continue; }
      expect('end');
      return;
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

  function render(pieces) {
    var out = [], prev = '', i, cur, pl, cf;
    for (i = 0; i < pieces.length; i++) {
      cur = pieces[i];
      if (out.length) {
        pl = prev.charAt(prev.length - 1);
        cf = cur.charAt(0);
        if (cur === ',' || cur === ';' || cur === ')' || cur === ']' || cur === '}' ||
            prev === '(' || prev === '[' || prev === '{') { /* tight */ }
        else if (cur === '.' || cur === ':' || prev === '.' || prev === ':') { /* tight */ }
        else if (cur === '(' || prev === ')') { /* tight */ }
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

  T = tokenize(src);
  SCOPES = [{}]; OUT = []; BRACE = 0; COUNTER = 0; PREV = '';
  stats = {decls:0, renamed:0, str_enc:0, str_plain:0, num_mangled:0};
  var idents = {}, idre = /[A-Za-z_][A-Za-z0-9_]*/g, mm;
  while ((mm = idre.exec(src)) !== null) idents[mm[0]] = 1;
  /* Random short prefix (no fixed brand); avoid colliding with source idents */
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
    for (kk in idents) {
      if (kk.substring(0, PREFIX.length) === PREFIX) { hasPre = true; break; }
    }
    if (hasPre) PREFIX = _randPref(3 + (guard >> 3));
    guard++;
  }
  DEC = PREFIX + 'd';
  var di = 0;
  while (Object.prototype.hasOwnProperty.call(idents, DEC)) { di++; DEC = PREFIX + 'd' + di; }
  POOLPFX = PREFIX + 'p';
  STRIDX = 0; POOL = [];
  POS = 0;
  parseBlock([]);
  if (POS !== T.length) fail('trailing top-level tokens');
  var body = render(OUT);
  var SNAME = PREFIX + 'S';
  var CNM = PREFIX + 'C';
  function ccode(s) {
    var o = [], i;
    for (i = 0; i < s.length; i++) o.push(s.charCodeAt(i));
    return o.join(',');
  }
  /* Optional module gate: dotted game path (e.g.
     ReplicatedStorage.Modules.ProfileData) waited on like the character.
     Components are char-coded so the stub names nothing. */
  var modwait = '';
  if (REQPATH !== '') {
    var comps = REQPATH.split('.'), ci;
    modwait = 'local rq=g;';
    for (ci = 0; ci < comps.length; ci++) {
      modwait += 'rq=rq and rq[c(' + ccode(comps[ci]) + ')];';
    }
  }

  /* ---------- multi-layer anti-tamper (pure Luau + optional Roblox) — v5-strengthened ---------- */
  function buildAntiTamper() {
    var P = PREFIX;
    var ig = P + 'ig';
    var sm = P + 'sm';
    var rg = P + 'rg';
    var pc = P + 'pc';
    var ty = P + 'ty';
    var ts = P + 'ts';
    var re = P + 're';
    var gm = P + 'gm';
    var cl = P + 'cl';
    var hx = P + 'hx';
    var der = P + 'der';
    var lines = [];
    // capture originals
    lines.push('local '+rg+','+pc+','+ty+','+ts+','+re+','+gm+'=rawget,pcall,type,tostring,rawequal,getmetatable');
    lines.push('local '+cl+'=(os and os.clock)or(tick)or function()return 0 end');
    lines.push('local '+sm+'=0');
    lines.push('local function '+ig+'()error("",0)end');
    // 1) builtins identity
    lines.push('do local t={print,pcall,type,pairs,setmetatable,rawget,tostring};local i;for i=1,#t do if '+ty+'(t[i])~="function"then '+ig+'()end;local ok,r='+pc+'('+ts+',t[i]);if ok and r and not(r:find("function")or r:find("builtin")or r:find("0x"))then '+ig+'()end;'+sm+'='+sm+'+7 end end');
    // 2) rawequal on _G criticals
    lines.push('if _G and '+ty+'(_G)=="table"then if _G.pcall and not '+re+'(_G.pcall,pcall)then '+ig+'()end;if _G.type and not '+re+'(_G.type,type)then '+ig+'()end;if _G.error and not '+re+'(_G.error,error)then '+ig+'()end;'+sm+'='+sm+'+19 end');
    // 3) getfenv shape (soft)
    lines.push('if getfenv then local ok,e='+pc+'(getfenv,0);if ok and e and '+ty+'(e)=="table"then local m='+gm+'(e);if m and m.__index and m.__index~=_G then '+ig+'()end end;'+sm+'='+sm+'+41 else '+sm+'='+sm+'+41 end');
    // 4) _G metatable
    lines.push('do local m='+gm+'(_G);if m and m.__newindex then '+sm+'='+sm+'+11 else '+sm+'='+sm+'+19 end end');
    // 5) suspicious injector globals (soft penalty)
    lines.push('do local b={"hookfunction","hookmetamethod","getgenv","getrenv","getsenv","getgc","getreg"};local i,s=1,19;for i=1,#b do if '+ty+'('+rg+'(_G,b[i]))=="function"then s=s-3 end end;'+sm+'='+sm+'+math.max(0,s)end');
    // 6) timing canary (slightly tighter loop like v5)
    lines.push('do local t0='+cl+'();local x=0;local i;for i=1,350 do x=x+i end;if '+cl+'()-t0>0.4 then '+ig+'()end;'+sm+'='+sm+'+29 end');
    // 7) arithmetic / string identity
    lines.push('do local s=0;if(1+2)*3==9 and(10%3)==1 then s=s+17 end;if math and math.floor(3.9)==3 then s=s+13 end;if string and string.byte("A")==65 then s=s+11 end;'+sm+'='+sm+'+s end');
    // 8) coroutine integrity
    lines.push('do local ok=true;if '+ty+'(coroutine)=="table"then local c=coroutine.create(function()coroutine.yield(1)return 2 end);local o1,v1=coroutine.resume(c);if not o1 or v1~=1 then ok=false end;local o2,v2=coroutine.resume(c);if not o2 or v2~=2 then ok=false end;if coroutine.status(c)~="dead"then ok=false end else ok=false end;if not ok then '+ig+'()end;'+sm+'='+sm+'+23 end');
    // 9) lock critical refs (v5-style soft recheck helper)
    lines.push('local _p,_c,_t,_pa,_sm=print,pcall,type,pairs,setmetatable');
    lines.push('local function '+hx+'()if print~=_p or pcall~=_c or type~=_t or pairs~=_pa or setmetatable~=_sm then '+ig+'()end end');
    lines.push(hx+'()');
    // 10) sum gate + poison-key derivation helper (v5 style)
    lines.push('local function '+der+'(s,n)local o={}for i=1,#s do o[i]=string.char((s:byte(i)+(n%97)+i*3)%256)end;return table.concat(o)end');
    lines.push('if not('+sm+'>=175 and '+sm+'<=235)then '+ig+'()end');
    return lines.join(';') + ';';
  }
  var ANTI = doAnti ? buildAntiTamper() : "";

  var head;
  if (!bound) {
    head = ANTI + 'local ' + DEC + '=function(h,k,q)local r={}local k2=((k*37+q*91)%256);if k2==0 then k2=1 end;' +
      'local roll=(k*131+q*29)%256;local roll2=(k2*53+q*17)%256;' +
      'for i=1,#h,2 do local p=(i+1)/2;roll=(roll*73+(p-1)*11+k)%256;roll2=(roll2*47+(p-1)*19+k2)%256;' +
      'local b=tonumber(h:sub(i,i+1),16);b=(b-roll2)%256;b=bit32 and bit32.bxor(b,roll)or(b~roll);' +
      'b=(b-k-(q*7)-((p-1)*3))%256;r[#r+1]=string.char(b)end return table.concat(r)end;';
  } else {
    /* Bound stub (public-safe: no per-user lock needed): recompute the salt
       from the LIVE game and halt silently on anything else. Layers:
       executor present -> place residue -> live player shape -> live
       character + HumanoidRootPart (waited, sandboxes never grow one) ->
       datatype fidelity gauntlet (only the real engine computes these
       exactly) -> arithmetic/time sanity. No fallback path exists.
       Camouflage: every revealing field name is built with string.char, so
       the stub reads as number soup; only ubiquitous globals stay open. */
    head = ANTI + 'local ' + SNAME + '=nil;'
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
      + modwait
      + (modwait !== '' ? 'if rt and rq then ok=true;break end;' : 'if rt then ok=true;break end;')
      + 'task.wait(1) end;'
      + 'if not ok then return end;'
      + 'local V=Vector3.new(3,4,0);'
      + 'if math.abs(V[c(77,97,103,110,105,116,117,100,101)]-5)>0.0001 then return end;'
      + 'local CP=(CFrame.new()*CFrame.new(1,2,3))[c(80,111,115,105,116,105,111,110)];'
      + 'if math.abs(CP[c(88)]-1)>0.0001 or math.abs(CP[c(89)]-2)>0.0001 or math.abs(CP[c(90)]-3)>0.0001 then return end;'
      + 'local UD=UDim2.new(0,5,0,7);'
      + 'if UD[c(88)][c(79,102,102,115,101,116)]~=5 or UD[c(89)][c(79,102,102,115,101,116)]~=7 then return end;'
      + 'if typeof(Color3.new(1,0,0))~=c(67,111,108,111,114,51) then return end;'
      + 'if Enum[c(69,97,115,105,110,103,83,116,121,108,101)][c(81,117,97,100)]==nil then return end;'
      + 'local acc=0;for j=1,5000 do acc=acc+j end;'
      + 'if acc~=12502500 then return end;'
      + 'local t1=os.clock();local t2=os.clock();'
      + 'if t2<t1 then return end;'
      + SNAME + '=(P%251+(' + RU + '>=0 and(U*13)%251 or 0))%256 end);'
      + 'if ' + SNAME + '==nil then return end;'
      + 'local ' + DEC + '=function(h,k,q)local r={}local k2=((k*37+q*91+' + SNAME + '*13)%256);if k2==0 then k2=1 end;'
      + 'local roll=(k*131+' + SNAME + '*17+q*29)%256;local roll2=(k2*53+q*17)%256;'
      + 'for i=1,#h,2 do local p=(i+1)/2;roll=(roll*73+(p-1)*11+k)%256;roll2=(roll2*47+(p-1)*19+k2)%256;'
      + 'local b=tonumber(h:sub(i,i+1),16);b=(b-roll2)%256;b=bit32 and bit32.bxor(b,roll)or(b~roll);'
      + 'b=(b-k-' + SNAME + '-(q*7)-((p-1)*3))%256;r[#r+1]=string.char(b)end return table.concat(r)end;';
  }
  /* denser junk (v5-style) — dead locals + opaque arithmetic; controlled by opts.junk */
  var junk = '', j, jn;
  var junkCount = doJunk ? (12 + rnd(10)) : 0;
  for (j = 0; j < junkCount; j++) {
    jn = PREFIX + 'j' + j.toString(36);
    var kind = rnd(5);
    if (kind === 0) junk += 'local ' + jn + '=(' + rnd(10000) + '+' + rnd(10000) + ');';
    else if (kind === 1) junk += 'local ' + jn + '=(' + rnd(50) + '*' + rnd(50) + '-' + rnd(200) + ');';
    else if (kind === 2) junk += 'local ' + jn + '=(function(a,b)return a~=b and a or b end)(' + rnd(999) + ',' + rnd(999) + ');';
    else if (kind === 3) junk += 'local ' + jn + '=bit32 and bit32.bxor(' + rnd(255) + ',' + rnd(255) + ')or(' + rnd(255) + ');';
    else junk += 'local ' + jn + '=(' + rnd(20) + '<' + (20 + rnd(30)) + ' and ' + rnd(500) + ' or ' + rnd(500) + ');';
  }
  /* Decoy secrets: correctly encrypted, decrypted at startup, never used.
     A dynamic dump records them alongside the real strings (noise); the
     "URLs touched" set is unaffected since they are never requested. */
  var B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var HEXC = '0123456789abcdef';
  var DIGC = '0123456789';
  function rstr(set, len) {
    var s = '', i;
    for (i = 0; i < len; i++) s += set.charAt(rnd(set.length));
    return s;
  }
  function fakeSecret(m) {
    if (m === 0) return 'https://discord.com/api/webhooks/' + rstr(DIGC, 19) + '/' + rstr(B64C, 68);
    if (m === 1) return 'https://gist.githubusercontent.com/Cerberuxz/' + rstr(HEXC, 32) + '/raw/Loader';
    if (m === 2) return 'https://api.project-reverse.org/run/' + rstr(B64C, 64);
    return 'https://cdn.payload-hub.com/v2/blob/' + rstr(HEXC, 40) + '?token=' + rstr(B64C, 32);
  }
  var decoyOut = '', ndecoy = Math.floor(+opts.decoys || 0);
  if (ndecoy > 50) ndecoy = 50;
  if (ndecoy > 0) {
    var di;
    for (di = 0; di < ndecoy; di++) {
      var ck = cryptBytes(utf8bytes(fakeSecret(di % 4)));
      decoyOut += 'local ' + PREFIX + 'X' + di + '=(' + DEC + '("' + ck[0] + '",' + ck[1] + ',' + ck[2] + '));';
    }
  }
  /* Constant pool: literals live in one shuffled closure pool with fake
     entries; use sites are bare indices. Nothing inline says "decrypt". */
  var poolCode = '', slotOf = {}, pi, pj, tmp;
  /* Vault literals (bootstrap halves + base + client strings) join the same
     pool when a bootstrap is set; resolved to slots below like the rest. */
  var VSLOT = null;
  if (BOOT !== '') {
    var VLITS = [BKEY.substring(0, BKEY.length >> 1), BKEY.substring(BKEY.length >> 1), VBASE,
      '/vault/nonce', '/vault/issue', '/vault/fetch',
      'Content-Type', 'application/json', 'POST',
      'HttpService', 'Players', 'LocalPlayer', 'Name', 'UserId', 'JobId',
      'username', 'userId', 'jobId', 'nonce', 'proof', 'token', 'expiresIn',
      'ok', 'content', 'key', 'value', 'unknown', SCRIPTID, 'scriptId'];
    VSLOT = [];
    for (var vi = 0; vi < VLITS.length; vi++) {
      VSLOT.push(POOL.length);
      POOL.push(cryptBytes(utf8bytes(VLITS[vi])));
    }
  }
  var nreal = POOL.length;
  if (nreal > 0) {
    var order = [];
    for (pi = 0; pi < nreal; pi++) order.push({e: POOL[pi], real: true, at: pi});
    var nfake = nreal < 32 ? 8 : Math.min(64, Math.floor(nreal / 4));
    var fchars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 :/.-_';
    for (pi = 0; pi < nfake; pi++) {
      var flen = 8 + rnd(17), fs = '';
      for (pj = 0; pj < flen; pj++) fs += fchars.charAt(rnd(fchars.length));
      order.push({e: cryptBytes(utf8bytes(fs)), real: false, at: -1});
    }
    for (pi = order.length - 1; pi > 0; pi--) {
      pj = rnd(pi + 1);
      tmp = order[pi]; order[pi] = order[pj]; order[pj] = tmp;
    }
    var parts = [];
    for (pi = 0; pi < order.length; pi++) {
      var oe = order[pi].e;
      parts.push('function() return ' + DEC + '("' + oe[0] + '",' + oe[1] + ',' + oe[2] + ') end');
      if (order[pi].real) slotOf[order[pi].at] = pi + 1;
    }
    poolCode = 'local ' + CNM + '={' + parts.join(',') + '};';
    stats.pool = {real: nreal, fake: order.length - nreal};
  } else {
    stats.pool = {real: 0, fake: 0};
  }
  /* Vault client (bootstrap only): FNV-1a/64 proof via bit32, nonce ->
     issue -> fetch, token cached in _G. Only live sessions pass the gate
     above, so only they can use this. */
  var vaultCode = '';
  if (VSLOT) {
    var VN = PREFIX + 'V';
    var VS = function (k) { return CNM + '[' + slotOf[VSLOT[k]] + ']()'; };
    vaultCode =
      'local ' + VN + 'b=' + VS(0) + '..' + VS(1) + ';'
      + 'local ' + VN + 'sid=' + VS(27) + ';'
      + 'local ' + VN + 'z=string.char(0);'
      + 'local function ' + VN + 'f(s)'
      + 'local hi,lo=0xCBF29CE4,0x84222325;'
      + 'for i=1,#s do '
      + 'lo=bit32.bxor(lo,s:byte(i));'
      + 'local a0=lo%65536;local a1=math.floor(lo/65536)%65536;'
      + 'local a2=hi%65536;local a3=math.floor(hi/65536)%65536;'
      + 'local r0=a0*435;local r1=a1*435;'
      + 'local r2=a0*256+a2*435;local r3=a1*256+a3*435;'
      + 'local t0=r0;local o0=t0%65536;'
      + 'local t1=r1+math.floor(t0/65536);local o1=t1%65536;'
      + 'local t2=r2+math.floor(t1/65536);local o2=t2%65536;'
      + 'local t3=r3+math.floor(t2/65536);local o3=t3%65536;'
      + 'hi=o3*65536+o2;lo=o1*65536+o0 end;'
      + 'local dd="0123456789abcdef";local out="";'
      + 'local vh=hi;for k=7,0,-1 do local p=16^k;local nib=math.floor(vh/p)%16;out=out..dd:sub(nib+1,nib+1) end;'
      + 'local vl=lo;for k=7,0,-1 do local p=16^k;local nib=math.floor(vl/p)%16;out=out..dd:sub(nib+1,nib+1) end;'
      + 'return out end;'
      + '_G.VaultGet=function(key)'
      + 'local ok,val=pcall(function()'
      + 'local rq=(getgenv and(getgenv().request or getgenv().http_request))or request or http_request or(syn and syn.request);'
      + 'if not rq then return nil end;'
      + 'local hs=game:GetService(' + VS(9) + ');'
      + 'local me=game[' + VS(10) + '][' + VS(11) + '];'
      + 'local un=(me and me[' + VS(12) + '])or ' + VS(26) + ';'
      + 'local uid=(me and me[' + VS(13) + '])or 0;'
      + 'local jid=game[' + VS(14) + '] or "";'
      + 'local now=os.time();local rec=_G.VaultToken;local tok=nil;'
      + 'if type(rec)=="table" and type(rec.token)=="string" and rec.token~="" and type(rec.exp)=="number" and now<rec.exp then tok=rec.token;'
      + 'else '
      + 'local nrok,nr=pcall(function() return game:HttpGet(' + VS(2) + '..' + VS(3) + ') end);'
      + 'if not(nrok and type(nr)=="string")then return nil end;'
      + 'local okJ,nd=pcall(function() return hs:JSONDecode(nr) end);'
      + 'if not(okJ and type(nd)=="table" and nd[' + VS(22) + '] and type(nd[' + VS(18) + '])=="string")then return nil end;'
      + 'local nn=nd[' + VS(18) + '];'
      + 'local proof=' + VN + 'f(' + VN + 'b..' + VN + 'z..nn..' + VN + 'z..un..' + VN + 'z..tostring(uid)..' + VN + 'z..jid);'
      + 'local okI,ib=pcall(function() return hs:JSONEncode({[' + VS(15) + ']=un,[' + VS(16) + ']=uid,[' + VS(17) + ']=jid,[' + VS(18) + ']=nn,[' + VS(19) + ']=proof,[' + VS(28) + ']=' + VN + 'sid}) end);'
      + 'if not okI then return nil end;'
      + 'local ir=rq({Url=' + VS(2) + '..' + VS(4) + ',Method=' + VS(8) + ',Headers={[' + VS(6) + ']=' + VS(7) + '},Body=ib});'
      + 'local ibb=ir and(ir.Body or ir.body);'
      + 'if not(ir and(ir.Success or ir.StatusCode==200)and type(ibb)=="string")then return nil end;'
      + 'local okD,idd=pcall(function() return hs:JSONDecode(ibb) end);'
      + 'if not(okD and type(idd)=="table" and idd[' + VS(22) + '] and type(idd[' + VS(20) + '])=="string" and idd[' + VS(20) + ']~="")then return nil end;'
      + 'tok=idd[' + VS(20) + '];'
      + '_G.VaultToken={token=tok,exp=now+math.max((tonumber(idd[' + VS(21) + '])or 600)-30,60)};'
      + 'end;'
      + 'local okF,fb=pcall(function() return hs:JSONEncode({[' + VS(20) + ']=tok,[' + VS(16) + ']=uid,[' + VS(17) + ']=jid,[' + VS(24) + ']=key}) end);'
      + 'if not okF then return nil end;'
      + 'local fr=rq({Url=' + VS(2) + '..' + VS(5) + ',Method=' + VS(8) + ',Headers={[' + VS(6) + ']=' + VS(7) + '},Body=fb});'
      + 'local fbb=fr and(fr.Body or fr.body);'
      + 'if not(fr and(fr.Success or fr.StatusCode==200)and type(fbb)=="string")then '
      + 'if fr and fr.StatusCode==401 then _G.VaultToken=nil end;return nil end;'
      + 'local okV,vd=pcall(function() return hs:JSONDecode(fbb) end);'
      + 'if okV and type(vd)=="table" and vd[' + VS(22) + '] then return vd[' + VS(25) + '] end;'
      + 'return nil end);'
      + 'if ok then return val end;return nil end;';
  }
  stats.decoys = ndecoy;
  stats.junk = junkCount;
  stats.bound = !bound ? 'off' : (bindUser > 0 ? 'place+user' : 'place');
  stats.require = REQPATH;
  stats.script = SCRIPTID;
  stats.vault = (VSLOT !== null);
  var code = head + junk + decoyOut + poolCode + vaultCode + body;
  if (nreal > 0) {
    code = code.replace(new RegExp(POOLPFX + '(\\d+)', 'g'), function (m, n) {
      return CNM + '[' + slotOf[parseInt(n, 10)] + ']()';
    });
  }
  return {code: code + '\n', stats: stats};
}

return obfuscate;
}));
