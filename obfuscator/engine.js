/* Luau/Lua source obfuscator engine (v8)
 * Source transformer for Luau / Lua (executor-oriented output).
 * ES3-style syntax: var only, no arrows, let/const, or template literals.
 *
 * API: obfuscate(source, seed, opts) -> { code, stats }
 *   opts.singleLine (default false): true emits the generated Lua as one physical line.
 *     Line numbers in error messages and tracebacks then read 1. Some Luau constructs
 *     that cannot be rewritten safely are refused with a "single-line output refused" error.
 *     stats.format is set to "single-line" only in this mode.
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

var ALPHA_L = 'abcdefghijklmnopqrstuvwxyz';
var ALPHA_U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function contains(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true; return false; }
function isAlpha(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
function isDigit(c) { return c >= '0' && c <= '9'; }
function isAlnum(c) { return isAlpha(c) || isDigit(c); }

var KEYWORDS = {'and':1,'break':1,'do':1,'else':1,'elseif':1,'end':1,
  'false':1,'for':1,'function':1,'goto':1,'if':1,'in':1,'local':1,'nil':1,
  'not':1,'or':1,'repeat':1,'return':1,'then':1,'true':1,'until':1,
  'while':1,'continue':1};
var COMPLETE_K = {'ID':1,'NUM':1,'STR':1,'LSTR':1};
var COMPLETE_V = {'true':1,'false':1,'nil':1,'...':1,')':1,']':1,'}':1,'break':1,'end':1};
var BLOCK_KW = {'local':1,'function':1,'if':1,'while':1,'for':1,'repeat':1,
  'do':1,'end':1,'else':1,'elseif':1,'until':1,'return':1,'break':1,'then':1,'in':1};
var NEVER = {'self':1,'_G':1,'_VERSION':1};
var ENV_NAMES = {'request':1,'writefile':1,'readfile':1,'isfile':1,'loadfile':1,
  'loadstring':1,'getgenv':1,'http_request':1,'syn':1,'game':1,'wait':1,'task':1,
  'require':1,'print':1,'warn':1,'error':1,'pcall':1,'xpcall':1,'select':1,'type':1,
  'typeof':1,'tostring':1,'tonumber':1,'tick':1,'time':1,'os':1,'math':1,'string':1,
  'table':1,'coroutine':1,'bit32':1,'debug':1,'getfenv':1,'setfenv':1};
var STARTERS = {'local':1,'if':1,'while':1,'for':1,'repeat':1,'function':1};
var BLOCK_OPEN = {'function':1,'if':1,'do':1,'repeat':1};
var SIMPLE_ESC = {'a':7,'b':8,'f':12,'n':10,'r':13,'t':9,'v':11,'\\':92,
  '"':34,"'":39,'\n':10};

// ---------- tokenizer ----------
function tokenize(s) {
  var toks = [], i = 0, n = s.length, c, j, m, d, w, lo, mo, sym, seg, raw, q, two, three;
  function longOpen(p) {
    if (s.charAt(p) !== '[') return null;
    var k = p + 1, eq = '';
    while (s.charAt(k) === '=') { eq += '='; k++; }
    if (s.charAt(k) !== '[') return null;
    return { eq: eq, end: k + 1 };
  }
  while (i < n) {
    c = s.charAt(i);
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\v' || c === '\f') { i++; continue; }
    if (c === '-' && s.charAt(i + 1) === '-') {
      mo = s.charAt(i + 2) === '[' ? longOpen(i + 2) : null;
      if (mo) {
        j = s.indexOf(']' + mo.eq + ']', mo.end);
        if (j < 0) throw new Error('lex: unterminated long comment');
        i = j + mo.eq.length + 2; continue;
      }
      j = s.indexOf('\n', i);
      i = j < 0 ? n : j;
      continue;
    }
    lo = longOpen(i);
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
      seg = s.substr(i, 256);
      m = /^0[xX][0-9a-fA-F_]+/.exec(seg) || /^0[bB][01_]+/.exec(seg) ||
          /^(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9]+)?/.exec(seg);
      toks.push(['NUM', m[0]]); i += m[0].length;
      continue;
    }
    if (isAlpha(c)) {
      j = i;
      while (j < n && isAlnum(s.charAt(j))) j++;
      w = s.substring(i, j);
      toks.push([has(KEYWORDS, w) ? 'KW' : 'ID', w]);
      i = j;
      continue;
    }
    three = s.substr(i, 3); two = s.substr(i, 2); sym = null;
    if (three === '...' || three === '..=') sym = three;
    else if (two === '..' || two === '==' || two === '~=' || two === '<=' || two === '>=' ||
             two === '//' || two === '+=' || two === '-=' || two === '*=' || two === '/=' ||
             two === '%=' || two === '^=') sym = two;
    if (!sym && two === '::') throw new Error('lex: labels / type annotations unsupported');
    if (sym) { toks.push(['SYM', sym]); i += sym.length; continue; }
    if ('(){}[];:,+-*/%^#<>=.'.indexOf(c) >= 0) { toks.push(['SYM', c]); i++; continue; }
    if (s.charCodeAt(i) > 127) throw new Error('lex: non-ascii outside string');
    throw new Error('lex: bad char ' + c);
  }
  return toks;
}

