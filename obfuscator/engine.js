/* GNG obfuscator engine - single-target Lua/Luau source transformer.
 *
 * Shared by the hosted page (public/obfuscator.html) and server-side use.
 * ES3-compatible on purpose (runs in any browser, Node, and cscript).
 *
 * What it does: strips comments, renames every `local`-scoped identifier
 * with scope-correct resolution, encrypts string literals (per-literal
 * random additive key, hex), mangles plain integers, prepends a tiny
 * additive decryptor + dead locals.
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
 *   opts: {rename:bool, strings:bool, numbers:bool} (all default true)
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
  function cryptBytes(data) {
    var k = 1 + rnd(255), hx = '', i, b;
    for (i = 0; i < data.length; i++) {
      b = (data[i] + k) % 256;
      hx += (b < 16 ? '0' : '') + b.toString(16);
    }
    return [hx, k];
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
    if (PREV === '[' && la[1] === ']') emit(DEC + '("' + ck[0] + '",' + ck[1] + ')');
    else emit('(' + DEC + '("' + ck[0] + '",' + ck[1] + '))');
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
  var stub = 'local ' + DEC + '=function(h,k)local r={}for i=1,#h,2 do ' +
    'r[#r+1]=string.char((tonumber(h:sub(i,i+1),16)-k)%256)end ' +
    'return table.concat(r)end;';
  var junk = '', j;
  for (j = 0; j < 6; j++) junk += 'local ' + PREFIX + 'J' + j + '=(' + rnd(10000) + '+' + rnd(10000) + ');';
  return {code: stub + junk + body + '\n', stats: stats};
}

return gngObfuscate;
}));
