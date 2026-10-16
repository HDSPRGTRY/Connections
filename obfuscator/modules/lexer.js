/**
 * GNG Obfuscator - Lexer
 * Tokenizes Lua/Luau source code
 */

import {
  CHAR_TAB,
  CHAR_NEWLINE,
  CHAR_VTAB,
  CHAR_FORM_FEED,
  CHAR_CARRIAGE_RETURN,
  CHAR_SPACE,
  ESCAPE_CODES
} from './constants.js';

// Lua keywords
export const KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for',
  'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or',
  'repeat', 'return', 'then', 'true', 'until', 'while', 'continue'
]);

// Binary operators
export const BINOP = new Set([
  '+', '-', '*', '/', '%', '^', '..', '<', '>', '<=', '>=',
  '==', '~=', 'and', 'or', ',', '(', 'not', '#'
]);

// Tokens that complete expressions
export const COMPLETE_K = new Set(['ID', 'NUM', 'STR', 'LSTR']);

// Tokens that complete values
export const COMPLETE_V = new Set(['true', 'false', 'nil', '...', ')', ']', '}', 'break']);

// Block-starting keywords
export const BLOCK_KW = new Set([
  'local', 'function', 'if', 'while', 'for', 'repeat',
  'do', 'end', 'else', 'elseif', 'until', 'return', 'break', 'then', 'in'
]);

// Identifiers that should never be renamed
export const NEVER_RENAME = new Set(['self', '_G', '_VERSION']);

/**
 * Check if character is alphabetic
 */
function isAlpha(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

/**
 * Check if character is a digit
 */
function isDigit(c) {
  return c >= '0' && c <= '9';
}

/**
 * Check if character is alphanumeric
 */
function isAlnum(c) {
  return isAlpha(c) || isDigit(c);
}

/**
 * Parse long string/literal opener [[==[ ... ]==]
 */
function longOpen(s, p) {
  if (s.charAt(p) !== '[') return null;
  let k = p + 1;
  let eq = '';
  while (s.charAt(k) === '=') {
    eq += '=';
    k++;
  }
  if (s.charAt(k) !== '[') return null;
  return { eq, end: k + 1 };
}

/**
 * Tokenize Lua/Luau source code
 * @param {string} s - Source code
 * @returns {Array} Array of tokens [type, value, ...extra]
 */
export function tokenize(s) {
  const toks = [];
  let i = 0;
  const n = s.length;

  while (i < n) {
    const c = s.charAt(i);
    const cc = s.charCodeAt(i);

    // Skip whitespace
    if (cc === CHAR_SPACE || cc === CHAR_TAB || cc === CHAR_CARRIAGE_RETURN ||
        cc === CHAR_NEWLINE || cc === CHAR_VTAB || cc === CHAR_FORM_FEED) {
      i++;
      continue;
    }

    // Skip comments
    if (c === '-' && s.charAt(i + 1) === '-') {
      if (s.charAt(i + 2) === '[') {
        const mo = longOpen(s, i + 2);
        if (mo) {
          const j = s.indexOf(']' + mo.eq + ']', mo.end);
          if (j < 0) throw new Error('lex: unterminated long comment');
          i = j + mo.eq.length + 2;
          continue;
        }
      }
      const j = s.indexOf('\n', i);
      i = (j < 0) ? n : j;
      continue;
    }

    // Long strings [[ ... ]]
    const lo = longOpen(s, i);
    if (lo) {
      const j = s.indexOf(']' + lo.eq + ']', lo.end);
      if (j < 0) throw new Error('lex: unterminated long string');
      toks.push(['LSTR', s.substring(i, j + lo.eq.length + 2), lo.eq]);
      i = j + lo.eq.length + 2;
      continue;
    }

    // Short strings "..." or '...'
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      let raw = '';
      for (;;) {
        if (j >= n) throw new Error('lex: unterminated string');
        const d = s.charAt(j);
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

    // Numbers
    if (isDigit(c) || (c === '.' && isDigit(s.charAt(i + 1)))) {
      const rest = s.substring(i);
      let m = rest.match(/^0[xX][0-9a-fA-F_]+/);
      if (m) {
        toks.push(['NUM', m[0]]);
        i += m[0].length;
        continue;
      }
      m = rest.match(/^[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?/);
      if (m && !(c === '.' && m[0].charAt(0) !== '.')) {
        toks.push(['NUM', m[0]]);
        i += m[0].length;
        continue;
      }
      if (c !== '.') throw new Error('lex: bad number');
    }

    // Identifiers and keywords
    if (isAlpha(c)) {
      let j = i;
      while (j < n && isAlnum(s.charAt(j))) j++;
      const w = s.substring(i, j);
      toks.push([KEYWORDS.has(w) ? 'KW' : 'ID', w]);
      i = j;
      continue;
    }

    // Symbols
    const three = s.substring(i, i + 3);
    const two = s.substring(i, i + 2);
    let sym = null;

    if (three === '...') sym = '...';
    else if (two === '..' || two === '==' || two === '~=' || two === '<=' || two === '>=') sym = two;
    else if (two === '::') throw new Error('lex: labels unsupported');

    if (sym) {
      toks.push(['SYM', sym]);
      i += sym.length;
      continue;
    }

    if ('(){}[];:,+-*/%^#<>=.'.indexOf(c) >= 0) {
      toks.push(['SYM', c]);
      i++;
      continue;
    }

    if (s.charCodeAt(i) > 127) throw new Error('lex: non-ascii outside string');
    throw new Error(`lex: bad char ${c}`);
  }

  return toks;
}

/**
 * Decode short string escape sequences
 */
export function decodeShort(raw) {
  const out = [];
  let i = 0;
  const n = raw.length;

  while (i < n) {
    const c = raw.charAt(i);
    if (c !== '\\') {
      const cc = raw.charCodeAt(i);
      if (cc < 128) {
        out.push(cc);
      } else if (cc < 2048) {
        out.push(192 | (cc >> 6));
        out.push(128 | (cc & 63));
      } else {
        out.push(224 | (cc >> 12));
        out.push(128 | ((cc >> 6) & 63));
        out.push(128 | (cc & 63));
      }
      i++;
      continue;
    }

    if (i + 1 >= n) return null;
    const e = raw.charAt(i + 1);

    if (ESCAPE_CODES[e] !== undefined) {
      out.push(ESCAPE_CODES[e]);
      i += 2;
    } else if (e === 'x' || e === 'u' || e === 'z') {
      return null;
    } else if (e >= '0' && e <= '9') {
      const mm = raw.substring(i + 1).match(/^[0-9]{1,3}/);
      out.push(parseInt(mm[0], 10) % 256);
      i += 1 + mm[0].length;
    } else {
      return null;
    }
  }

  return out;
}