// ---------- string helpers ----------
function decodeShort(raw) {
  var out = [], i = 0, n = raw.length, e, mm, c, cc;
  while (i < n) {
    c = raw.charAt(i);
    if (c !== '\\') {
      cc = raw.charCodeAt(i);
      if (cc < 128) out.push(cc);
      else if (cc < 2048) out.push(192 | (cc >> 6), 128 | (cc & 63));
      else out.push(224 | (cc >> 12), 128 | ((cc >> 6) & 63), 128 | (cc & 63));
      i++;
      continue;
    }
    if (i + 1 >= n) return null;
    e = raw.charAt(i + 1);
    if (has(SIMPLE_ESC, e)) { out.push(SIMPLE_ESC[e]); i += 2; }
    else if (e === 'x' || e === 'u' || e === 'z') return null;
    else if (e >= '0' && e <= '9') {
      mm = /^[0-9]{1,3}/.exec(raw.substring(i + 1));
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

// ---------- expression parser ----------
// Works on source tokens from tokenize(): [kind, text, ...]. Produces an AST that
// emitExpr() turns back into tokens. Binary priorities follow Lua 5.3's table, so
// precedence and right-associativity of '..' and '^' are preserved. Every
// sub-expression that is an operator node is parenthesized on output, which keeps
// the tree identical regardless of context.
var BINPREC = {
  'or': [1, 1], 'and': [2, 2],
  '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3],
  '|': [4, 4], '~': [5, 5], '&': [6, 6], '<<': [7, 7], '>>': [7, 7],
  '..': [9, 8], '+': [10, 10], '-': [10, 10],
  '*': [11, 11], '/': [11, 11], '//': [11, 11], '%': [11, 11],
  '^': [14, 13]
};
var UNARY_PREC = 12;

// Block-opening keywords for skipping over a function literal's body.
function rawFunctionEnd(toks, st) {
  var d = 0, k, t;
  for (k = st; k < toks.length; k++) {
    t = toks[k][1];
    if (toks[k][0] !== 'KW' && toks[k][0] !== 'SYM') continue;
    if (has(BLOCK_OPEN, t)) d++;
    else if (t === 'end' || t === 'until') { d--; if (d === 0) return k; }
  }
  throw new Error('parse: unterminated function literal');
}

function parseCallArgs(toks, st) {
  var t = toks[st], args = [], r, pos;
  if (t && t[0] === 'STR') return { args: [{ k: 'tok', tok: t }], pos: st + 1 };
  if (t && t[0] === 'LSTR') return { args: [{ k: 'tok', tok: t }], pos: st + 1 };
  if (t && t[1] === '{') { r = parseTableAt(toks, st); return { args: [r.node], pos: r.pos }; }
  if (!t || t[1] !== '(') throw new Error('parse: expected call arguments');
  pos = st + 1;
  if (toks[pos] && toks[pos][1] === ')') return { args: args, pos: pos + 1 };
  for (;;) {
    r = parseExprAt(toks, pos, 0);
    args.push(r.node);
    pos = r.pos;
    if (toks[pos] && toks[pos][1] === ',') { pos++; continue; }
    if (toks[pos] && toks[pos][1] === ')') return { args: args, pos: pos + 1 };
    throw new Error('parse: expected , or ) in arguments');
  }
}

function parseTableAt(toks, st) {
  var items = [], pos = st + 1, t, r, key, nx;
  if (!toks[st] || toks[st][1] !== '{') throw new Error('parse: expected {');
  while (toks[pos] && toks[pos][1] !== '}') {
    t = toks[pos];
    nx = toks[pos + 1];
    if (t[0] === 'ID' && nx && nx[1] === '=') {
      r = parseExprAt(toks, pos + 2, 0);
      items.push({ key: { k: 'tok', tok: t }, val: r.node, named: true });
      pos = r.pos;
    } else if (t[1] === '[') {
      r = parseExprAt(toks, pos + 1, 0);
      key = r.node;
      if (!toks[r.pos] || toks[r.pos][1] !== ']') throw new Error('parse: expected ] in table key');
      if (!toks[r.pos + 1] || toks[r.pos + 1][1] !== '=') throw new Error('parse: expected = in table key');
      r = parseExprAt(toks, r.pos + 2, 0);
      items.push({ key: key, val: r.node, named: false, bracket: true });
      pos = r.pos;
    } else {
      r = parseExprAt(toks, pos, 0);
      items.push({ key: null, val: r.node, named: false });
      pos = r.pos;
    }
    if (toks[pos] && (toks[pos][1] === ',' || toks[pos][1] === ';')) { pos++; continue; }
    break;
  }
  if (!toks[pos] || toks[pos][1] !== '}') throw new Error('parse: expected } in table');
  return { node: { k: 'table', items: items }, pos: pos + 1 };
}

function parsePrimaryAt(toks, st) {
  var t = toks[st], node, pos, r, a, nm;
  if (!t) throw new Error('parse: unexpected end of expression');
  if (t[0] === 'NUM' || t[0] === 'STR' || t[0] === 'LSTR') { node = { k: 'tok', tok: t }; pos = st + 1; }
  else if (t[0] === 'KW' && (t[1] === 'nil' || t[1] === 'true' || t[1] === 'false')) { node = { k: 'tok', tok: t }; pos = st + 1; }
  else if (t[0] === 'SYM' && t[1] === '...') { node = { k: 'tok', tok: t }; pos = st + 1; }
  else if (t[0] === 'ID') { node = { k: 'name', tok: t }; pos = st + 1; }
  else if (t[0] === 'SYM' && t[1] === '(') {
    r = parseExprAt(toks, st + 1, 0);
    if (!toks[r.pos] || toks[r.pos][1] !== ')') throw new Error('parse: expected )');
    node = { k: 'paren', e: r.node };
    pos = r.pos + 1;
  }
  else if (t[0] === 'SYM' && t[1] === '{') { r = parseTableAt(toks, st); node = r.node; pos = r.pos; }
  else if (t[0] === 'KW' && t[1] === 'function') {
    r = rawFunctionEnd(toks, st);
    node = { k: 'raw', toks: toks.slice(st, r + 1) };
    pos = r + 1;
  }
  else throw new Error('parse: unexpected token ' + t[1]);

  // suffixes: .name  [expr]  :name args  args
  for (;;) {
    t = toks[pos];
    if (!t) break;
    if (t[0] === 'SYM' && t[1] === '.') {
      nm = toks[pos + 1];
      if (!nm || nm[0] !== 'ID') throw new Error('parse: expected name after .');
      node = { k: 'index', o: node, key: { k: 'tok', tok: [ 'STR', nm[1] ] }, dot: nm };
      pos += 2;
    } else if (t[0] === 'SYM' && t[1] === '[') {
      r = parseExprAt(toks, pos + 1, 0);
      if (!toks[r.pos] || toks[r.pos][1] !== ']') throw new Error('parse: expected ]');
      node = { k: 'index', o: node, key: r.node };
      pos = r.pos + 1;
    } else if (t[0] === 'SYM' && t[1] === ':') {
      nm = toks[pos + 1];
      if (!nm || nm[0] !== 'ID') throw new Error('parse: expected name after :');
      a = parseCallArgs(toks, pos + 2);
      node = { k: 'call', f: node, method: nm, args: a.args };
      pos = a.pos;
    } else if ((t[0] === 'SYM' && (t[1] === '(' || t[1] === '{')) || t[0] === 'STR' || t[0] === 'LSTR') {
      a = parseCallArgs(toks, pos);
      node = { k: 'call', f: node, args: a.args };
      pos = a.pos;
    } else break;
  }
  return { node: node, pos: pos };
}

function parseUnaryAt(toks, st) {
  var t = toks[st], r;
  if (t && ((t[0] === 'KW' && t[1] === 'not') || (t[0] === 'SYM' && (t[1] === '-' || t[1] === '#' || t[1] === '~')))) {
    r = parseExprAt(toks, st + 1, UNARY_PREC);
    return { node: { k: 'un', op: t[1], e: r.node, tok: t }, pos: r.pos };
  }
  return parsePrimaryAt(toks, st);
}

// Precedence climbing. 'limit' is the minimum left priority an operator needs.
function parseExprAt(toks, st, limit) {
  var r = parseUnaryAt(toks, st), left = r.node, pos = r.pos, t, op, pr, rr;
  for (;;) {
    t = toks[pos];
    if (!t) break;
    if (!((t[0] === 'SYM' || t[0] === 'KW') && has(BINPREC, t[1]))) break;
    op = t[1];
    pr = BINPREC[op];
    if (pr[0] <= limit) break;
    rr = parseExprAt(toks, pos + 1, pr[1]);
    left = { k: 'bin', op: op, l: left, r: rr.node, tok: t };
    pos = rr.pos;
  }
  return { node: left, pos: pos };
}

// Emit AST back to tokens in [kind, text] form.
function emitExpr(n) {
  var out = [], i, child;
  function wrap(c) {
    if (c.k === 'bin' || c.k === 'un') { out.push(['SYM', '(']); emitInto(c); out.push(['SYM', ')']); }
    else emitInto(c);
  }
  function emitInto(c) {
    var j;
    switch (c.k) {
      case 'tok': out.push(c.tok); break;
      case 'name': out.push(c.tok); break;
      case 'raw': for (j = 0; j < c.toks.length; j++) out.push(c.toks[j]); break;
      case 'paren': out.push(['SYM', '(']); emitInto(c.e); out.push(['SYM', ')']); break;
      case 'un': out.push(c.tok); wrap(c.e); break;
      case 'bin': wrap(c.l); out.push(c.tok); wrap(c.r); break;
      case 'index':
        wrap(c.o);
        if (c.dot) { out.push(['SYM', '.'], c.dot); }
        else { out.push(['SYM', '[']); emitInto(c.key); out.push(['SYM', ']']); }
        break;
      case 'call':
        wrap(c.f);
        if (c.method) out.push(['SYM', ':'], c.method);
        if (c.args.length === 1 && (c.args[0].k === 'tok' && (c.args[0].tok[0] === 'STR' || c.args[0].tok[0] === 'LSTR'))) {
          out.push(c.args[0].tok);
        } else if (c.args.length === 1 && c.args[0].k === 'table') {
          emitInto(c.args[0]);
        } else {
          out.push(['SYM', '(']);
          for (i = 0; i < c.args.length; i++) { if (i) out.push(['SYM', ',']); emitInto(c.args[i]); }
          out.push(['SYM', ')']);
        }
        break;
      case 'table':
        out.push(['SYM', '{']);
        for (i = 0; i < c.items.length; i++) {
          child = c.items[i];
          if (i) out.push(['SYM', ',']);
          if (child.named) { out.push(child.key.tok, ['SYM', '=']); emitInto(child.val); }
          else if (child.bracket) { out.push(['SYM', '[']); emitInto(child.key); out.push(['SYM', ']'], ['SYM', '=']); emitInto(child.val); }
          else emitInto(child.val);
        }
        out.push(['SYM', '}']);
        break;
      default: throw new Error('emit: unknown node ' + c.k);
    }
  }
  emitInto(n);
  return out;
}

// ---------- VM layer ----------
// Functions inside the supported subset are compiled to register bytecode. Each
// original body is replaced by a call into one interpreter emitted at the top of
// the chunk. Opcode numbers are permuted per build. A function that does not fit
// the subset (nested functions, varargs, goto, free names that are also declared
// as locals elsewhere, multi-value positions) is left alone, so the layer is
// always safe to skip per function.
//
// Known differences from native execution: error messages and tracebacks differ,
// and free globals are read from getgenv() (or _G) rather than the script's own
// environment. The layer is therefore opt-in (opts.vm).
var VM_OPS = ['MOVE','LOADK','LOADNIL','GETG','SETG','GETT','SETT','SELF','TABLE',
  'ADD','SUB','MUL','DIV','IDIV','MOD','POW','CONCAT','EQ','LT','LE',
  'UNM','NOT','LEN','JMP','JF','JT','CALL','CALLP','CALLM','CALLMP','RETN','RETM','RET0','FORPREP','FORSTEP','APPEND','SETALL','VARG','VARGP','CLOSURE'];
var VM_BIN = {'+':'ADD','-':'SUB','*':'MUL','/':'DIV','//':'IDIV','%':'MOD','^':'POW','..':'CONCAT'};
var VM_END_KW = {'end':1,'else':1,'elseif':1,'until':1};

function vmFail(m) { throw new Error('vm: ' + m); }
function isKw(t, w) { return !!t && t[0] === 'KW' && t[1] === w; }
function isSym(t, s) { return !!t && t[0] === 'SYM' && t[1] === s; }
function vmStrTok(s) { return ['STR', vmLuaStr(s), '"', s]; }
function vmNumTok(n) { return ['NUM', String(n)]; }

function vmLuaStr(s) {
  var out = '"', i, c, code;
  for (i = 0; i < s.length; i++) {
    c = s.charAt(i); code = s.charCodeAt(i);
    if (c === '"' || c === '\\') out += '\\' + c;
    else if (code < 32 || code > 126) out += '\\' + ('00' + code).slice(-3);
    else out += c;
  }
  return out + '"';
}

// ----- statement parser (works on the same token format as parseExprAt) -----
function vmExpect(toks, pos, w) {
  if (!toks[pos] || toks[pos][1] !== w) vmFail('expected ' + w);
  return pos + 1;
}

function vmExplist(toks, pos) {
  var list = [], r;
  for (;;) {
    r = parseExprAt(toks, pos, 0);
    list.push(r.node);
    pos = r.pos;
    if (isSym(toks[pos], ',')) { pos++; continue; }
    return { list: list, pos: pos };
  }
}

function vmBlock(toks, pos, stops) {
  var list = [], st, t, q;
  for (;;) {
    t = toks[pos];
    if (!t) break;
    if (t[0] === 'KW' && has(stops, t[1])) break;
    if (isSym(t, ';')) { pos++; continue; }
    st = vmStmt(toks, pos);
    list.push(st.node);
    pos = st.pos;
    if (st.node.k === 'return') {
      q = pos;
      while (isSym(toks[q], ';')) q++;
      if (toks[q] && !(toks[q][0] === 'KW' && has(stops, toks[q][1]))) vmFail('statement after return');
      pos = q;
    }
  }
  return { list: list, pos: pos };
}

function vmStmt(toks, pos) {
  var t = toks[pos], nx = toks[pos + 1], r, r2, names, exprs, clauses, body, els, p, targets, e1, e2, e3, name, i, endish;
  if (t[0] === 'KW') {
    switch (t[1]) {
      case 'local':
        if (isKw(nx, 'function')) {
          if (!toks[pos + 2] || toks[pos + 2][0] !== 'ID') vmFail('local function name');
          r = rawFunctionEnd(toks, pos + 1);
          return { node: { k: 'localfn', name: toks[pos + 2][1], fn: toks.slice(pos + 1, r + 1) }, pos: r + 1 };
        }
        names = []; pos++;
        for (;;) {
          if (!toks[pos] || toks[pos][0] !== 'ID') vmFail('local name');
          names.push(toks[pos][1]);
          pos++;
          if (isSym(toks[pos], '<')) vmFail('attribute');
          if (isSym(toks[pos], ',')) { pos++; continue; }
          break;
        }
        exprs = [];
        if (isSym(toks[pos], '=')) { r = vmExplist(toks, pos + 1); exprs = r.list; pos = r.pos; }
        return { node: { k: 'local', names: names, exprs: exprs }, pos: pos };
      case 'if':
        clauses = [];
        r = parseExprAt(toks, pos + 1, 0);
        pos = vmExpect(toks, r.pos, 'then');
        body = vmBlock(toks, pos, { 'elseif': 1, 'else': 1, 'end': 1 });
        clauses.push({ cond: r.node, body: body.list });
        pos = body.pos;
        while (isKw(toks[pos], 'elseif')) {
          r = parseExprAt(toks, pos + 1, 0);
          pos = vmExpect(toks, r.pos, 'then');
          body = vmBlock(toks, pos, { 'elseif': 1, 'else': 1, 'end': 1 });
          clauses.push({ cond: r.node, body: body.list });
          pos = body.pos;
        }
        els = null;
        if (isKw(toks[pos], 'else')) {
          body = vmBlock(toks, pos + 1, { 'end': 1 });
          els = body.list;
          pos = body.pos;
        }
        pos = vmExpect(toks, pos, 'end');
        return { node: { k: 'if', clauses: clauses, els: els }, pos: pos };
      case 'while':
        r = parseExprAt(toks, pos + 1, 0);
        pos = vmExpect(toks, r.pos, 'do');
        body = vmBlock(toks, pos, { 'end': 1 });
        pos = vmExpect(toks, body.pos, 'end');
        return { node: { k: 'while', cond: r.node, body: body.list }, pos: pos };
      case 'do':
        body = vmBlock(toks, pos + 1, { 'end': 1 });
        pos = vmExpect(toks, body.pos, 'end');
        return { node: { k: 'do', body: body.list }, pos: pos };
      case 'repeat':
        body = vmBlock(toks, pos + 1, { 'until': 1 });
        pos = vmExpect(toks, body.pos, 'until');
        r = parseExprAt(toks, pos, 0);
        return { node: { k: 'repeat', body: body.list, cond: r.node }, pos: r.pos };
      case 'for':
        if (!nx || nx[0] !== 'ID' || !isSym(toks[pos + 2], '=')) vmFail('generic for');
        name = nx[1];
        r = parseExprAt(toks, pos + 3, 0);
        e1 = r.node;
        pos = vmExpect(toks, r.pos, ',');
        r = parseExprAt(toks, pos, 0);
        e2 = r.node; pos = r.pos;
        e3 = null;
        if (isSym(toks[pos], ',')) { r = parseExprAt(toks, pos + 1, 0); e3 = r.node; pos = r.pos; }
        pos = vmExpect(toks, pos, 'do');
        body = vmBlock(toks, pos, { 'end': 1 });
        pos = vmExpect(toks, body.pos, 'end');
        return { node: { k: 'fornum', name: name, e1: e1, e2: e2, e3: e3, body: body.list }, pos: pos };
      case 'return':
        pos++;
        endish = !toks[pos] || (toks[pos][0] === 'KW' && has(VM_END_KW, toks[pos][1])) || isSym(toks[pos], ';');
        exprs = [];
        if (!endish) { r = vmExplist(toks, pos); exprs = r.list; pos = r.pos; }
        return { node: { k: 'return', exprs: exprs }, pos: pos };
      case 'function': {
        // function a.b:c(...) ... end  ->  a.b.c = function(...) ... end
        if (!toks[pos + 1] || toks[pos + 1][0] !== 'ID') vmFail('function name');
        var target = { k: 'name', tok: toks[pos + 1] }, q = pos + 2, method = false;
        while (isSym(toks[q], '.') || isSym(toks[q], ':')) {
          if (!toks[q + 1] || toks[q + 1][0] !== 'ID') vmFail('function name');
          if (toks[q][1] === ':') method = true;
          target = { k: 'index', o: target, key: { k: 'tok', tok: ['STR', toks[q + 1][1]] } };
          q += 2;
          if (method) break;
        }
        r = rawFunctionEnd(toks, pos);
        return { node: { k: 'assign', targets: [target], exprs: [{ k: 'raw', toks: toks.slice(pos, r + 1) }] }, pos: r + 1 };
      }
      case 'break':
        return { node: { k: 'break' }, pos: pos + 1 };
      default:
        vmFail('unsupported keyword ' + t[1]);
    }
  }
  p = parsePrimaryAt(toks, pos);
  if (isSym(toks[p.pos], ',') || isSym(toks[p.pos], '=')) {
    targets = [p.node];
    pos = p.pos;
    while (isSym(toks[pos], ',')) {
      p = parsePrimaryAt(toks, pos + 1);
      targets.push(p.node);
      pos = p.pos;
    }
    for (i = 0; i < targets.length; i++) {
      if (targets[i].k !== 'name' && targets[i].k !== 'index') vmFail('bad assignment target');
    }
    pos = vmExpect(toks, pos, '=');
    r = vmExplist(toks, pos);
    return { node: { k: 'assign', targets: targets, exprs: r.list }, pos: r.pos };
  }
  if (p.node.k !== 'call') vmFail('expression statement');
  return { node: { k: 'callstat', e: p.node }, pos: p.pos };
}

// ----- compiler: AST -> flat bytecode (4 slots per instruction) -----
// Operand conventions: registers are 1-based, K indices are 1-based, jump targets
// are slot indices (1-based index of the opcode slot).
function isMulti(n) { return n.k === 'call' || (n.k === 'tok' && n.tok[0] === 'SYM' && n.tok[1] === '...'); }

function vmCompileBody(params, toks, all, isVararg, reg) {
  var body = vmBlock(toks, 0, {}).list;
  var code = [], consts = [], cidx = {}, scopes = [], top = 1, loops = [], i;

  function here() { return code.length + 1; }
  function emit(op, a, b, c) { var s = here(); code.push(op, a || 0, b || 0, c || 0); return s; }
  function patch(slot, field, v) { code[slot - 1 + (field === 'a' ? 1 : field === 'b' ? 2 : 3)] = v; }
  function alloc() { var r = top; top++; return r; }
  function kidx(tok) {
    var key = tok[0] + '\u0001' + tok[1];
    if (!has(cidx, key)) { consts.push(tok); cidx[key] = consts.length; }
    return cidx[key];
  }
  function resolve(nm) {
    var s, m;
    for (s = scopes.length - 1; s >= 0; s--) {
      m = scopes[s].m;
      if (has(m, nm)) return m[nm];
    }
    return null;
  }
  function pushScope() { scopes.push({ m: {} }); return top; }
  function popScope(sv) { scopes.pop(); top = sv; }
  function bindLocal(nm, reg) { scopes[scopes.length - 1].m[nm] = reg; }

  // pack=true leaves all results of the call packed as {n=..., ...} in the base register
  // Packs every value of a multi-value expression into register pk.
  function packOf(node, pk) {
    var r;
    if (node.k === 'tok') {
      if (!isVararg) vmFail('... outside a vararg function');
      emit('VARGP', pk);
      return;
    }
    r = compileCall(node, true);
    emit('MOVE', pk, r);
  }

  function compileCall(n, pack) {
    var base = alloc(), nfix = 0, rr, i2, last, lastMulti, pk, r;
    cexpr(n.f, base);
    if (n.method) {
      rr = alloc();
      emit('SELF', base, base, kidx(vmStrTok(n.method[1])));
      nfix = 1;
    }
    last = n.args.length - 1;
    lastMulti = last >= 0 && isMulti(n.args[last]);
    for (i2 = 0; i2 < n.args.length; i2++) {
      if (lastMulti && i2 === last) break;
      rr = alloc();
      cexpr(n.args[i2], rr);
      nfix++;
    }
    if (lastMulti) {
      pk = alloc();
      packOf(n.args[last], pk);
      top = pk + 1;
      emit(pack ? 'CALLMP' : 'CALLM', base, nfix);
    } else {
      emit(pack ? 'CALLP' : 'CALL', base, nfix);
    }
    top = base + 1;
    return base;
  }

  // Evaluates exprs into the already allocated registers dsts. A trailing call that
  // must supply several values is packed once and unpacked by index.
  function evalList(exprs, dsts) {
    var i2, e, pk, r, key, ex, j, n = dsts.length;
    for (i2 = 0; i2 < exprs.length; i2++) {
      e = exprs[i2];
      if (i2 === exprs.length - 1 && isMulti(e) && n > exprs.length) {
        pk = alloc();
        packOf(e, pk);
        top = pk + 1;
        for (j = i2; j < n; j++) {
          key = alloc();
          emit('LOADK', key, kidx(vmNumTok(j - i2 + 1)));
          emit('GETT', dsts[j], pk, key);
          top = key;
        }
        return;
      }
      if (i2 < n) cexpr(e, dsts[i2]);
      else { ex = alloc(); cexpr(e, ex); top = ex; }
    }
    for (j = exprs.length; j < n; j++) emit('LOADNIL', dsts[j]);
  }

  function compileTable(n, dst) {
    var i2, it, kr, vr, pos = 1, pk, r;
    for (i2 = 0; i2 < n.items.length; i2++) {
      it = n.items[i2];
      if (it.key === null && i2 === n.items.length - 1 && isMulti(it.val)) {
        pk = alloc();
        packOf(it.val, pk);
        // a table that is only a multi-value tail is built in one step, like the native constructor
        if (n.items.length === 1) emit('SETALL', dst, pk);
        else emit('APPEND', dst, pk, pos);
        top = pk;
        continue;
      }
      if (it.key === null) {
        kr = alloc();
        emit('LOADK', kr, kidx(vmNumTok(pos)));
        pos++;
      } else if (it.named) {
        kr = alloc();
        emit('LOADK', kr, kidx(vmStrTok(it.key.tok[1])));
      } else {
        kr = alloc();
        cexpr(it.key, kr);
      }
      vr = alloc();
      cexpr(it.val, vr);
      emit('SETT', dst, kr, vr);
      top = kr;
    }
  }

  function cexpr(n, dst) {
    var t0 = top, r1, r2, op, tk, nm, s2;
    switch (n.k) {
      case 'tok':
        tk = n.tok;
        if (tk[0] === 'STR' && tk.length < 4) tk = vmStrTok(tk[1]);
        if (tk[0] === 'KW' && tk[1] === 'nil') emit('LOADNIL', dst);
        else if (tk[0] === 'SYM' && tk[1] === '...') {
          if (!isVararg) vmFail('... outside a vararg function');
          emit('VARG', dst);
        }
        else emit('LOADK', dst, kidx(tk));
        break;
      case 'name':
        nm = n.tok[1];
        r1 = resolve(nm);
        if (r1 !== null) emit('MOVE', dst, r1);
        else {
          if (has(all, nm)) vmFail('free name also declared as a local: ' + nm);
          emit('GETG', dst, kidx(vmStrTok(nm)));
        }
        break;
      case 'paren':
        cexpr(n.e, dst);
        break;
      case 'un':
        op = n.op === '-' ? 'UNM' : n.op === '#' ? 'LEN' : n.op === 'not' ? 'NOT' : null;
        if (!op) vmFail('unary ' + n.op);
        r1 = alloc();
        cexpr(n.e, r1);
        emit(op, dst, r1);
        break;
      case 'bin':
        if (n.op === 'and' || n.op === 'or') {
          cexpr(n.l, dst);
          s2 = emit(n.op === 'and' ? 'JF' : 'JT', dst, 0);
          cexpr(n.r, dst);
          patch(s2, 'b', here());
          break;
        }
        r1 = alloc(); cexpr(n.l, r1);
        r2 = alloc(); cexpr(n.r, r2);
        if (has(VM_BIN, n.op)) emit(VM_BIN[n.op], dst, r1, r2);
        else if (n.op === '==') emit('EQ', dst, r1, r2);
        else if (n.op === '~=') { emit('EQ', dst, r1, r2); emit('NOT', dst, dst); }
        else if (n.op === '<') emit('LT', dst, r1, r2);
        else if (n.op === '>') emit('LT', dst, r2, r1);
        else if (n.op === '<=') emit('LE', dst, r1, r2);
        else if (n.op === '>=') emit('LE', dst, r2, r1);
        else vmFail('operator ' + n.op);
        break;
      case 'index':
        r1 = alloc(); cexpr(n.o, r1);
        r2 = alloc(); cexpr(n.key, r2);
        emit('GETT', dst, r1, r2);
        break;
      case 'raw':
        r1 = closureFor(n.toks);
        emit('CLOSURE', dst, r1.idx, r1.flag);
        break;
      case 'call':
        r1 = compileCall(n, false);
        emit('MOVE', dst, r1);
        break;
      case 'table':
        emit('TABLE', dst);
        compileTable(n, dst);
        break;
      default:
        vmFail('expression ' + n.k);
    }
    top = t0;
  }

  // Compiles a nested function literal (no upvalues) as its own VM function.
  function closureFor(ftoks) {
    var h = fnHeader(ftoks, 0), body, sub;
    if (!h) vmFail('bad nested function');
    body = ftoks.slice(h.close + 1, ftoks.length - 1);
    sub = vmCompileBody(h.params, body, all, h.vararg, reg);
    return { idx: reg(sub), flag: h.params.length * 2 + (h.vararg ? 1 : 0) };
  }

  function stmts(list) { var i2; for (i2 = 0; i2 < list.length; i2++) stmt(list[i2]); }
  function block(list) { var sv = pushScope(); stmts(list); popScope(sv); }

  function stmt(s) {
    var t0 = top, i2, regs, info, vr, e, base, o, kr, c, jf, ends, lp, start, endSlot, prep, lim, stp, lv, sv, r1, ex, multi, pk;
    switch (s.k) {
      case 'local':
        regs = [];
        for (i2 = 0; i2 < s.names.length; i2++) regs.push(alloc());
        evalList(s.exprs, regs);
        for (i2 = 0; i2 < s.names.length; i2++) bindLocal(s.names[i2], regs[i2]);
        top = regs[regs.length - 1] + 1;
        return;   // the new locals stay allocated until the enclosing scope ends
      case 'assign':
        info = [];
        for (i2 = 0; i2 < s.targets.length; i2++) {
          e = s.targets[i2];
          if (e.k === 'name') {
            r1 = resolve(e.tok[1]);
            if (r1 !== null) info.push({ kind: 'loc', reg: r1 });
            else {
              if (has(all, e.tok[1])) vmFail('free name also declared as a local: ' + e.tok[1]);
              info.push({ kind: 'glob', name: e.tok[1] });
            }
          } else {
            o = alloc(); cexpr(e.o, o);
            kr = alloc(); cexpr(e.key, kr);
            info.push({ kind: 'idx', o: o, k: kr });
          }
        }
        vr = [];
        for (i2 = 0; i2 < s.targets.length; i2++) vr.push(alloc());
        evalList(s.exprs, vr);
        for (i2 = 0; i2 < info.length; i2++) {
          if (info[i2].kind === 'loc') emit('MOVE', info[i2].reg, vr[i2]);
          else if (info[i2].kind === 'glob') emit('SETG', vr[i2], kidx(vmStrTok(info[i2].name)));
          else emit('SETT', info[i2].o, info[i2].k, vr[i2]);
        }
        break;
      case 'localfn':
        r1 = alloc();
        bindLocal(s.name, r1);
        sv = closureFor(s.fn);
        emit('CLOSURE', r1, sv.idx, sv.flag);
        top = r1 + 1;
        return;
      case 'callstat':
        compileCall(s.e, false);
        break;
      case 'do':
        block(s.body);
        break;
      case 'if':
        ends = [];
        for (i2 = 0; i2 < s.clauses.length; i2++) {
          c = alloc(); cexpr(s.clauses[i2].cond, c);
          jf = emit('JF', c, 0);
          top = c;
          block(s.clauses[i2].body);
          if (i2 < s.clauses.length - 1 || s.els) ends.push(emit('JMP', 0));
          patch(jf, 'b', here());
        }
        if (s.els) block(s.els);
        for (i2 = 0; i2 < ends.length; i2++) patch(ends[i2], 'a', here());
        break;
      case 'while':
        start = here();
        c = alloc(); cexpr(s.cond, c);
        jf = emit('JF', c, 0);
        top = c;
        lp = { breaks: [] };
        loops.push(lp);
        block(s.body);
        loops.pop();
        emit('JMP', start);
        endSlot = here();
        patch(jf, 'b', endSlot);
        for (i2 = 0; i2 < lp.breaks.length; i2++) patch(lp.breaks[i2], 'a', endSlot);
        break;
      case 'repeat':
        start = here();
        lp = { breaks: [] };
        loops.push(lp);
        sv = pushScope();
        stmts(s.body);
        c = alloc(); cexpr(s.cond, c);
        emit('JF', c, start);
        top = c;
        popScope(sv);
        loops.pop();
        endSlot = here();
        for (i2 = 0; i2 < lp.breaks.length; i2++) patch(lp.breaks[i2], 'a', endSlot);
        break;
      case 'fornum':
        base = alloc(); cexpr(s.e1, base);
        lim = alloc(); cexpr(s.e2, lim);
        stp = alloc();
        if (s.e3) cexpr(s.e3, stp);
        else emit('LOADK', stp, kidx(vmNumTok(1)));
        prep = emit('FORPREP', base, 0, 0);
        lv = alloc();
        lp = { breaks: [] };
        loops.push(lp);
        sv = pushScope();
        bindLocal(s.name, lv);
        stmts(s.body);
        popScope(sv);
        loops.pop();
        emit('FORSTEP', base, prep + 4, 0);
        endSlot = here();
        patch(prep, 'c', endSlot);
        for (i2 = 0; i2 < lp.breaks.length; i2++) patch(lp.breaks[i2], 'a', endSlot);
        break;
      case 'return':
        if (s.exprs.length === 0) { emit('RET0'); break; }
        multi = isMulti(s.exprs[s.exprs.length - 1]);
        base = top;
        for (i2 = 0; i2 < s.exprs.length; i2++) {
          if (multi && i2 === s.exprs.length - 1) {
            pk = alloc();
            packOf(s.exprs[i2], pk);
            top = pk + 1;
            break;
          }
          r1 = alloc();
          cexpr(s.exprs[i2], r1);
        }
        emit(multi ? 'RETM' : 'RETN', base, s.exprs.length);
        break;
      case 'break':
        if (!loops.length) vmFail('break outside loop');
        loops[loops.length - 1].breaks.push(emit('JMP', 0));
        break;
      default:
        vmFail('statement ' + s.k);
    }
    top = t0;
  }

  // parameters occupy registers 1..n; the interpreter fills them from its varargs
  scopes.push({ m: {} });
  for (i = 0; i < params.length; i++) bindLocal(params[i], i + 1);
  top = params.length + 1;
  stmts(body);
  emit('RET0');
  return { code: code, consts: consts, np: params.length };
}

// Interpreter source. Opcode numbers come from the per-build permutation.
function vmInterp(ids, nm) {
  var br = [
    ['MOVE', 'R[a] = R[b]'],
    ['LOADK', 'R[a] = K[b]'],
    ['LOADNIL', 'R[a] = nil'],
    ['GETG', 'R[a] = ' + nm.env + '[K[b]]'],
    ['SETG', nm.env + '[K[b]] = R[a]'],
    ['GETT', 'R[a] = R[b][R[c]]'],
    ['SETT', 'R[a][R[b]] = R[c]'],
    ['SELF', 'local o = R[b]; R[a + 1] = o; R[a] = o[K[c]]'],
    ['TABLE', 'R[a] = {}'],
    ['ADD', 'R[a] = R[b] + R[c]'],
    ['SUB', 'R[a] = R[b] - R[c]'],
    ['MUL', 'R[a] = R[b] * R[c]'],
    ['DIV', 'R[a] = R[b] / R[c]'],
    ['IDIV', 'R[a] = R[b] // R[c]'],
    ['MOD', 'R[a] = R[b] % R[c]'],
    ['POW', 'R[a] = R[b] ^ R[c]'],
    ['CONCAT', 'R[a] = R[b] .. R[c]'],
    ['EQ', 'R[a] = R[b] == R[c]'],
    ['LT', 'R[a] = R[b] < R[c]'],
    ['LE', 'R[a] = R[b] <= R[c]'],
    ['UNM', 'R[a] = -R[b]'],
    ['NOT', 'R[a] = not R[b]'],
    ['LEN', 'R[a] = #R[b]'],
    ['JMP', 'pc = a'],
    ['JF', 'if not R[a] then pc = b end'],
    ['JT', 'if R[a] then pc = b end'],
    ['CALL', 'R[a] = (R[a](' + nm.u + '(R, a + 1, a + b)))'],
    ['CALLP', 'R[a] = ' + nm.k + '(R[a](' + nm.u + '(R, a + 1, a + b)))'],
    ['CALLM', 'local f, t, p = R[a], {}, R[a + b + 1]; for i = 1, b do t[i] = R[a + i] end; for i = 1, p.n do t[b + i] = p[i] end; R[a] = (f(' + nm.u + '(t, 1, b + p.n)))'],
    ['CALLMP', 'local f, t, p = R[a], {}, R[a + b + 1]; for i = 1, b do t[i] = R[a + i] end; for i = 1, p.n do t[b + i] = p[i] end; R[a] = ' + nm.k + '(f(' + nm.u + '(t, 1, b + p.n)))'],
    ['RETN', 'return ' + nm.u + '(R, a, a + b - 1)'],
    ['SETALL', 'R[a] = {' + nm.u + '(R[b], 1, R[b].n)}'],
    ['APPEND', 'local p, t = R[b], R[a]; for i = 1, p.n do t[c + i - 1] = p[i] end'],
    ['CLOSURE', 'local F, D2 = c, ' + nm.d + '[b]; if ' + nm.x + 'gT' + '(D2) ~= "table" then ' + nm.x + 'gE' + '("vm: invalid closure record") end; R[a] = function(...) local va; if F % 2 == 1 then va = ' + nm.v + '((F - 1) // 2, ...) end; return ' + nm.x + '(D2, va, ...) end'],
    ['VARG', 'R[a] = va[1]'],
    ['VARGP', 'R[a] = va'],
    ['RETM', 'local p, t = R[a + b - 1], {}; for i = 1, b - 1 do t[i] = R[a + i - 1] end; for i = 1, p.n do t[b - 1 + i] = p[i] end; return ' + nm.u + '(t, 1, b - 1 + p.n)'],
    ['RET0', 'return'],
    ['FORPREP', "local i, l, s = R[a], R[a + 1], R[a + 2]; if s == 0 then " + nm.x + 'gE' + "(\"'for' step is zero\") end; " +
                'if (s > 0 and i <= l) or (s < 0 and i >= l) then R[a + 3] = i else pc = c end'],
    ['FORSTEP', 'local i = R[a] + R[a + 2]; R[a] = i; local l, s = R[a + 1], R[a + 2]; ' +
                'if (s > 0 and i <= l) or (s < 0 and i >= l) then R[a + 3] = i; pc = b end']
  ];
  var chain = br.map(function (x, k) {
    return (k ? 'elseif' : 'if') + ' op == ' + ids[x[0]] + ' then ' + x[1];
  }).join('\n');
  return [
    'local ' + nm.u + ' = table.unpack or unpack',
    vmVerifierLua(nm, ids, {capture: true, validate: true, flow: true}),
    'local function ' + nm.x + '(D, va, ...)',
    'local S = ' + nm.x + 'W[D]',
    'if not S then local c, k = ' + nm.x + 'N(D, true); S = {c, k}; ' + nm.x + 'W[D] = S end',
    'local C, K = S[1], S[2]',
    'local R = {...}',
    'local pc, op, a, b, c = 1, 0, 0, 0, 0',
    'while true do',
    'op, a, b, c = C[pc], C[pc + 1], C[pc + 2], C[pc + 3]',
    'pc = pc + 4',
    chain,
    'else ' + nm.x + 'gE' + '("vm: invalid opcode " .. ' + nm.x + 'gS' + '(op))',
    'end',
    'end',
    'end'
  ].join('\n');
}

// Tries to compile the function literal starting at T[i]. Returns null when the
// body is outside the subset (any failure is a clean skip).
function vmTryFunction(T, i, all, nm, reg) {
  var h, e, body, c, toks, args, k;
  h = fnHeader(T, i);
  if (!h) return null;
  try {
    e = rawFunctionEnd(T, i);
    body = T.slice(h.close + 1, e);
    c = vmCompileBody(h.params, body, all, h.vararg, reg);
  } catch (err) {
    return { skip: err.message };
  }
  args = [nm.d + '[' + reg(c) + ']', h.vararg ? nm.k + '(...)' : 'nil'];
  for (k = 0; k < h.params.length; k++) args.push(h.params[k]);
  toks = tokenize('return ' + nm.x + '(' + args.join(', ') + ') end');
  return { header: T.slice(i, h.close + 1), call: toks, end: e };
}

// Locates the parameter list of the function starting at T[i].
function fnHeader(T, i) {
  var k = i + 1, open = -1, close = -1, method = false, params = [], vararg = false, j;
  for (; T[k]; k++) {
    if (isSym(T[k], '(')) { open = k; break; }
    if (isSym(T[k], ':')) method = true;
  }
  if (open < 0) return null;
  for (j = open + 1; T[j]; j++) {
    if (isSym(T[j], ')')) { close = j; break; }
    if (T[j][0] === 'ID') params.push(T[j][1]);
    else if (isSym(T[j], '...')) vararg = true;
  }
  if (close < 0) return null;
  if (method) params.unshift('self');
  return { open: open, close: close, params: params, vararg: vararg };
}

// Checksum of the mapped bytecode, the frame size M, the parameter count np and the constant pool (r26).
// The interpreter recomputes exactly this value from its own tables: bytecode values, then the constant count,
// then each constant as (type tag, byte length, bytes). Numbers are hashed as string.format("%.17g", v).
// ES3 style, no Node-only APIs (the engine also runs in the browser).
function vmChecksum(code, ids, consts, M, np) {
  var MOD = 2147483647, s = 0, i, v, items, k, it, j;
  for (i = 0; i < code.length; i++) {
    v = (i % 4 === 0) ? ids[code[i]] : code[i];
    s = (s * 31 + v) % MOD;
  }
  s = (s * 31 + M) % MOD;
  s = (s * 31 + np) % MOD;
  items = vmConstItems(consts || []);
  s = (s * 31 + items.length) % MOD;
  for (k = 0; k < items.length; k++) {
    it = items[k];
    if (it.t === 'b') { s = (s * 31 + (it.v ? 4 : 5)) % MOD; continue; }
    s = (s * 31 + (it.t === 'n' ? 2 : 1)) % MOD;
    s = (s * 31 + it.b.length) % MOD;
    for (j = 0; j < it.b.length; j++) s = (s * 31 + it.b[j]) % MOD;
  }
  return s;
}

// Canonical constant items for the checksum. Unsupported literals throw, which makes the function a clean skip.
function vmConstItems(consts) {
  var out = [], k, tk;
  for (k = 0; k < consts.length; k++) {
    tk = consts[k];
    if (tk[0] === 'NUM') out.push({ t: 'n', b: vmAsciiBytes(vmFmtG17(vmNumValue(tk[1]))) });
    else if (tk[0] === 'STR') out.push({ t: 's', b: vmLitBytes(tk[1]) });
    else if (tk[0] === 'LSTR') out.push({ t: 's', b: vmLongBytes(tk[1], tk[2]) });
    else if (tk[0] === 'KW' && (tk[1] === 'true' || tk[1] === 'false')) out.push({ t: 'b', v: tk[1] === 'true' });
    else vmFail('unsupported constant ' + tk[0]);
  }
  return out;
}

function vmAsciiBytes(str) {
  var out = [], i;
  for (i = 0; i < str.length; i++) out.push(str.charCodeAt(i));
  return out;
}

function vmUtf8Bytes(cp, out) {
  if (cp < 0x80) out.push(cp);
  else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
  else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  return out;
}

// UTF-16 text -> UTF-8 bytes (the bytes the generated Lua source carries).
function vmStrBytes(str, out) {
  var i, c, d;
  for (i = 0; i < str.length; i++) {
    c = str.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
      d = str.charCodeAt(i + 1);
      if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
    }
    vmUtf8Bytes(c, out);
  }
  return out;
}

var VM_STR_ESC = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '"': 34, "'": 39 };

// Bytes of a quoted Lua string literal (token text including its quotes). Decodes the escapes Lua 5.1/Luau allow.
function vmLitBytes(lit) {
  var s = lit.slice(1, -1), out = [], i = 0, j, e, m, n, digits, cp;
  while (i < s.length) {
    j = s.indexOf('\\', i);
    if (j < 0) j = s.length;
    vmStrBytes(s.slice(i, j), out);
    i = j;
    if (i >= s.length) break;
    e = s.charAt(i + 1);
    i += 2;
    if (has(VM_STR_ESC, e)) out.push(VM_STR_ESC[e]);
    else if (e === '\n') out.push(10);
    else if (e === '\r') { out.push(10); if (s.charAt(i) === '\n') i++; }
    else if (e >= '0' && e <= '9') {
      digits = e;
      while (digits.length < 3 && s.charAt(i) >= '0' && s.charAt(i) <= '9') { digits += s.charAt(i); i++; }
      n = +digits;
      if (n > 255) vmFail('decimal escape out of range');
      out.push(n);
    }
    else if (e === 'x') {
      m = s.substr(i, 2);
      if (!/^[0-9a-fA-F]{2}$/.test(m)) vmFail('bad hex escape');
      out.push(parseInt(m, 16));
      i += 2;
    }
    else if (e === 'z') { while (i < s.length && /\s/.test(s.charAt(i))) i++; }
    else if (e === 'u') {
      m = /^\{([0-9a-fA-F]+)\}/.exec(s.slice(i));
      if (!m) vmFail('bad unicode escape');
      cp = parseInt(m[1], 16);
      if (cp >= 0x110000) vmFail('unicode escape out of range');
      vmUtf8Bytes(cp, out);
      i += m[0].length;
    }
    else vmFail('unsupported escape');
  }
  return out;
}

// Bytes of a long-bracket string token [==[ ... ]==]. The first newline directly after the opening bracket is skipped.
function vmLongBytes(lit, eq) {
  var body = lit.slice(eq.length + 2, lit.length - eq.length - 2);
  if (body.slice(0, 2) === '\r\n' || body.slice(0, 2) === '\n\r') body = body.slice(2);
  else if (body.charAt(0) === '\n' || body.charAt(0) === '\r') body = body.slice(1);
  return vmStrBytes(body, []);
}

// Value of a Lua numeric literal token (underscores allowed, as in Luau).
function vmNumValue(text) {
  var t = text.replace(/_/g, ''), v, i;
  if (/^0[xX]/.test(t)) { v = 0; for (i = 2; i < t.length; i++) v = v * 16 + parseInt(t.charAt(i), 16); }
  else if (/^0[bB]/.test(t)) { v = 0; for (i = 2; i < t.length; i++) v = v * 2 + (t.charAt(i) === '1' ? 1 : 0); }
  else v = Number(t);
  if (v !== v) vmFail('bad number ' + text);
  return v;
}

// Same text as C printf("%.17g") (what Lua's string.format("%.17g", v) produces).
function vmFmtG17(v) {
  var e, mant, X, digits, out, md, ms, frac, neg, z;
  if (v !== v) return 'nan';
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  if (v === 0) return (1 / v < 0) ? '-0' : '0';
  neg = v < 0;
  if (neg) v = -v;
  e = v.toExponential(16);
  mant = e.split('e')[0];
  X = parseInt(e.split('e')[1], 10);
  digits = mant.split('.').join('');
  if (X < -4 || X >= 17) {
    md = digits.replace(/0+$/, '');
    ms = md.length > 1 ? md.charAt(0) + '.' + md.slice(1) : md;
    out = ms + 'e' + (X < 0 ? '-' : '+') + (Math.abs(X) < 10 ? '0' : '') + Math.abs(X);
  } else if (X >= 0) {
    frac = digits.slice(X + 1).replace(/0+$/, '');
    out = digits.slice(0, X + 1) + (frac ? '.' + frac : '');
  } else {
    z = ''; for (var k = 0; k < -X - 1; k++) z += '0';
    frac = (z + digits).replace(/0+$/, '');
    out = '0' + (frac ? '.' + frac : '');
  }
  return (neg ? '-' : '') + out;
}

// r26 verifier snippets. ES3 only: no Object.keys, no Array.prototype.map/forEach/indexOf, no let/const, no arrows.
// The file is part of the shipped engine text, so every helper here runs in the browser too.
//
// Record: { code, consts, digest, M, np }
//   np  number of parameters. The call protocol fills registers 1..np before the first instruction.
//   M   frame size declared by the compiler. It must equal the bound derived from the code and np (see vmRegBound).
//
// Operand kinds per opcode (VM_SPEC), one table for the build side and the Lua verifier.
//   r register (1 <= r)           k constant index (1 <= k <= #K)     s constant index that must be a string
//   t jump target: instruction start, 1 <= t <= #C + 1               n non-negative count
//   d closure record index        - unused
// Fourth character: implicit register extent (S = a+1, F = a+3, B = a+b, P = a+b+1, R = a+b-1, - none).
var VM_SPEC = {
  MOVE: 'rr--', LOADK: 'rk--', LOADNIL: 'r---', GETG: 'rs--', SETG: 'rs--', GETT: 'rrr-', SETT: 'rrr-',
  SELF: 'rrsS', TABLE: 'r---', ADD: 'rrr-', SUB: 'rrr-', MUL: 'rrr-', DIV: 'rrr-', IDIV: 'rrr-', MOD: 'rrr-',
  POW: 'rrr-', CONCAT: 'rrr-', EQ: 'rrr-', LT: 'rrr-', LE: 'rrr-', UNM: 'rr--', NOT: 'rr--', LEN: 'rr--',
  JMP: 't---', JF: 'rt--', JT: 'rt--', CALL: 'rn-B', CALLP: 'rn-B', CALLM: 'rn-P', CALLMP: 'rn-P',
  RETN: 'rn-R', RETM: 'rn-R', RET0: '----', FORPREP: 'r-tF', FORSTEP: 'rt-F', APPEND: 'rrn-', SETALL: 'rr--',
  VARG: 'r---', VARGP: 'r---', CLOSURE: 'rdn-'
};

// Register reads and writes, derived from the interpreter (vmInterp). Readable form; the Lua side gets the
// numeric encoding built by vmFlowTableLua.
//   rd   operands read on every path: 'a', 'b', 'c'
//   range  registers read in [a + lo, a + hi + (b if bu)], inclusive (bu = 1 when the upper end is a + b + hi)
//   wf   registers written on the fall-through edge, as offsets from a
//   wj   registers written on the jump edge, as offsets from a
//   tj   operand that holds the jump target; ft false when the instruction never falls through
var VM_FLOW = {
  MOVE: { rd: ['b'], wf: [0] },
  LOADK: { wf: [0] },
  LOADNIL: { wf: [0] },
  GETG: { wf: [0] },
  SETG: { rd: ['a'] },
  GETT: { rd: ['b', 'c'], wf: [0] },
  SETT: { rd: ['a', 'b', 'c'] },
  SELF: { rd: ['b'], wf: [0, 1] },
  TABLE: { wf: [0] },
  ADD: { rd: ['b', 'c'], wf: [0] },
  SUB: { rd: ['b', 'c'], wf: [0] },
  MUL: { rd: ['b', 'c'], wf: [0] },
  DIV: { rd: ['b', 'c'], wf: [0] },
  IDIV: { rd: ['b', 'c'], wf: [0] },
  MOD: { rd: ['b', 'c'], wf: [0] },
  POW: { rd: ['b', 'c'], wf: [0] },
  CONCAT: { rd: ['b', 'c'], wf: [0] },
  EQ: { rd: ['b', 'c'], wf: [0] },
  LT: { rd: ['b', 'c'], wf: [0] },
  LE: { rd: ['b', 'c'], wf: [0] },
  UNM: { rd: ['b'], wf: [0] },
  NOT: { rd: ['b'], wf: [0] },
  LEN: { rd: ['b'], wf: [0] },
  JMP: { ft: false, tj: 'a' },
  JF: { rd: ['a'], tj: 'b' },
  JT: { rd: ['a'], tj: 'b' },
  CALL: { rd: ['a'], range: { lo: 1, hi: 0, bu: 1 }, wf: [0] },
  CALLP: { rd: ['a'], range: { lo: 1, hi: 0, bu: 1 }, wf: [0] },
  CALLM: { rd: ['a'], range: { lo: 1, hi: 1, bu: 1 }, wf: [0] },
  CALLMP: { rd: ['a'], range: { lo: 1, hi: 1, bu: 1 }, wf: [0] },
  RETN: { range: { lo: 0, hi: -1, bu: 1 }, ft: false },
  RETM: { range: { lo: 0, hi: -1, bu: 1 }, ft: false },
  RET0: { ft: false },
  SETALL: { rd: ['b'], wf: [0] },
  APPEND: { rd: ['a', 'b'] },
  CLOSURE: { wf: [0] },
  VARG: { wf: [0] },
  VARGP: { wf: [0] },
  FORPREP: { range: { lo: 0, hi: 2, bu: 0 }, wf: [3], tj: 'c' },
  FORSTEP: { range: { lo: 0, hi: 2, bu: 0 }, wf: [0], tj: 'b', wj: [0, 3] }
};

// Smallest frame size consistent with the code: the parameters, plus every register an operand or implicit extent names.
function vmRegBound(code, np) {
  var M = np > 1 ? np : 1, p, sp, vals, j, ext, top, a, b;
  for (p = 0; p < code.length; p += 4) {
    if (!has(VM_SPEC, code[p])) vmFail('unknown opcode in register bound');
    sp = VM_SPEC[code[p]];
    vals = [code[p + 1], code[p + 2], code[p + 3]];
    for (j = 0; j < 3; j++) if (sp.charAt(j) === 'r' && vals[j] > M) M = vals[j];
    a = vals[0]; b = vals[1]; top = null;
    ext = sp.charAt(3);
    if (ext === 'S') top = a + 1;
    else if (ext === 'F') top = a + 3;
    else if (ext === 'B') top = a + b;
    else if (ext === 'P') top = a + b + 1;
    else if (ext === 'R') top = a + b - 1;
    if (top !== null && top > M) M = top;
  }
  return M;
}

// Numeric operand table for the Lua verifier: one row per opcode id, {kind1, kind2, kind3, extent}.
// Kinds: 0 unused, 1 register, 2 constant index, 3 string constant, 4 jump target, 5 count, 6 closure record.
// Extents: 0 none, 1 a+1, 2 a+3, 3 a+b, 4 a+b+1, 5 a+b-1. Numbers only: string literals are costly in the output.
var VM_KIND = { '-': 0, 'r': 1, 'k': 2, 's': 3, 't': 4, 'n': 5, 'd': 6 };
var VM_EXT = { '-': 0, 'S': 1, 'F': 2, 'B': 3, 'P': 4, 'R': 5 };
// True when the ids of the given names are exactly 1..N (N = number of names), each used once (see verifierCompact).
function vmIdsDense(ids, names) {
  var i, seen = {}, m = 0;
  for (i = 0; i < names.length; i++) {
    if (!has(ids, names[i])) return false;
    if (seen[ids[names[i]]]) return false;
    seen[ids[names[i]]] = true;
    if (ids[names[i]] > m) m = ids[names[i]];
  }
  if (m !== names.length) return false;
  for (i = 1; i <= m; i++) if (!seen[i]) return false;
  return true;
}
function vmSpecLua(ids) {
  var rows = [], parts = [], i, name, sp, specNames = [], k;
  for (k in VM_SPEC) if (has(VM_SPEC, k)) specNames.push(k);
  var pos = vmIdsDense(ids, specNames);
  for (i = 0; i < specNames.length; i++) {
    name = specNames[i];
    sp = VM_SPEC[name];
    rows[ids[name]] = '{' + VM_KIND[sp.charAt(0)] + ',' + VM_KIND[sp.charAt(1)] + ',' + VM_KIND[sp.charAt(2)] + ',' + VM_EXT[sp.charAt(3)] + '}';
  }
  for (i = 1; i < rows.length; i++) if (rows[i] !== undefined) parts.push((pos ? '' : '[' + i + ']=') + rows[i]);
  return '{' + parts.join(',') + '}';
}

// Numeric flow table for the Lua verifier, one row per opcode id:
//   { readMask, fallWriteMask, jumpWriteMask, targetOperand, fallsThrough, rangeLo, rangeHi, rangeBU }
// readMask: 1 = a, 2 = b, 4 = c.  writeMask: 1 = a, 2 = a+1, 4 = a+3.  targetOperand: 0 none, 1 a, 2 b, 3 c.
// rangeBU is -1 when there is no range. The Lua decoder (vmFlowLua) reads only these rows.
function vmFlowTableLua(ids) {
  var rows = [], parts = [], i, name, spec, rm, fm, jm, t, rb, k, x, pos = vmIdsDense(ids, VM_OPS);
  for (i = 0; i < VM_OPS.length; i++) {
    name = VM_OPS[i];
    if (!has(VM_FLOW, name)) vmFail('no flow rule for ' + name);
    spec = VM_FLOW[name];
    rm = 0;
    for (k = 0; spec.rd && k < spec.rd.length; k++) {
      x = spec.rd[k];
      rm += x === 'a' ? 1 : x === 'b' ? 2 : 4;
    }
    fm = 0;
    for (k = 0; spec.wf && k < spec.wf.length; k++) fm += spec.wf[k] === 0 ? 1 : spec.wf[k] === 1 ? 2 : 4;
    jm = 0;
    for (k = 0; spec.wj && k < spec.wj.length; k++) jm += spec.wj[k] === 0 ? 1 : spec.wj[k] === 1 ? 2 : 4;
    t = spec.tj === undefined ? 0 : spec.tj === 'a' ? 1 : spec.tj === 'b' ? 2 : 3;
    if (spec.range && spec.range.lo > 3) vmFail('range offset');
    rb = spec.range ? spec.range.bu : -1;
    rows[ids[name]] = '{' + rm + ',' + fm + ',' + jm + ',' + t + ',' + (spec.ft === false ? 0 : 1) + ',' +
      (spec.range ? spec.range.lo : 0) + ',' + (spec.range ? spec.range.hi : 0) + ',' + rb + '}';
  }
  for (i = 1; i < rows.length; i++) if (rows[i] !== undefined) parts.push((pos ? '' : '[' + i + ']=') + rows[i]);
  return '{' + parts.join(',') + '}';
}

// Error codes returned by the verifier as "vm:<code>". The names are for readers and for the tests.
var VM_ERR = [
  '', 'malformed bytecode', 'malformed operand', 'register out of range', 'constant index out of range',
  'string constant expected', 'invalid jump target', 'negative count', 'invalid closure record',
  'register bound mismatch', 'register bound too large', 'malformed record', 'record has a metatable',
  'malformed register bound', 'integrity check failed', 'control falls off the end', 'register read before write',
  'invalid opcode'
];
function vmErrCode(name) {
  var k;
  for (k = 1; k < VM_ERR.length; k++) if (VM_ERR[k] === name) return k;
  vmFail('unknown verifier error ' + name);
}

// Lua verifier. Placeholders: @K@ = alias of built-in K (captured local, or the global itself),
// {{NAME}} = chunk-local name of a verifier function. Returns Lua text only.
//
// Order inside NN: shape, metatables, digest, structure, flow. The digest comes first so a stale record fails cheaply.
// Structure derives the frame size and checks every operand. Flow is a definite-assignment analysis over the control
// flow graph: no register may be read on a path where it was not written (parameters count as written at entry).
function vmVerifierLua(nm, ids, flags) {
  var X = nm.x, base = {}, al = {}, keys = ['E', 'T', 'F', 'B', 'S', 'M', 'W', 'U', 'L', 'A', 'G', 'P'], names = {}, lines = [], text, i, k;
  var E = function (name) { return '@E@("vm:' + vmErrCode(name) + '")'; };
  base.E = 'error'; base.T = 'type'; base.F = 'string.format'; base.B = 'string.byte'; base.S = 'tostring';
  base.M = 'math.floor'; base.W = 'setmetatable'; base.U = 'string.sub'; base.L = 'rawlen'; base.A = 'rawget';
  base.G = 'getmetatable'; base.P = 'pairs';
  for (i = 0; i < keys.length; i++) {
    k = keys[i];
    al[k] = flags.capture ? X + 'g' + k : base[k];
  }
  names.VN = X + 'V'; names.QN = X + 'Q'; names.NN = X + 'N'; names.WN = X + 'W'; names.SP = X + 'S';
  names.FL = X + 'L'; names.ST = X + 'Z'; names.FN = X + 'Y';

  if (flags.capture) {
    var capL = [], capR = [];
    for (i = 0; i < keys.length; i++) { capL.push(al[keys[i]]); capR.push(base[keys[i]]); }
    lines.push('local ' + capL.join(', ') + ' = ' + capR.join(', '));
  }

  lines.push('local {{WN}} = @W@({}, {__mode = "k"})');
  if (flags.validate) lines.push('local {{SP}} = ' + vmSpecLua(ids));

  // digest: code values, M, np, #K, then the constants (same order as vmChecksum in checksum26.js)
  lines.push([
    'local function {{VN}}(C, K, M, np, n, nk)',
    '  if @T@(M) ~= "number" or @T@(np) ~= "number" then return nil end',
    '  local s = 0',
    '  for i = 1, n do local v = @A@(C, i); if @T@(v) ~= "number" then return nil end; s = (s * 31 + v) % 2147483647 end',
    '  s = (s * 31 + M) % 2147483647',
    '  s = (s * 31 + np) % 2147483647',
    '  s = (s * 31 + nk) % 2147483647',
    '  for i = 1, nk do',
    '    local v = @A@(K, i)',
    '    if @T@(v) == "string" then',
    '      s = (s * 31 + 1) % 2147483647',
    '      s = (s * 31 + #v) % 2147483647',
    '      for j = 1, #v do s = (s * 31 + @B@(v, j)) % 2147483647 end',
    '    elseif @T@(v) == "number" then',
    '      local t = @F@("%.17g", v)',
    '      s = (s * 31 + 2) % 2147483647',
    '      s = (s * 31 + #t) % 2147483647',
    '      for j = 1, #t do s = (s * 31 + @B@(t, j)) % 2147483647 end',
    '    elseif v == true then s = (s * 31 + 4) % 2147483647',
    '    elseif v == false then s = (s * 31 + 5) % 2147483647',
    '    else return nil end',
    '  end',
    '  return s',
    'end'
  ].join('\n'));

  // structure: operand kinds, jump targets, closure records, and the frame size derived from the code
  if (flags.validate) lines.push([
    'local function {{QN}}(C, K, n, M, np)',
    '  if n < 4 or n % 4 ~= 0 then ' + E('malformed bytecode') + ' end',
    '  local nk = @L@(K)',
    '  local bound = np',
    '  if bound < 1 then bound = 1 end',
    '  for p = 1, n, 4 do',
    '    local op = @A@(C, p)',
    '    local sp = {{SP}}[op]',
    '    if sp == nil then ' + E('invalid opcode') + ' end',
    '    local a, b, c = @A@(C, p + 1), @A@(C, p + 2), @A@(C, p + 3)',
    '    local vals = {a, b, c}',
    '    for j = 1, 3 do',
    '      local kind = sp[j]',
    '      local v = vals[j]',
    '      if kind ~= 0 then',
    '        if @T@(v) ~= "number" or v ~= v or v > 2147483647 or v < -2147483647 or v ~= @M@(v) then ' + E('malformed operand') + ' end',
    '        if kind == 1 then',
    '          if v < 1 then ' + E('register out of range') + ' end',
    '          if v > bound then bound = v end',
    '        elseif kind == 2 then if v < 1 or v > nk then ' + E('constant index out of range') + ' end',
    '        elseif kind == 3 then if v < 1 or v > nk or @T@(@A@(K, v)) ~= "string" then ' + E('string constant expected') + ' end',
    '        elseif kind == 4 then if v < 1 or v > n + 1 or (v - 1) % 4 ~= 0 then ' + E('invalid jump target') + ' end',
    '        elseif kind == 5 then if v < 0 then ' + E('negative count') + ' end',
    '        elseif kind == 6 then if v < 1 then ' + E('invalid closure record') + ' end',
    '        end',
    '      end',
    '    end',
    '    local ext = sp[4]',
    '    local top = nil',
    '    if ext == 1 then top = a + 1 elseif ext == 2 then top = a + 3 elseif ext == 3 then top = a + b elseif ext == 4 then top = a + b + 1 elseif ext == 5 then top = a + b - 1 end',
    '    if top ~= nil and top > bound then bound = top end',
    '  end',
    '  if M ~= bound then ' + E('register bound mismatch') + ' end',
    // every register above the parameters is written by some instruction, and each instruction writes at most 2
    '  if M > np + n / 2 then ' + E('register bound too large') + ' end',
    'end'
  ].join('\n'));

  // flow: the numeric table, its decoder, and the definite-assignment fixpoint
  if (flags.flow) lines.push('local {{FL}} = ' + vmFlowTableLua(ids));
  if (flags.flow) lines.push([
    'local function {{ST}}(op, a, b, c)',
    '  local f = {{FL}}[op]',
    '  local rd, wf, wj = {}, {}, {}',
    '  local m = f[1]',
    '  if m % 2 == 1 then rd[#rd + 1] = a end',
    '  if m % 4 >= 2 then rd[#rd + 1] = b end',
    '  if m >= 4 then rd[#rd + 1] = c end',
    '  if f[8] >= 0 then',
    '    for r = a + f[6], a + f[7] + (f[8] == 1 and b or 0) do rd[#rd + 1] = r end',
    '  end',
    '  m = f[2]',
    '  if m % 2 == 1 then wf[#wf + 1] = a end',
    '  if m % 4 >= 2 then wf[#wf + 1] = a + 1 end',
    '  if m >= 4 then wf[#wf + 1] = a + 3 end',
    '  m = f[3]',
    '  if m % 2 == 1 then wj[#wj + 1] = a end',
    '  if m % 4 >= 2 then wj[#wj + 1] = a + 1 end',
    '  if m >= 4 then wj[#wj + 1] = a + 3 end',
    '  local tj = nil',
    '  if f[4] == 1 then tj = a elseif f[4] == 2 then tj = b elseif f[4] == 3 then tj = c end',
    '  return rd, wf, wj, tj, f[5] == 1',
    'end'
  ].join('\n'));

  if (flags.flow) lines.push([
    'local function {{FN}}(C, n, np)',
    '  local IN, stk, sp = {}, {}, 0',
    '  local e = {}',
    '  for r = 1, np do e[r] = true end',
    '  IN[1] = e',
    '  sp = 1; stk[1] = 1',
    '  local function prop(t, out)',
    '    if t > n then ' + E('control falls off the end') + ' end',
    '    local cur = IN[t]',
    '    if cur == nil then',
    '      IN[t] = out; sp = sp + 1; stk[sp] = t',
    '    else',
    '      local ch = false',
    '      for r in @P@(cur) do',
    '        if not out[r] then cur[r] = nil; ch = true end',
    '      end',
    '      if ch then sp = sp + 1; stk[sp] = t end',
    '    end',
    '  end',
    '  while sp > 0 do',
    '    local p = stk[sp]; stk[sp] = nil; sp = sp - 1',
    '    local st = IN[p]',
    '    local rd, wf, wj, tj, ft = {{ST}}(@A@(C, p), @A@(C, p + 1), @A@(C, p + 2), @A@(C, p + 3))',
    '    if ft then',
    '      local out = {}',
    '      for r in @P@(st) do out[r] = true end',
    '      for i = 1, #wf do out[wf[i]] = true end',
    '      prop(p + 4, out)',
    '    end',
    '    if tj ~= nil then',
    '      local out = {}',
    '      for r in @P@(st) do out[r] = true end',
    '      for i = 1, #wj do out[wj[i]] = true end',
    '      prop(tj, out)',
    '    end',
    '  end',
    '  for p = 1, n, 4 do',
    '    local st = IN[p]',
    '    if st ~= nil then',
    '      local rd = {{ST}}(@A@(C, p), @A@(C, p + 1), @A@(C, p + 2), @A@(C, p + 3))',
    '      for i = 1, #rd do',
    '        if not st[rd[i]] then ' + E('register read before write') + ' end',
    '      end',
    '    end',
    '  end',
    'end'
  ].join('\n'));

  // entry: record checks, then structure and flow when enabled. cp = true returns private copies (snapshot mode).
  var checks = [];
  checks.push('local function {{NN}}(D, cp)');
  checks.push('  if @T@(D) ~= "table" then ' + E('malformed record') + ' end');
  checks.push('  local C, K, dg, M, np = @A@(D, 1), @A@(D, 2), @A@(D, 3), @A@(D, 4), @A@(D, 5)');
  checks.push('  if @T@(C) ~= "table" or @T@(K) ~= "table" then ' + E('malformed record') + ' end');
  checks.push('  if @G@(D) ~= nil or @G@(C) ~= nil or @G@(K) ~= nil then ' + E('record has a metatable') + ' end');
  checks.push('  if @T@(M) ~= "number" or @T@(np) ~= "number" then ' + E('malformed register bound') + ' end');
  checks.push('  if np < 0 or np ~= @M@(np) or M < 1 or M ~= @M@(M) then ' + E('malformed register bound') + ' end');
  checks.push('  local n, nk = @L@(C), @L@(K)');
  checks.push('  if @L@(D) ~= 5 then ' + E('malformed record') + ' end');
  checks.push('  local kd = 0 for _ in @P@(D) do kd = kd + 1 end if kd ~= 5 then ' + E('malformed record') + ' end');
  checks.push('  local kc, kk = 0, 0 for _ in @P@(C) do kc = kc + 1 end for _ in @P@(K) do kk = kk + 1 end if kc ~= n or kk ~= nk then ' + E('malformed record') + ' end');
  checks.push('  if cp then');
  checks.push('    local c2, k2 = {}, {}');
  checks.push('    for i = 1, n do c2[i] = @A@(C, i) end');
  checks.push('    for i = 1, nk do k2[i] = @A@(K, i) end');
  checks.push('    C, K = c2, k2');
  checks.push('  end');
  checks.push('  if {{VN}}(C, K, M, np, n, nk) ~= dg then ' + E('integrity check failed') + ' end');
  if (flags.validate) checks.push('  {{QN}}(C, K, n, M, np)');
  if (flags.flow) checks.push('  {{FN}}(C, n, np)');
  checks.push('  return C, K');
  checks.push('end');
  lines.push(checks.join('\n'));

  text = lines.join('\n');
  // substitute names first, then built-in aliases
  text = text.replace(/\{\{(\w+)\}\}/g, function (m, key) {
    if (has(names, key)) return names[key];
    throw new Error('unknown verifier name ' + key);
  });
  text = text.replace(/@([A-Z])@/g, function (m, key) {
    if (!has(al, key)) throw new Error('unknown alias ' + key);
    return al[key];
  });
  return text;
}

// Applies the VM layer to a token stream. Returns the rewritten stream.
// Marks tokens so the emitter writes them unchanged (see vmPlainVerifier).
function markPlainTok(tok) {
  tok.plain = true;
  return tok;
}
function markPlain(toks) {
  for (var i = 0; i < toks.length; i++) toks[i].plain = true;
  return toks;
}

// ---------- packed VM record (r30) ----------
// Alphabet for packed record digits: printable characters except double quote and backslash (so they need no escape).
function packAlphabet(rnd) {
  var pool = [], c, i, j, tmp, out = [];
  for (c = 35; c <= 126; c++) if (c !== 92) pool.push(c);
  for (i = pool.length - 1; i > 0; i--) { j = rnd(i + 1); tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp; }
  for (i = 0; i < 90; i++) out.push(String.fromCharCode(pool[i]));
  return out.join('');
}
// Encodes integers as digits 0..89 of the alphabet. Each integer is zigzag mapped, then written base 45 least significant
// digit first; digits 45..89 mark a continuation, 0..44 the final digit. Returns null if any value is not a safe integer.
// With a keystream seed (packedKeyed), digit t is stored as (d + ks) mod 90, where ks steps once per character: ks = (ks*75+74) mod 65537.
function packInts(vals, alph, ks0) {
  var s = [], i, v, z, r, ds, k, ks = ks0, dd;
  for (i = 0; i < vals.length; i++) {
    v = vals[i];
    if (typeof v !== 'number' || v !== Math.floor(v) || Math.abs(v) > 1125899906842624) return null;
    z = v >= 0 ? 2 * v : -2 * v - 1;
    ds = [];
    do { r = z % 45; z = Math.floor(z / 45); ds.push(r); } while (z > 0);
    for (k = 0; k < ds.length; k++) {
      dd = k < ds.length - 1 ? 45 + ds[k] : ds[k];
      if (ks !== null) { ks = (ks * 75 + 74) % 65537; dd = (dd + ks % 90) % 90; }
      s.push(alph.charAt(dd));
    }
  }
  return s.join('');
}

function vmPass(T, rnd, idents) {
  var skips = [], all = {}, i, j, t, out = [], fns = [], r, ids = {}, perm = [], q, s2, tmp, nm, pre, n, k, vmNames = {}, used;

  function freshName(prefix) {
    var nmx, chars = 'abcdefghijklmnopqrstuvwxyz', guard = 0;
    do {
      nmx = prefix;
      for (var z = 0; z < 6; z++) nmx += chars.charAt(rnd(chars.length));
      guard++;
    } while (has(idents, nmx) && guard < 100);
    idents[nmx] = 1;
    return nmx;
  }

  // every name declared as a local anywhere in the chunk
  for (i = 0; i < T.length; i++) {
    t = T[i];
    if (isKw(t, 'local')) {
      j = i + 1;
      if (isKw(T[j], 'function')) {
        if (T[j + 1] && T[j + 1][0] === 'ID') all[T[j + 1][1]] = 1;
        continue;
      }
      while (T[j] && T[j][0] === 'ID') {
        all[T[j][1]] = 1;
        j++;
        if (isSym(T[j], ',')) j++; else break;
      }
    } else if (isKw(t, 'for')) {
      for (j = i + 1; T[j] && !isSym(T[j], '=') && !isKw(T[j], 'in'); j++) {
        if (T[j][0] === 'ID') all[T[j][1]] = 1;
      }
    } else if (isKw(t, 'function')) {
      r = fnHeader(T, i);
      if (r) for (j = 0; j < r.params.length; j++) all[r.params[j]] = 1;
    }
  }

  nm = { d: freshName('Vd'), env: freshName('Ve'), x: freshName('Vx'), u: freshName('Vu'), k: freshName('Vk'), v: freshName('Vv') };

  for (i = 0; i < T.length; ) {
    t = T[i];
    if (isKw(t, 'function')) {
      r = vmTryFunction(T, i, all, nm, function (c) { fns.push(c); return fns.length; });
      if (r && r.skip) skips.push(r.skip);
      if (r && !r.skip) {
        for (k = 0; k < r.header.length; k++) out.push(r.header[k]);
        for (k = 0; k < r.call.length; k++) out.push(r.call[k]);
        i = r.end + 1;
        continue;
      }
    }
    out.push(t);
    i++;
  }

  if (!fns.length) return { toks: T, pre: [], compiled: 0, skips: skips };

  nm.dc = freshName('Vc');
  var ALPH = packAlphabet(rnd);
  // per-build opcode permutation
  for (q = 0; q < VM_OPS.length; q++) perm.push(q + 1);
  for (q = perm.length - 1; q > 0; q--) {
    s2 = rnd(q + 1);
    tmp = perm[q]; perm[q] = perm[s2]; perm[s2] = tmp;
  }
  for (q = 0; q < VM_OPS.length; q++) ids[VM_OPS[q]] = perm[q];

  // data table: VMD[n] = { {bytecode...}, {constant tokens...} }
  var KEYED = true;
  var DECSRC = 'local ' + nm.dc + ' = function(s' + (KEYED ? ', ks' : '') + ')\n' +
    '  local A = "' + ALPH + '"\n' +
    '  local L = {}\n' +
    '  for j = 1, 90 do L[string.byte(A, j)] = j - 1 end\n' +
    '  local out, n, i, len = {}, 0, 1, #s\n' +
    '  while i <= len do\n' +
    '    local v, m = 0, 1\n' +
    '    while true do\n' +
    '      local d = L[string.byte(s, i)]\n' +
    '      if d == nil then error("vm:12") end\n' +
    (KEYED ? '      ks = (ks * 75 + 74) % 65537\n' + '      d = (d - ks % 90) % 90\n' : '') +
    '      i = i + 1\n' +
    '      if d < 45 then\n' +
    '        v = v + d * m\n' +
    '        break\n' +
    '      end\n' +
    '      v = v + (d - 45) * m\n' +
    '      m = m * 45\n' +
    '      if m > 9007199254740992 or i > len then error("vm:12") end\n' +
    '    end\n' +
    '    n = n + 1\n' +
    '    if v % 2 == 0 then out[n] = v / 2 else out[n] = -(v + 1) / 2 end\n' +
    '  end\n' +
    '  return out\n' +
    'end\n';
  pre = markPlain(tokenize(DECSRC));
  pre = pre.concat(tokenize('local ' + nm.d + ' = {'));
  for (n = 0; n < fns.length; n++) {
    var cd = fns[n], cc, cl;
    var pvals = [], pk, ks0;
    for (cc = 0; cc < cd.code.length; cc += 4) pvals.push(ids[cd.code[cc]], cd.code[cc + 1], cd.code[cc + 2], cd.code[cc + 3]);
    ks0 = KEYED ? 1 + rnd(65536) : null;
    pk = packInts(pvals, ALPH, ks0);
    if (pk !== null) {
      pre.push(['SYM', '{']);
      pre = pre.concat(tokenize(nm.dc + '('));
      pre.push(markPlainTok(tokenize('"' + pk + '"')[0]));
      if (KEYED) pre = pre.concat(tokenize(',' + ks0));
      pre.push(['SYM', ')'], ['SYM', ',']);
    } else {
    pre.push(['SYM', '{'], ['SYM', '{']);
    for (cc = 0; cc < cd.code.length; cc += 4) {
      pre.push(['NUM', String(ids[cd.code[cc]])], ['SYM', ',']);
      pre.push(['NUM', String(cd.code[cc + 1])], ['SYM', ',']);
      pre.push(['NUM', String(cd.code[cc + 2])], ['SYM', ',']);
      pre.push(['NUM', String(cd.code[cc + 3])], ['SYM', ',']);
    }
    pre.push(['SYM', '}'], ['SYM', ',']);
    }
    pre.push(['SYM', '{']);
    for (cl = 0; cl < cd.consts.length; cl++) pre.push(cd.consts[cl], ['SYM', ',']);
    pre.push(['SYM', '}'], ['SYM', ','], ['NUM', String(vmChecksum(cd.code, ids, cd.consts, vmRegBound(cd.code, cd.np), cd.np))], ['SYM', ','], ['NUM', String(vmRegBound(cd.code, cd.np))], ['SYM', ','], ['NUM', String(cd.np)], ['SYM', ','], ['SYM', '}'], ['SYM', ',']);
  }
  pre.push(['SYM', '}']);
  pre = pre.concat(tokenize('local ' + nm.env + ' = (getgenv and getgenv()) or _G'));
  pre = pre.concat(tokenize('local ' + nm.k + ' = function(...) return {n = select("#", ...), ...} end'));
  pre = pre.concat(tokenize('local ' + nm.v + ' = function(np, ...) return {n = math.max(select("#", ...) - np, 0), select(np + 1, ...)} end'));
  pre = pre.concat(markPlain(tokenize(vmInterp(ids, nm))));
  return { toks: out, pre: pre, compiled: fns.length, skips: skips };
}

// ---------- main ----------
// Error for input the single-line formatter does not rewrite safely. The message says what
// to change; the caller never receives multiline output in place of a failed single-line build.
function slRefuse(detail) {
  return new Error('single-line output refused: ' + detail + '. Remove or rewrite that construct, or turn singleLine off to keep the multiline output.');
}
// Long-bracket opener [=*[ starting at i, as [text, equals]; null if none. ES3-compatible (no sticky regex).
function longOpenAt(src, i) {
  var j = i;
  if (src.charAt(j) !== '[') return null;
  j++;
  while (src.charAt(j) === '=') j++;
  if (src.charAt(j) !== '[') return null;
  return [src.slice(i, j + 1), src.slice(i + 1, j)];
}
// Formatting only: joins the generated Lua onto one physical line. The text is walked with
// Lua's lexical rules. Only whitespace runs that contain a line break, comments, and line
// breaks inside string literals change, and each of those changes keeps the same value.
// Malformed input and constructs this formatter cannot rewrite safely throw instead of
// producing altered output, so a successful result never contains a raw LF or CR.
function quoteLuaString(s) {
  var r = '"', k, ch, code;
  for (k = 0; k < s.length; k++) {
    ch = s.charAt(k); code = s.charCodeAt(k);
    if (ch === '\\') r += '\\\\';
    else if (ch === '"') r += '\\"';
    else if (ch === '\n') r += '\\n';
    else if (ch === '\r') r += '\\r';
    else if (code < 32 || code === 127) r += '\\' + ('00' + code).slice(-3);
    else r += ch;
  }
  return r + '"';
}
function toSingleLine(src) {
  var WS = ' \t\r\n\v\f';
  var out = '', i = 0, j, k, n = src.length, c, ch, nx, m, close, raw, body, end, run, depth, q;
  if (src.charAt(0) === '#') throw slRefuse('a leading shebang line is not supported');
  if (src.indexOf('\0') >= 0) throw slRefuse('raw NUL bytes are not supported');
  while (i < n) {
    c = src.charAt(i);
    if (c === '"' || c === "'") {
      out += c; j = i + 1;
      for (;;) {
        if (j >= n) throw slRefuse('unterminated string literal at offset ' + i);
        ch = src.charAt(j);
        if (ch === c) { out += c; j++; break; }
        if (ch === '\n' || ch === '\r') throw slRefuse('raw line break inside a quoted string at offset ' + j);
        if (ch === '\\') {
          nx = src.charAt(j + 1);
          if (nx === '') throw slRefuse('unterminated string literal at offset ' + i);
          if (nx === '\r') { out += '\\n'; j += src.charAt(j + 2) === '\n' ? 3 : 2; continue; }
          if (nx === '\n') { out += '\\n'; j += src.charAt(j + 2) === '\r' ? 3 : 2; continue; }
          if (nx === 'z') {
            out += '\\z'; j += 2;
            while (j < n && WS.indexOf(src.charAt(j)) >= 0) j++;
            continue;
          }
          out += ch + nx; j += 2; continue;
        }
        out += ch; j++;
      }
      i = j; continue;
    }
    if (c === '[') {
      m = longOpenAt(src, i);
      if (m) {
        close = ']' + m[1] + ']';
        j = src.indexOf(close, i + m[0].length);
        if (j < 0) throw slRefuse('unterminated long string at offset ' + i);
        raw = src.slice(i + m[0].length, j);
        end = j + close.length;
        if (!/[\r\n]/.test(raw)) { out += src.slice(i, end); }
        else {
          body = raw.replace(/\r\n/g, '\n');
          if (body.charAt(0) === '\n') body = body.slice(1);
          out += quoteLuaString(body);
        }
        i = end; continue;
      }
    }
    if (c === '`') {
      // Interpolated string. Text segments may not contain line breaks. Inside {...} the
      // expression is scanned conservatively: quoted strings are copied, and nested
      // backtick strings, long brackets, and comments inside braces are refused.
      j = i + 1; depth = 0;
      for (;;) {
        if (j >= n) throw slRefuse('unterminated interpolated string at offset ' + i);
        ch = src.charAt(j);
        if (depth === 0) {
          if (ch === '`') break;
          if (ch === '\n' || ch === '\r') throw slRefuse('interpolated string spans lines (not supported) at offset ' + j);
          if (ch === '\\') {
            nx = src.charAt(j + 1);
            if (nx === '\n' || nx === '\r') throw slRefuse('interpolated string spans lines (not supported) at offset ' + j);
            j += 2; continue;
          }
          if (ch === '{') depth = 1;
          j++; continue;
        }
        if (ch === '\n' || ch === '\r') throw slRefuse('line break inside an interpolation at offset ' + j);
        if (ch === '"' || ch === "'") {
          q = ch; j++;
          for (;;) {
            if (j >= n) throw slRefuse('unterminated string in interpolation at offset ' + j);
            ch = src.charAt(j);
            if (ch === q) { j++; break; }
            if (ch === '\n' || ch === '\r') throw slRefuse('raw line break inside an interpolation at offset ' + j);
            j += ch === '\\' ? 2 : 1;
          }
          continue;
        }
        if (ch === '`') throw slRefuse('nested interpolated string (not supported) at offset ' + j);
        if (ch === '[' && /^\[=*\[/.test(src.slice(j, j + 64))) throw slRefuse('long bracket inside an interpolation (not supported) at offset ' + j);
        if (ch === '-' && src.charAt(j + 1) === '-') throw slRefuse('comment inside an interpolation (not supported) at offset ' + j);
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        j++;
      }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '-' && src.charAt(i + 1) === '-') {
      m = longOpenAt(src, i + 2);
      if (m) {
        close = ']' + m[1] + ']';
        j = src.indexOf(close, i + 2 + m[0].length);
        if (j < 0) throw slRefuse('unterminated long comment at offset ' + i);
        out += ' '; i = j + close.length; continue;
      }
      j = i + 2;
      while (j < n && src.charAt(j) !== '\n' && src.charAt(j) !== '\r') j++;
      out += ' '; i = j; continue;
    }
    if (WS.indexOf(c) >= 0) {
      j = i;
      while (j < n && WS.indexOf(src.charAt(j)) >= 0) j++;
      run = src.slice(i, j);
      out += /[\r\n]/.test(run) ? ' ' : run;
      i = j; continue;
    }
    out += c; i++;
  }
  return out;
}

function obfuscate(src, seed, opts) {
  opts = opts || {};
  var profile = String(opts.profile || 'medium').toLowerCase();
  if (profile !== 'light' && profile !== 'medium' && profile !== 'heavy' && profile !== 'maximum') profile = 'medium';
  var density = +opts.density;
  if (!(density >= 0 && density <= 1)) {
    density = profile === 'light' ? 0.35 : profile === 'heavy' ? 0.9 : profile === 'maximum' ? 1 : 0.6;
  }

  var doRename   = opts.rename !== false;
  var doStrings  = opts.strings !== false;
  var doNumbers  = opts.numbers !== false;
  var doAnti     = opts.antitamper !== false && opts.antiDebug !== false;
  var doJunk     = opts.junk !== false;
  var doOpaque   = opts.opaque !== false;
  var doMba      = opts.mba !== false;
  var doCff      = opts.cff !== false;

  var doHideEnv  = opts.hideEnv !== false;
  var doDelayStr = opts.delayStrings === true;
  var doVm       = opts.vm === true || (profile === 'maximum' && opts.vm !== false);  // maximum turns the VM layer on   // opt-in: nested thunks break on some executors
  if (profile === 'light') {
    if (opts.junk !== true)   doJunk = false;
    if (opts.opaque !== true) doOpaque = false;
    if (opts.mba !== true)    doMba = false;
    if (opts.cff !== true)    doCff = false;
  }

  // ---------- binding ----------
  var bindPlace = Math.floor(+opts.place) || 0;
  var bindUser  = Math.floor(+opts.user) || 0;
  if (bindPlace < 0) bindPlace = 0;
  if (bindUser < 0) bindUser = 0;
  var bound = bindPlace > 0 || bindUser > 0;
  var RP = bindPlace % 251;
  var RU = bindUser > 0 ? bindUser % 251 : -1;
  var SALT = bound ? ((RP + (bindUser > 0 ? (bindUser * 13) % 251 : 0)) % 256) : 0;

  // ---------- PRNG ----------
  var rngState = (seed >>> 0) || 1;
  function rnd(n) {
    rngState = (rngState * 1664525 + 1013904223) % 4294967296;
    var r = rngState / 4294967296;
    return n === undefined ? r : Math.floor(r * n);
  }
  var KCHAIN = [], ci;
  for (ci = 0; ci < 64; ci++) KCHAIN.push(1 + rnd(255));

  // ---------- prefix / internal names ----------
  var idents = {}, idre = /[A-Za-z_][A-Za-z0-9_]*/g, mm, kk, guard, hasPre;
  while ((mm = idre.exec(src)) !== null) idents[mm[0]] = 1;
  function pickPrefix(len) {
    var s = '_', i;
    for (i = 0; i < len; i++) s += ALPHA_L.charAt(rnd(26));
    return s;
  }
  var PREFIX = pickPrefix(3);
  for (guard = 0; guard < 40; guard++) {
    hasPre = false;
    for (kk in idents) {
      if (has(idents, kk) && kk.substring(0, PREFIX.length) === PREFIX) { hasPre = true; break; }
    }
    if (!hasPre) break;
    PREFIX = pickPrefix(3 + (guard >> 3));
  }
  // Renamed locals are PREFIX + lowercase base36. Every other internal name uses
  // PREFIX + an uppercase tag, so the two families can never collide.
  var UCTR = 0;
  function inm(tag) {
    return PREFIX + tag + ALPHA_U.charAt(rnd(26)) + ALPHA_U.charAt(rnd(26)) + (UCTR++).toString(36).toUpperCase();
  }
  // Per-build names for locals inside the runtime templates (decoders, helpers).
  var LNMAP = {};
  function ln(n) { if (!has(LNMAP, n)) LNMAP[n] = inm('L'); return LNMAP[n]; }
  function tpl(str) { return str.replace(/@(\w+)@/g, function (m, n) { return ln(n); }); }
  var KN     = PREFIX + 'K';       // runtime key (anti-tamper adjusted)
  var ENVFN  = inm('F');           // env resolver
  var FBN    = inm('G');           // fallback table of the hidden globals (see env resolver)
  var CHN    = inm('C');           // packed KCHAIN string
  var BXN    = inm('X');           // xor helper
  var KYN    = inm('Y');           // key derivation helper
  var POOLPFX = PREFIX + 'Q';      // placeholder prefix (digits follow)

  // ---------- emitter state ----------
  var T = null, POS = 0, OUT = [], SCOPES = [{}], BRACE = 0, COUNTER = 0, PREV = '';
  var BASE = 0, BASEST = [], POOL = [], STRIDX = 0, envUsed = {}, envOrder = [];
  var stats = { decls: 0, renamed: 0, str_enc: 0, str_plain: 0, num_mangled: 0,
    env_enc: 0, junk: 0, decoys: 0, opaque: 0, cff_fns: 0 };
  var pool = null;
  var curKey = 1;   // per-function arithmetic key, reset at each function body

  function emit(s) { OUT.push(s); PREV = s; }
  function peek() { return POS < T.length ? T[POS] : [null, null]; }
  function nxt() { return T[POS++]; }
  function ctx() {
    var s = '@' + (BASE + POS) + ':', i;
    for (i = 0; i < 6 && POS + i < T.length; i++) s += ' [' + T[POS + i][1] + ']';
    return s;
  }
  function fail(m) { throw new Error('parse: ' + m + ctx()); }
  function track(t) { if (t === '{') BRACE++; else if (t === '}') BRACE--; }
  function expect(v) {
    var tk = nxt();
    if (tk[1] !== v) fail('expected ' + v + ' got ' + tk[1]);
    emit(tk[1]); track(tk[1]);
  }
  function push() { SCOPES.push({}); }
  function pop() { SCOPES.pop(); }

  function newName(name) {
    if (!doRename || has(NEVER, name)) return name;
    return PREFIX + (COUNTER++).toString(36);
  }
  function bind(name, nn) {
    if (has(NEVER, name)) return;
    SCOPES[SCOPES.length - 1][name] = nn;
    stats.decls++;
  }
  // With rename off, newName() returns the name unchanged, so a declared local
  // still resolves to itself and is never mistaken for an env global.
  function resolve(name) {
    if (has(NEVER, name)) return null;
    for (var i = SCOPES.length - 1; i >= 0; i--) {
      if (has(SCOPES[i], name)) return SCOPES[i][name];
    }
    return null;
  }

  // ---------- string encryption ----------
  // Per-slot key from KCHAIN + SALT. Decryptors mirror this exactly. Each string
  // gets one of two encodings at random: an XOR/nibble-swap chain (mode 0) or a
  // per-byte additive chain (mode 1). Each mode has its own decoder in the output.
  function cryptBytes(data) {
    var q = STRIDX++;
    var mode = rnd(2);
    var k = (KCHAIN[(q * 17 + SALT * 5 + 131) % KCHAIN.length] + q) % 256;
    if (k === 0) k = 1;
    var hx = '', i, b, ok, ks;
    if (mode === 1) {
      for (i = 0; i < data.length; i++) {
        ks = (k * 11 + q * 3 + i * 7 + SALT) % 256;
        b = (data[i] + ks) & 255;
        hx += (b < 16 ? '0' : '') + b.toString(16);
      }
      return { hex: hx, slot: q, mode: 1 };
    }
    var k2 = ((k * 37 + q * 91 + SALT * 13) & 255) || 1;
    var r1 = (k * 131 + SALT * 17 + q * 29) & 255;
    var r2 = (k2 * 53 + q * 17) & 255;
    for (i = 0; i < data.length; i++) {
      r1 = (r1 * 73 + i * 11 + k) & 255;
      r2 = (r2 * 47 + i * 19 + k2) & 255;
      b = (data[i] + k + SALT + q * 7 + i * 3) & 255;
      b = b ^ r1;
      b = (b + r2) & 255;
      ok = ((q * 31 + 17 + i * 13) & 255) || 1;
      b = b ^ ok;
      b = ((b & 15) << 4) | (b >> 4);
      hx += (b < 16 ? '0' : '') + b.toString(16);
    }
    return { hex: hx, slot: q, mode: 0 };
  }

  function envLocal(name) {
    if (!has(envUsed, name)) {
      POOL.push(cryptBytes(utf8bytes(name)));
      envUsed[name] = { nm: inm('E'), pidx: POOL.length - 1 };
      envOrder.push(name);
    }
    return envUsed[name].nm;
  }

  function emitStrTok(tok) {
    var data, nx = peek(), ph, lv, inner;
    if (tok[0] === 'LSTR') {
      lv = tok[2];
      inner = tok[1].substring(2 + lv.length, tok[1].length - 2 - lv.length);
      if (inner.charAt(0) === '\n') inner = inner.substring(1);
      else if (inner.charAt(0) === '\r') inner = inner.substring(inner.charAt(1) === '\n' ? 2 : 1);
      data = utf8bytes(inner);
    } else {
      data = decodeShort(tok[3]);
    }
    if (!doStrings || data === null) { emit(tok[1]); stats.str_plain++; return; }
    POOL.push(cryptBytes(data));
    ph = POOLPFX + (POOL.length - 1);
    stats.str_enc++;
    if (PREV === '[' && nx[1] === ']') emit(ph);
    else if (PREV === '(' || PREV === ',') emit(ph);
    else emit('(' + ph + ')');
  }

  // ---------- numbers ----------
  function mangleInt(v) {
    var m = rnd(doMba ? 6 : 3), a, t2;
    if (m === 0) return '0x' + v.toString(16);
    if (m === 1 || v < 4) { a = rnd(v + 1); return '(' + a + '+' + (v - a) + ')'; }
    if (m === 2) { t2 = Math.floor(v / 65536); a = v - t2 * 65536; return '(' + t2 + '*65536+' + a + ')'; }
    if (m === 3) { t2 = rnd(v + 1); return '((' + (v - t2) + ')+' + t2 + ')'; }
    if (m === 4) return '((' + (v * 2) + ')-(' + v + '))';
    // Per-function key. Exact only while the sum stays below 2^53, since Luau
    // numbers are doubles.
    if (v + curKey < 9007199254740992) return '((' + (v + curKey) + ')-' + curKey + ')';
    return '((' + (v * 2) + ')-(' + v + '))';
  }

  function emitNum(text) {
    if (!doNumbers) { emit(text); return; }
    var t = text.replace(/_/g, ''), m, v, fv;
    m = /^0[xX]([0-9a-fA-F]+)$/.exec(t);
    if (m) {
      v = parseInt(m[1], 16);
      if (v <= 0xFFFFFFFF) { emit(mangleInt(v)); stats.num_mangled++; } else emit(text);
      return;
    }
    m = /^0[bB]([01]+)$/.exec(t);
    if (m) {
      v = parseInt(m[1], 2);
      if (v <= 0xFFFFFFFF) { emit(mangleInt(v)); stats.num_mangled++; } else emit(text);
      return;
    }
    if (/^[0-9]+$/.test(t)) {
      v = parseInt(t, 10);
      if (v <= 9007199254740991) { emit(mangleInt(v)); stats.num_mangled++; } else emit(text);
      return;
    }
    // Floats: x*2-x is exact in doubles (scaling by 2 is lossless). Nothing else is.
    fv = parseFloat(t);
    // Only when the printed form keeps '.' or 'e', so Lua still reads it as a float.
    if (isFinite(fv) && fv < 1e300 && /[.eE]/.test(String(fv)) && rnd(2) === 0) {
      emit('(' + fv + '*2-' + fv + ')');
      stats.num_mangled++;
      return;
    }
    emit(text);
  }

  // ---------- opaque predicates (always true) ----------
  function opaqueTrue() {
    var k = rnd(6);
    if (k === 0) return "((#'\\31\\32\\33')==3)";
    if (k === 1) return "((#'\\1\\2\\3\\4')==4)";
    if (k === 2) return '((1+2)*3==9)';
    if (k === 3) return '(({1,2,3})[3]==3)';
    if (k === 4) return "(tostring(0)=='0')";
    return '((#"\\0\\1\\2")==3)';
  }

  // ---------- identifiers ----------
  function emitRef(name) {
    var nn = resolve(name);
    if (nn) { emit(nn); stats.renamed++; } else emit(name);
  }

  function emitId(name) {
    if (PREV === '.' || PREV === ':') { emit(name); return; }
    var nx = peek();
    // table constructor field key: { name = value }
    if (nx[1] === '=' && (PREV === '{' || PREV === ',') && BRACE > 0) { emit(name); return; }
    var nn = resolve(name);
    if (nn) { emit(nn); stats.renamed++; return; }
    if (doHideEnv && has(ENV_NAMES, name) && nx[1] !== '=') {
      emit(envLocal(name));
      stats.env_enc++;
      return;
    }
    emit(name);
  }

  // ---------- statement scanning ----------
  function collectStmt() {
    var start = POS, bd = 0, tk, k, t, stack = [], top, complete, la;
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
        else if (t === 'for' || t === 'while') stack.push({ w: t, head: true, pd: bd });
        else if (t === 'do') {
          top = stack.length ? stack[stack.length - 1] : null;
          if (top && typeof top !== 'string' && top.head && bd === top.pd) top.head = false;
          else stack.push('do');
        } else if (t === 'end' || t === 'until') {
          if (!stack.length) fail('unbalanced block in statement');
          top = stack.pop();
          if ((t === 'end' && top === 'repeat') || (t === 'until' && top !== 'repeat')) {
            fail('mismatched block in statement');
          }
        }
      }
      POS++;
      complete = COMPLETE_K[k] === 1 || ((k === 'KW' || k === 'SYM') && COMPLETE_V[t] === 1);
      if (bd === 0 && !stack.length && complete) {
        la = peek();
        if (la[0] === null || la[1] === ';') {
          if (la[0] !== null) POS++;
          break;
        }
        if (la[0] === 'KW' && has(BLOCK_KW, la[1])) break;
        if (la[0] === 'ID' || la[0] === 'NUM' || la[0] === 'STR' || la[0] === 'LSTR') {
          if (!(k === 'ID' && (la[0] === 'STR' || la[0] === 'LSTR'))) break;
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

  // ---------- parser / emitter ----------
  function parseBlock(stops) {
    var tk;
    for (;;) {
      tk = peek();
      if (tk[0] === null) {
        if (stops.length) fail('eof, wanted ' + stops.join('/'));
        return;
      }
      if (tk[0] === 'KW' && contains(stops, tk[1])) return;
      if (tk[0] === 'KW' && (tk[1] === 'end' || tk[1] === 'else' || tk[1] === 'elseif' || tk[1] === 'until')) {
        fail('unexpected ' + tk[1]);
      }
      parseStmt();
    }
  }

  function parseStmt() {
    var tk = peek(), s, buf;
    if (tk[0] === 'KW' && tk[1] === 'local') parseLocal();
    else if (tk[0] === 'KW' && tk[1] === 'function') parseFunction();
    else if (tk[0] === 'KW' && tk[1] === 'if') parseIf();
    else if (tk[0] === 'KW' && tk[1] === 'while') {
      nxt(); emit('while');
      if (doOpaque && rnd() < density) { emit(opaqueTrue()); emit('and'); stats.opaque++; }
      parseUntilKw('do');
      expect('do');
      push(); parseBlock(['end']); expect('end'); pop();
    } else if (tk[0] === 'KW' && tk[1] === 'for') parseFor();
    else if (tk[0] === 'KW' && tk[1] === 'repeat') {
      nxt(); emit('repeat');
      push(); parseBlock(['until']); expect('until');
      s = POS; buf = collectStmt();
      runBuf(buf, BASE + s);
      pop();
    } else if (tk[0] === 'KW' && tk[1] === 'do') {
      nxt(); emit('do');
      push(); parseBlock(['end']); expect('end'); pop();
    } else parseTail();
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
      if (tok.plain && (k === 'STR' || k === 'LSTR' || k === 'NUM')) { emit(t); track(t); }
      else if (k === 'STR' || k === 'LSTR') emitStrTok(tok);
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
      if (k === 'KW' && t === stop) return;
      if (k === 'KW' && t === 'function') { parseFunction(); continue; }
      tok = nxt();
      if (tok.plain && (k === 'STR' || k === 'LSTR' || k === 'NUM')) { emit(t); track(t); }
      else if (k === 'STR' || k === 'LSTR') emitStrTok(tok);
      else if (k === 'NUM') emitNum(t);
      else if (k === 'ID') emitId(t);
      else { emit(t); track(t); }
    }
  }

  function parseLocal() {
    nxt();
    var tk = peek(), tok, names = [], nns = [], i, s, fnn;
    if (tk[0] === 'KW' && tk[1] === 'function') {
      nxt();
      tok = nxt();
      fnn = newName(tok[1]);
      bind(tok[1], fnn);            // bind before body so the function can recurse
      emit('local'); emit('function'); emit(fnn);
      parseBody();
      return;
    }
    for (;;) {
      tok = nxt();
      if (tok[0] !== 'ID') fail('bad local name ' + tok[1]);
      names.push(tok[1]);
      tk = peek();
      if (tk[0] === 'SYM' && tk[1] === ',') { nxt(); continue; }
      break;
    }
    for (i = 0; i < names.length; i++) nns.push(newName(names[i]));
    emit('local');
    for (i = 0; i < nns.length; i++) { if (i) emit(','); emit(nns[i]); }
    tk = peek();
    if (tk[0] === 'SYM' && tk[1] === '=') {
      nxt(); emit('=');
      s = POS;
      runBuf(collectStmt(), BASE + s);   // RHS resolves in the outer scope
    }
    for (i = 0; i < names.length; i++) bind(names[i], nns[i]);
  }

  function parseFunction() {
    nxt(); emit('function');
    var tk = peek(), tok;
    if (tk[0] === 'ID') {
      nxt();
      emitRef(tk[1]);               // definition name: never env-encode
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
    curKey = 1 + rnd(4096);
    expect('(');
    push();
    var tok, k, t, nn;
    for (;;) {
      tok = nxt(); k = tok[0]; t = tok[1];
      if (k === 'SYM' && t === ')') { emit(')'); break; }
      if (k === 'SYM' && t === ',') { emit(','); continue; }
      if (k === 'SYM' && t === '...') { emit('...'); continue; }
      if (k === 'ID') { nn = newName(t); bind(t, nn); emit(nn); continue; }
      fail('bad param ' + t);
    }
    parseBlock(['end']);
    expect('end');
    pop();
  }

  function parseIf() {
    nxt(); emit('if');
    if (doOpaque && rnd() < density) { emit(opaqueTrue()); emit('and'); stats.opaque++; }
    parseUntilKw('then'); expect('then');
    var tk;
    for (;;) {
      push(); parseBlock(['elseif', 'else', 'end']); pop();
      tk = peek();
      if (tk[0] === 'KW' && tk[1] === 'elseif') {
        nxt(); emit('elseif'); parseUntilKw('then'); expect('then');
        continue;
      }
      if (tk[0] === 'KW' && tk[1] === 'else') {
        nxt(); emit('else');
        push(); parseBlock(['end']); pop();
        expect('end');
        return;
      }
      expect('end');
      return;
    }
  }

  function parseFor() {
    nxt();
    var names = [], tk, tok, i, mode, start, pd, hdr, hdrOut, fresh = [];
    var sT, sP, sO, sB, sPrev;
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
    start = POS; pd = 0;
    for (;;) {
      tk = peek();
      if (tk[0] === null) fail('eof in for header');
      if (tk[0] === 'SYM' && (tk[1] === '(' || tk[1] === '[' || tk[1] === '{')) pd++;
      else if (tk[0] === 'SYM' && (tk[1] === ')' || tk[1] === ']' || tk[1] === '}')) pd--;
      if (tk[0] === 'KW' && tk[1] === 'do' && pd === 0) break;
      nxt();
    }
    hdr = T.slice(start, POS);
    nxt();                          // 'do'

    // header expressions resolve in the outer scope
    sT = T; sP = POS; sO = OUT; sB = BRACE; sPrev = PREV;
    BASEST.push(BASE); BASE = BASE + start;
    T = hdr; POS = 0; OUT = [];
    parseTail();
    if (POS !== hdr.length) fail('trailing tokens in for-header');
    hdrOut = OUT;
    T = sT; POS = sP; OUT = sO; BRACE = sB; PREV = sPrev;
    BASE = BASEST.pop();

    for (i = 0; i < names.length; i++) fresh.push(newName(names[i]));
    emit('for');
    for (i = 0; i < fresh.length; i++) { if (i) emit(','); emit(fresh[i]); }
    emit(mode);
    for (i = 0; i < hdrOut.length; i++) emit(hdrOut[i]);
    emit('do');
    push();
    for (i = 0; i < names.length; i++) bind(names[i], fresh[i]);
    parseBlock(['end']);
    expect('end');
    pop();
  }

  // ---------- render ----------
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
        else if ((isAlnum(pl)) && (isAlnum(cf))) out.push(' ');
        else if (cur === '-' && pl === '-') out.push(' ');
        else if (isDigit(pl) && (cf === '.')) out.push(' ');
        else if (cur === '..' || cur === '...' || prev === '..' || prev === '...') out.push(' ');
      }
      out.push(cur);
      prev = cur;
    }
    return out.join('');
  }

  // ---------- CFF (control-flow flattening) ----------
  function isValueEnd(t) {
    if (t === undefined || t === null) return false;
    if (t === ')' || t === ']' || t === '}' || t === 'end' || t === 'until' || t === '...') return true;
    var c = t.charAt(0);
    if (c === '"' || c === "'") return true;
    if (isAlnum(c)) {
      if (has(KEYWORDS, t)) return t === 'nil' || t === 'true' || t === 'false';
      return true;
    }
    return false;
  }

  function findBodyEnd(tokens, start) {
    var d = 0, k, t;
    for (k = start; k < tokens.length; k++) {
      t = tokens[k];
      if (has(BLOCK_OPEN, t)) d++;
      else if (t === 'end' || t === 'until') {
        if (d === 0) return t === 'end' ? k : -1;
        d--;
      }
    }
    return -1;
  }

  // return and break are safe inside the dispatch loop: a return ends the function
  // from any depth, and a break in the body can only belong to a loop nested in
  // the body. goto and continue are not handled, so those bodies stay verbatim.
  function needsBail(toks) {
    for (var k = 0; k < toks.length; k++) {
      var t = toks[k];
      if (t === 'goto' || t === 'continue') return true;
    }
    return false;
  }

  function isIdentTok(t) {
    return typeof t === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t) && !has(KEYWORDS, t);
  }

  // Hoists block-depth-0 local declarations so the dispatch loop can keep them in
  // scope across states. Renamed locals are unique, so hoisting cannot merge two
  // bindings. With rename off we cannot tell shadowed names apart, so we bail.
  //   local a, b = e1, e2   ->  a, b = e1, e2
  //   local a, b            ->  (dropped; hoisted names are nil at each call)
  //   local function f ...  ->  f = function ...
  // Returns { toks, names } or null.
  function hoistLocals(toks) {
    var out = [], names = [], seen = {}, d = 0, b = 0, i = 0, j, t, decl, k;
    function addName(nm) {
      if (!doRename || !isIdentTok(nm) || has(seen, nm)) return false;
      seen[nm] = 1;
      names.push(nm);
      return true;
    }
    while (i < toks.length) {
      t = toks[i];
      if (d === 0 && b === 0 && t === 'local') {
        if (toks[i + 1] === 'function') {
          if (!addName(toks[i + 2])) return null;
          out.push(toks[i + 2], '=', 'function');
          b++;
          i += 3;
          continue;
        }
        decl = [];
        j = i + 1;
        for (;;) {
          if (!addName(toks[j])) return null;
          decl.push(toks[j]);
          j++;
          if (toks[j] === ',') { j++; continue; }
          break;
        }
        if (toks[j] === '=') {
          for (k = 0; k < decl.length; k++) { if (k) out.push(','); out.push(decl[k]); }
        }
        i = j;
        continue;
      }
      out.push(t);
      if (t === '(' || t === '[' || t === '{') d++;
      else if (t === ')' || t === ']' || t === '}') d--;
      else if (has(BLOCK_OPEN, t)) b++;
      else if (t === 'end' || t === 'until') b--;
      i++;
    }
    return { toks: out, names: names };
  }

  // Split a body into top-level statements at block depth 0, bracket depth 0.
  function splitBody(toks) {
    var stmts = [], cur = [], depth = 0, blk = 0, i, t, prev = null;
    for (i = 0; i < toks.length; i++) {
      t = toks[i];
      if (depth === 0 && blk === 0) {
        if (t === ';') {
          if (cur.length) { stmts.push(cur); cur = []; }
          prev = null;
          continue;
        }
        // After a value-ending token, a name or statement keyword cannot continue
        // the expression, so it always begins the next statement.
        if ((has(STARTERS, t) || isIdentTok(t)) && cur.length && isValueEnd(prev)) {
          stmts.push(cur); cur = [];
        }
      }
      cur.push(t);
      if (t === '(' || t === '[' || t === '{') depth++;
      else if (t === ')' || t === ']' || t === '}') depth--;
      else if (has(BLOCK_OPEN, t)) blk++;
      else if (t === 'end' || t === 'until') blk--;
      prev = t;
    }
    if (cur.length) stmts.push(cur);
    return stmts;
  }

  // Largest number of states emitted as a single elseif chain. Fixture outputs use at most 5 states. Luau fails near 975 elseif branches, so 256 leaves a wide margin.
  var CFF_CHAIN_MAX = 256;
  // Emits the states lo..hi as a binary if-tree on the dispatch variable. Each leaf is one state. The caller
  // closes the outer "if sv < n then ... else break end".
  function applyCffTree(out, sv, stmts, lo, hi) {
    var mid, j;
    if (lo === hi) {
      out.push('if', sv, '==', String(lo), 'then', 'do');
      for (j = 0; j < stmts[lo].length; j++) out.push(stmts[lo][j]);
      out.push('end', ';', sv, '=', String(lo + 1), ';', 'end');
      return;
    }
    mid = lo + ((hi - lo + 1) >> 1);
    out.push('if', sv, '<', String(mid), 'then');
    applyCffTree(out, sv, stmts, lo, mid - 1);
    out.push('else');
    applyCffTree(out, sv, stmts, mid, hi);
    out.push('end');
  }

  // Upper bound on active locals of the flattened function (see cffBudget).
  function cffActiveLocals(tokens, hs, he, hoisted, stmts) {
    var params = 0, best = 0, s, k, q, m, t;
    for (k = hs; k < he; k++) if (isIdentTok(tokens[k])) params++;
    for (s = 0; s < stmts.length; s++) {
      m = 0;
      for (k = 0; k < stmts[s].length; k++) {
        t = stmts[s][k];
        if (t !== 'local' && t !== 'for') continue;
        if (stmts[s][k + 1] === 'function') { m++; continue; }
        for (q = k + 1; q < stmts[s].length && (isIdentTok(stmts[s][q]) || stmts[s][q] === ','); q++) {
          if (isIdentTok(stmts[s][q])) m++;
        }
      }
      if (m > best) best = m;
    }
    return params + hoisted + 1 + best;
  }

  function applyCFF(tokens) {
    var out = [], i = 0, n = tokens.length, paren, bodyStart, bodyEnd, inner, stmts, k, j, sv, tk, h, hdrStart;
    while (i < n) {
      if (tokens[i] !== 'function') { out.push(tokens[i]); i++; continue; }
      out.push('function'); i++;
      paren = 0;
      hdrStart = i;
      while (i < n) {
        tk = tokens[i];
        out.push(tk); i++;
        if (tk === '(') paren++;
        else if (tk === ')') { paren--; if (paren === 0) break; }
      }
      bodyStart = i;
      bodyEnd = findBodyEnd(tokens, bodyStart);
      if (bodyEnd < 0) continue;
      inner = tokens.slice(bodyStart, bodyEnd);
      if (inner.length < 8 || needsBail(inner)) continue;
      h = hoistLocals(inner);
      if (!h) continue;
      stmts = splitBody(h.toks);
      if (stmts.length < 5) continue;
      // Luau allows 200 active locals per function. The flattened form keeps every hoisted name, the dispatch
      // variable and the most locals one state declares all active at once, plus the parameters.
      if (cffActiveLocals(tokens, hdrStart, bodyStart, h.names.length, stmts) > 200) continue;

      if (h.names.length) {
        out.push('local');
        for (k = 0; k < h.names.length; k++) { if (k) out.push(','); out.push(h.names[k]); }
        out.push(';');
        stats.cff_hoisted = (stats.cff_hoisted || 0) + h.names.length;
      }
      sv = inm('V');
      out.push('local', sv, '=', '0', ';', 'while', 'true', 'do');
      if (stmts.length <= CFF_CHAIN_MAX) {
        for (k = 0; k < stmts.length; k++) {
          // do...end makes a trailing 'return' legal inside a state.
          out.push(k === 0 ? 'if' : 'elseif', sv, '==', String(k), 'then', 'do');
          for (j = 0; j < stmts[k].length; j++) out.push(stmts[k][j]);
          out.push('end', ';', sv, '=', String(k + 1), ';');
        }
      } else {
        // Balanced dispatch: nesting depth is log2(states), so long bodies never reach Luau's parser depth limit.
        out.push('if', sv, '<', String(stmts.length), 'then');
        applyCffTree(out, sv, stmts, 0, stmts.length - 1);
      }
      out.push('else', 'break', 'end', 'end');
      stats.cff_fns++;
      i = bodyEnd;                   // main loop pushes the function's 'end'
    }
    return out;
  }

  // ---------- decryptor / pool ----------
  function decSrc(name) {
    return tpl('local function ' + name + '(@h@,@s@,@K@)\n'
      + 'local @k@=' + KYN + '(@s@,@K@)\n'
      + 'local @q@=@s@\n'
      + 'local @k2@=(@k@*37+@q@*91+@K@*13)%256 if @k2@==0 then @k2@=1 end\n'
      + 'local @r1@=(@k@*131+@K@*17+@q@*29)%256\n'
      + 'local @r2@=(@k2@*53+@q@*17)%256\n'
      + 'local @o@={}\n'
      + 'for @j@=0,#@h@/2-1 do\n'
      + '@r1@=(@r1@*73+@j@*11+@k@)%256\n'
      + '@r2@=(@r2@*47+@j@*19+@k2@)%256\n'
      + 'local @b@=tonumber(@h@:sub(@j@*2+1,@j@*2+2),16)\n'
      + 'local @ok@=(@q@*31+17+@j@*13)%256 if @ok@==0 then @ok@=1 end\n'
      + '@b@=((@b@%16)*16+math.floor(@b@/16))%256\n'
      + '@b@=' + BXN + '(@b@,@ok@)\n'
      + '@b@=(@b@-@r2@)%256\n'
      + '@b@=' + BXN + '(@b@,@r1@)\n'
      + '@b@=(@b@-@k@-@K@-@q@*7-@j@*3)%256\n'
      + '@o@[#@o@+1]=string.char(@b@)\n'
      + 'end\n'
      + 'return table.concat(@o@)\n'
      + 'end;\n');
  }

  // Mode 1 decryptor: inverse of cryptBytes mode 1 (per-byte additive chain).
  function decSrcAdd(name) {
    return tpl('local function ' + name + '(@h@,@s@,@K@)\n'
      + 'local @k@=' + KYN + '(@s@,@K@)\n'
      + 'local @o@={}\n'
      + 'for @j@=0,#@h@/2-1 do\n'
      + 'local @b@=(tonumber(@h@:sub(@j@*2+1,@j@*2+2),16)-(@k@*11+@s@*3+@j@*7+@K@)%256)%256\n'
      + '@o@[#@o@+1]=string.char(@b@)\n'
      + 'end\n'
      + 'return table.concat(@o@)\n'
      + 'end;\n');
  }

  function buildPool(list) {
    var R = list.length, NP, i, j, code = '', decNames = [], groups = [], tnames = [], parts, e, dn, tn, idx, call;
    NP = Math.min(6, Math.max(1, Math.ceil(R / 24)));
    decNames.push(inm('D'), inm('D'));
    code += decSrc(decNames[0]) + decSrcAdd(decNames[1]);
    for (i = 0; i < NP; i++) groups.push([]);
    for (i = 0; i < R; i++) groups[i % NP].push(i);
    for (i = 0; i < NP; i++) {
      tn = inm('T');
      tnames.push(tn);
      parts = [];
      for (j = 0; j < groups[i].length; j++) {
        idx = groups[i][j];
        e = list[idx];
        dn = decNames[e.mode];
        call = dn + '("' + e.hex + '",' + e.slot + ',' + KN + ')';
        if (doDelayStr) parts.push('[' + (idx + 1) + ']=function() local v=' + call + ' return function() return v end end');
        else parts.push('[' + (idx + 1) + ']=function() return ' + call + ' end');
      }
      if (parts.length) code += 'local ' + tn + '={\n' + parts.join(',\n') + '\n};\n';
    }
    function access(index) {
      var t = tnames[index % NP], k = index + 1, a;
      if (rnd(2) === 0) return t + '[' + k + ']';
      a = 1 + rnd(90);
      return t + '[(' + (k + a) + ')-' + a + ']';
    }
    return { code: code, access: access };
  }

  function decodeCall(index) {
    return pool.access(index) + (doDelayStr ? '()()' : '()');
  }

  function headSrc(p) {
    var h = '', i, e, chainPacked = '';
    for (i = 0; i < KCHAIN.length; i++) {
      chainPacked += (KCHAIN[i] < 10 ? '00' : (KCHAIN[i] < 100 ? '0' : '')) + KCHAIN[i];
    }
    if (doAnti) {
      h += 'local ' + KN + '=' + SALT + ';\n'
        + 'if type(print)~="function" or type(string.char)~="function" then ' + KN + '=(' + KN + '+1)%256 end;\n';
    } else {
      h += 'local ' + KN + '=' + SALT + ';\n';
    }
    if (doHideEnv) {
      // Fallback: one getter per hidden global, each reading the global when called (so values
      // assigned later are seen). Luau's _G does not hold the environment's globals.
      h += 'local ' + FBN + '={' + Object.keys(ENV_NAMES).map(function (n) { return n + '=function() return ' + n + ' end'; }).join(',') + '};\n';
      h += tpl('local function ' + ENVFN + '(@n@)\n'
        + 'local @g@=getgenv and getgenv()\n'
        + 'if type(@g@)=="table" and @g@[@n@]~=nil then return @g@[@n@] end\n'
        + '@g@=getrenv and getrenv()\n'
        + 'if type(@g@)=="table" and @g@[@n@]~=nil then return @g@[@n@] end\n'
        + 'if type(_G)=="table" and _G[@n@]~=nil then return _G[@n@] end\n'
        + 'if ' + FBN + '[@n@] then return ' + FBN + '[@n@]() end\n'
        + 'return nil\nend;\n');
    }
    h += 'local ' + CHN + '="' + chainPacked + '";\n';
    h += tpl('local function ' + BXN + '(@a@,@b@)\n'
      + 'local @r@=0\n'
      + 'for @i@=0,7 do\n'
      + 'if @a@%2~=@b@%2 then @r@=@r@+2^@i@ end\n'
      + '@a@=math.floor(@a@/2) @b@=math.floor(@b@/2)\n'
      + 'end\nreturn @r@\nend;\n');
    h += tpl('local function ' + KYN + '(@s@,@kk@)\n'
      + 'local @p@=((@s@*17+@kk@*5+131)%' + KCHAIN.length + ')*3+1\n'
      + 'local @k@=(tonumber(' + CHN + ':sub(@p@,@p@+2))+@s@)%256\n'
      + 'if @k@==0 then @k@=1 end\nreturn @k@\nend;\n');
    h += p.code;
    for (i = 0; i < envOrder.length; i++) {
      e = envUsed[envOrder[i]];
      h += 'local ' + e.nm + '=' + ENVFN + '(' + decodeCall(e.pidx) + ');\n';
    }
    return h;
  }

  // ---------- bound stub ----------
  function boundSrc() {
    if (!bound) return '';
    var S = inm('B');
    return 'local ' + S + '=nil;'
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
      + S + '=1 end);'
      + 'if ' + S + '==nil then return end;\n';
  }

  // ---------- junk ----------
  function junkSrc() {
    if (!doJunk) return '';
    var n = Math.floor((6 + rnd(8)) * (0.5 + density)), out = '', i, a, b, c, kind;
    for (i = 0; i < n; i++) {
      kind = rnd(5);
      a = inm('J'); b = inm('J'); c = inm('J');
      stats.junk++;
      if (kind === 0) {
        out += 'do local ' + a + '={} local ' + b + '=0 for ' + c + '=1,' + (3 + rnd(5)) + ' do '
          + a + '[' + c + ']=' + c + '*' + (1 + rnd(7)) + ' ' + b + '=' + b + '+' + a + '[' + c + '] end end\n';
      } else if (kind === 1) {
        out += 'do local ' + a + '=("' + ALPHA_L.charAt(rnd(26)) + '"):rep(' + (1 + rnd(4)) + ') '
          + 'if #' + a + '>0 then local ' + b + '=#' + a + ' end end\n';
      } else if (kind === 2) {
        out += 'do local ' + a + '=(function(' + b + ') return ' + b + ' end)(' + (1 + rnd(9)) + ') '
          + 'local ' + c + '=' + a + '*0 end\n';
      } else if (kind === 3) {
        out += 'do local ' + a + '={n=' + (10 + rnd(40)) + '} if ' + a + '.n>0 then local ' + b + '=' + a + '.n*0 end end\n';
      } else {
        out += 'do local ' + a + '=1 while ' + a + '<1 do ' + a + '=' + a + '+1 end end\n';
      }
    }
    return out;
  }

  // ---------- driver ----------
  var srcToks = tokenize(src), vmPre = [];
  if (doVm) {
    var vmRes = vmPass(srcToks, rnd, idents);
    srcToks = vmRes.toks;
    vmPre = vmRes.pre || [];
    stats.vm = vmRes.compiled;
    stats.vm_skips = vmRes.skips;
  }
  // Preamble (VM tables and helpers) is parsed first and placed in the outer scope;
  // the program is parsed second and placed in the inner scope. The parser's scope
  // stack persists across the two passes, so program references still resolve.
  OUT = [];
  T = vmPre; POS = 0;
  if (vmPre.length) { parseBlock([]); if (POS !== T.length) fail('trailing vm preamble tokens'); }
  var outerOut = OUT;
  OUT = [];
  T = srcToks; POS = 0;
  parseBlock([]);
  if (POS !== T.length) fail('trailing top-level tokens');
  var innerOut = OUT;

  var outerToks = doCff ? applyCFF(outerOut) : outerOut;
  var bodyToks = doCff ? applyCFF(innerOut) : innerOut;
  var preText = render(outerToks);
  var body = render(bodyToks);

  // decoys: random filler strings in the pool, referenced but never used
  // decoyStrings (from Live) are used verbatim so decoys can match the real link's shape.
  var given = Array.isArray(opts.decoyStrings) ? opts.decoyStrings : null;
  var nd = given ? Math.min(80, given.length) : Math.min(80, Math.max(0, Math.floor(+opts.decoys) || 0));
  var decoyStart = POOL.length, di, dj, dstr, cset = ALPHA_L + ALPHA_U + '0123456789';
  for (di = 0; di < nd; di++) {
    if (given) dstr = String(given[di]).slice(0, 200);
    else { dstr = ''; for (dj = 0; dj < 40; dj++) dstr += cset.charAt(rnd(cset.length)); }
    POOL.push(cryptBytes(utf8bytes(dstr)));
  }
  stats.decoys = nd;

  pool = buildPool(POOL);

  var poolRe = new RegExp(POOLPFX + '(\\d+)', 'g');
  var poolSub = function (m, n) { return decodeCall(parseInt(n, 10)); };
  body = body.replace(poolRe, poolSub);
  preText = preText.replace(poolRe, poolSub);

  var decoyOut = '';
  for (di = 0; di < nd; di++) decoyOut += 'do local _=' + decodeCall(decoyStart + di) + ' end;\n';

  var head = headSrc(pool);
  // Two scopes: engine helpers live in an outer function, the program in an inner one,
  // so each stays under Luau's 200-active-local limit per function.
  var code = 'return (function(...)\n' + head + boundSrc() + junkSrc() + decoyOut + preText + '\n'
    + 'return (function(...)\n' + body + '\nend)(...)\nend)(...)\n';

  stats.pool = { real: POOL.length - nd, fake: nd, decoys: nd, env: envOrder.length };
  stats.bound = !bound ? 'off' : (bindUser > 0 ? 'place+user' : 'place');
  stats.profile = profile;
  stats.density = density;
  stats.cff = doCff;

  if (opts.singleLine === true) {
    code = toSingleLine(code);
    stats.format = 'single-line';
  }
  return { code: code, stats: stats };
}

obfuscate.internals = { tokenize: tokenize, parseExpr: parseExprAt, emitExpr: emitExpr };
return obfuscate;
}));
