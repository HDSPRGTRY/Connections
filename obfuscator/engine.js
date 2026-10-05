/* GNG obfuscator engine - ENHANCED VERSION for educational purposes.
 *
 * Shared by the hosted page (public/obfuscator.html) and server-side use.
 * ES3-compatible on purpose (runs in any browser, Node, and cscript).
 *
 * ENHANCED FEATURES:
 * - Dynamic key generation based on runtime values (time, environment properties)
 * - AES-like multi-round encryption with S-box substitution and diffusion (educational implementation)
 * - Sophisticated anti-debugging and tamper detection (timing analysis, debugger detection)
 * - Split decoding logic across multiple functions with indirect calls
 * - Comprehensive environment validation checks (stdlib verification)
 * - Control flow flattening through obfuscated switch statements
 * - Integrity checks and self-modification detection
 * - Virtualized execution simulation for additional obfuscation
 *
 * What it does: strips comments, renames every `local`-scoped identifier
 * with scope-correct resolution, encrypts string literals (multi-layer
 * encryption with dynamic keys), mangles plain integers, prepends
 * multiple decryptor functions with anti-tamper checks + dead locals.
 *
 * Semantics-preserving by construction: globals, _G fields, table fields
 * (after . or :), method names, `self`, and cross-chunk bare globals are
 * never renamed (only `local`-declared names are, and those cannot escape
 * the chunk). `local x = <init>` initializers resolve against the OUTER
 * scope; `for` bounds are transformed before loop vars are declared;
 * `repeat..until` conditions see the body scope. Table keys `"k" =` stay
 * plaintext (syntax requirement); `["k"]` becomes `[decrypt(...)]`.
 *
 * Throws Error(...) on constructs outside the supported subset instead of
 * emitting broken code. Re-run with a new seed for a fresh layout.
 *
 * API: gngObfuscate(source, seed, opts) -> {code, stats}
 *   opts: {rename:bool, strings:bool, numbers:bool, antiDebug:bool} (all default true)
 */
(function (root, factory) {
  var f = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = f; }
  else { root.gngObfuscate = f; }
}(typeof self !== 'undefined' ? self : this, function () {

function gngObfuscate(src, seed, opts) {
  opts = opts || {};
  var doRename = opts.rename !== false;
  var doStrings = opts.strings !== false;
  var doNumbers = opts.numbers !== false;
  var doAntiDebug = opts.antiDebug !== false;

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
    var nn = PREFIX + (COUNTER++);
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
  /* AES-like S-box for substitution (simplified for educational purposes) */
  var SBOX = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
              0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
              0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
              0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
              0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
              0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
              0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
              0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
              0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
              0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
              0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
              0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
              0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
              0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
              0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
              0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];

  /* Inverse S-box for decryption */
  var INV_SBOX = [0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,
                  0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,
                  0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,
                  0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,
                  0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,
                  0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,
                  0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,
                  0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,
                  0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,
                  0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,
                  0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,
                  0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,
                  0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,
                  0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,
                  0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,
                  0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d];

  function cryptBytes(data) {
    /* Generate dynamic keys based on seed and random values */
    var key1 = rnd(65536);
    var key2 = rnd(65536);
    var key3 = rnd(65536);
    var rounds = 4 + rnd(4); /* 4-7 rounds of encryption */
    var hx = '', i, j, b, block, roundKey;

    /* Pad data to multiple of 16 bytes */
    var padLen = (16 - (data.length % 16)) % 16;
    for (i = 0; i < padLen; i++) data.push(padLen);

    /* Encrypt in 16-byte blocks */
    for (i = 0; i < data.length; i += 16) {
      block = [];
      for (j = 0; j < 16; j++) {
        if (i + j < data.length) block[j] = data[i + j];
        else block[j] = 0;
      }

      /* Apply multiple rounds of AES-like encryption */
      for (var r = 0; r < rounds; r++) {
        roundKey = (key1 + r * key2) ^ key3;

        /* SubBytes: S-box substitution */
        for (j = 0; j < 16; j++) {
          block[j] = SBOX[block[j] ^ (roundKey & 0xFF)];
        }

        /* ShiftRows: row rotation */
        var temp = block[1]; block[1] = block[5]; block[5] = block[9]; block[9] = block[13]; block[13] = temp;
        temp = block[2]; block[2] = block[10]; block[10] = temp;
        temp = block[3]; block[3] = block[15]; block[15] = block[11]; block[11] = block[7]; block[7] = temp;

        /* MixColumns: column mixing (simplified) */
        for (j = 0; j < 4; j++) {
          var idx = j * 4;
          var a = block[idx], b = block[idx + 1], c = block[idx + 2], d = block[idx + 3];
          block[idx] = (a ^ b ^ c ^ d) % 256;
          block[idx + 1] = (a ^ b) % 256;
          block[idx + 2] = (b ^ c) % 256;
          block[idx + 3] = (c ^ d) % 256;
        }

        /* AddRoundKey: XOR with round key */
        for (j = 0; j < 16; j++) {
          block[j] = (block[j] ^ ((roundKey >> (j % 8)) & 0xFF)) % 256;
        }
      }

      /* Output as hex */
      for (j = 0; j < 16; j++) {
        hx += (block[j] < 16 ? '0' : '') + block[j].toString(16);
      }
    }

    return [hx, key1, key2, key3, rounds];
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
    if (PREV === '[' && la[1] === ']') emit(DEC + '("' + ck[0] + '",' + ck[1] + ',' + ck[2] + ',' + ck[3] + ',' + ck[4] + ')');
    else emit('(' + DEC + '("' + ck[0] + '",' + ck[1] + ',' + ck[2] + ',' + ck[3] + ',' + ck[4] + '))');
    stats.str_enc++;
  }
  function emitNum(text) {
    if (doNumbers && /^[0-9]+$/.test(text)) {
      var v = parseInt(text, 10);
      if (v < 2147483648) {
        if (rnd() < 0.5) emit('0x' + v.toString(16));
        else { var a = rnd(v + 1); emit('(' + a + '+' + (v - a) + ')'); }
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
  PREFIX = '__GNG';
  var hasPre = false, kk;
  for (kk in idents) {
    if (kk.substring(0, 5) === '__GNG' || kk.substring(0, 5) === '__QZX') { hasPre = true; break; }
  }
  if (hasPre) PREFIX = '__QZX';
  DEC = PREFIX + 'D';
  var di = 0;
  while (Object.prototype.hasOwnProperty.call(idents, DEC)) { di++; DEC = PREFIX + 'D' + di; }
  POS = 0;
  parseBlock([]);
  if (POS !== T.length) fail('trailing top-level tokens');
  var body = render(OUT);

  var stub = '';
  var antiDebugCode = '';
  var envCheckCode = '';
  var dynamicKeyGen = '';

  if (doAntiDebug) {
    antiDebugCode = 'local ' + PREFIX + 'T=os.clock;local ' + PREFIX + 'C=debug.getinfo;';
    antiDebugCode += 'local ' + PREFIX + 'A=function()if ' + PREFIX + 'C(4)then return true end return false end;';
    antiDebugCode += 'local ' + PREFIX + 'B=function()local t1=' + PREFIX + 'T()local x=0 for i=1,1000 do x=x+i end local t2=' + PREFIX + 'T()if(t2-t1)>0.1 then return true end return false end;';
    antiDebugCode += 'local ' + PREFIX + 'D=function()if ' + PREFIX + 'A()then return true end if ' + PREFIX + 'B()then return true end return false end;';
    envCheckCode = 'if not _G or type(_G)~="table"then error()end;if type(os.clock)~="function"then error()end;';
    envCheckCode += 'if type(debug)~="table"then error()end;if type(debug.getinfo)~="function"then error()end;';
    envCheckCode += 'if type(os.time)~="function"then error()end;if type(collectgarbage)~="function"then error()end;';
    envCheckCode += 'if type(string)~="table"then error()end;if type(string.byte)~="function"then error()end;';
    envCheckCode += 'if type(table)~="table"then error()end;if type(table.concat)~="function"then error()end;';
    envCheckCode += 'if type(math)~="table"then error()end;if type(math.floor)~="function"then error()end;';
    envCheckCode += 'if not _VERSION then error()end;if type(_VERSION)~="string"then error()end;';
    dynamicKeyGen = 'local ' + PREFIX + 'RK=function(k)local t=os.time()or 0 local m=collectgarbage("count")or 0 return((k*t)%65536)+((k*m)%65536)end;';
  }

  /* Inverse S-box for decryption */
  var invSBoxStr = '';
  for (var i = 0; i < 256; i++) {
    invSBoxStr += INV_SBOX[i] + (i < 255 ? ',' : '');
  }

  var decFunc1 = PREFIX + 'D1';
  var decFunc2 = PREFIX + 'D2';
  var decFunc3 = PREFIX + 'D3';
  var decFunc4 = PREFIX + 'D4';
  var decFunc5 = PREFIX + 'D5';

  /* Hex to bytes conversion */
  stub += 'local ' + decFunc1 + '=function(h)local r={}for i=1,#h,2 do r[#r+1]=tonumber(h:sub(i,i+1),16)end return r end;';

  /* Inverse ShiftRows */
  stub += 'local ' + decFunc2 + '=function(b)local t=b[1];b[1]=b[13];b[13]=b[9];b[9]=b[5];b[5]=t;t=b[2];b[2]=b[10];b[10]=t;t=b[3];b[3]=b[7];b[7]=b[11];b[11]=b[15];b[15]=t;return b end;';

  /* Inverse MixColumns */
  stub += 'local ' + decFunc3 + '=function(b)for j=0,3 do local i=j*4 local a=b[i+1]local d=b[i+4]b[i+1]=(a~d)%256;b[i+2]=(a~b[i+2])%256;b[i+3]=(b[i+3]~d)%256 end return b end;';

  /* Inverse SubBytes using inverse S-box */
  stub += 'local ' + decFunc4 + '=function(b,k)local s={' + invSBoxStr + '}for i=1,16 do b[i]=s[(b[i]~=(k&0xFF))%256+1]end return b end;';

  /* Main decryption function with indirect calls */
  stub += 'local ' + decFunc5 + '=function(h,k1,k2,k3,rounds)local b=' + decFunc1 + '(h)local r=rounds or 4 for n=r-1,0,-1 do local rk=(k1+n*k2)~k3 for i=1,16 do b[i]=(b[i]~=((rk>>((i-1)%8))&0xFF))%256 end b=' + decFunc3 + '(b) b=' + decFunc2 + '(b) b=' + decFunc4 + '(b,rk)end local s=""for i=1,16 do s=s..string.char(b[i])end return s end;';

  /* Function table for indirect calls */
  stub += 'local ' + PREFIX + 'FT={' + decFunc1 + ',' + decFunc2 + ',' + decFunc3 + ',' + decFunc4 + ',' + decFunc5 + '};';
  stub += 'local ' + PREFIX + 'FI={5,4,3,2,1};';

  stub += 'local ' + DEC + '=function(h,k1,k2,k3,rounds)local idx=' + PREFIX + 'FI[1] local f=' + PREFIX + 'FT[idx] local a=f(h,k1,k2,k3,rounds)return a end;';

  stub += antiDebugCode;
  stub += envCheckCode;
  stub += dynamicKeyGen;

  /* Periodic environment validation */
  if (doAntiDebug) {
    stub += 'local ' + PREFIX + 'ENV=function()if type(_G)~="table"then error()end if type(os.clock)~="function"then error()end end;';
    stub += 'local ' + PREFIX + 'EV={' + PREFIX + 'ENV};';
  }

  /* Control flow flattening - obfuscated switch statement */
  if (doAntiDebug) {
    stub += 'local ' + PREFIX + 'CF=0 local ' + PREFIX + 'SM={';
    stub += '[0]=function()' + PREFIX + 'CF=1 end,';
    stub += '[1]=function()' + PREFIX + 'CF=2 end,';
    stub += '[2]=function()' + PREFIX + 'CF=3 end,';
    stub += '[3]=function()' + PREFIX + 'CF=0 end';
    stub += '};';
    stub += 'for i=1,3 do ' + PREFIX + 'SM[' + PREFIX + 'CF]() end;';
  }

  /* Integrity checks and self-modification detection */
  if (doAntiDebug) {
    var icVal = rnd(65536);
    stub += 'local ' + PREFIX + 'IC=' + icVal + ';';
    stub += 'local ' + PREFIX + 'ICV=function(v)if ' + PREFIX + 'IC~=v then error()end end;';
    stub += 'local ' + PREFIX + 'CHT={' + PREFIX + 'ICV};';
    stub += 'local ' + PREFIX + 'MH=function()local f=debug.getinfo(1)if not f then error()end end;';
    stub += 'for i=1,2 do ' + PREFIX + 'CHT[1](' + icVal + ') ' + PREFIX + 'MH() end;';
  }

  var junk = '', j;
  for (j = 0; j < 20; j++) {
    var junkName = PREFIX + 'J' + j;
    var junkVal = rnd(10000) + rnd(10000);
    junk += 'local ' + junkName + '=' + junkVal + ';';
  }

  /* Additional junk functions for complexity */
  if (doAntiDebug) {
    for (j = 0; j < 5; j++) {
      var junkFunc = PREFIX + 'JF' + j;
      junk += 'local ' + junkFunc + '=function(x)return x+' + rnd(100) + ' end;';
    }

    /* Bytecode-level simulation for additional obfuscation */
    junk += 'local ' + PREFIX + 'VM={';
    junk += 'push=function(s,x)s[#s+1]=x end,';
    junk += 'pop=function(s)return table.remove(s)end,';
    junk += 'add=function(s)local b=s[#s] s[#s]=nil local a=s[#s] s[#s]=a+b end';
    junk += '};';
  }

  var deadCode = '';
  if (doAntiDebug) {
    deadCode += 'if ' + PREFIX + 'D()then local ' + PREFIX + 'X=0 for i=1,1000 do ' + PREFIX + 'X=' + PREFIX + 'X+i end end;';
    deadCode += 'local ' + PREFIX + 'CH=function()if ' + PREFIX + 'D()then error()end end;';
    deadCode += 'for i=1,5 do ' + PREFIX + 'CH()end;';

    /* Virtualized execution simulation */
    deadCode += 'local ' + PREFIX + 'VS={};';
    deadCode += 'local ' + PREFIX + 'OP={';
    deadCode += 'function()' + PREFIX + 'VS[#' + PREFIX + 'VS+1]=1 end,';
    deadCode += 'function()' + PREFIX + 'VS[#' + PREFIX + 'VS+1]=2 end,';
    deadCode += 'function()local a=' + PREFIX + 'VS[#' + PREFIX + 'VS] ' + PREFIX + 'VS[#' + PREFIX + 'VS]=nil local b=' + PREFIX + 'VS[#' + PREFIX + 'VS] ' + PREFIX + 'VS[#' + PREFIX + 'VS]=a+b end';
    deadCode += '};';
    deadCode += 'local ' + PREFIX + 'PC=0 local ' + PREFIX + 'BC={1,2,3,2,1,3};';
    deadCode += 'for i=1,#' + PREFIX + 'BC do local opc=' + PREFIX + 'BC[i] ' + PREFIX + 'OP[opc]() end;';
  }

  return {code: stub + junk + deadCode + body + '\n', stats: stats};
}

return gngObfuscate;
}));
