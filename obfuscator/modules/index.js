/**
 * GNG Obfuscator - Main Entry Point
 * Modern ES6+ implementation of the Lua/Luau obfuscator
 */

import { tokenize, decodeShort } from './lexer.js';
import { ScopeAnalyzer, choosePrefix, chooseDecryptorName } from './scope.js';
import { Parser } from './parser.js';
import { SecureRandom, fnv64Bytes, utf8Encode, encryptBytes, bytesToHex } from './crypto.js';
import { generateStub, generateJunkLocals, generateDecoys } from './stub.js';
import {
  MODULUS_251,
  MODULUS_256,
  KEYSTREAM_MIX_CONSTANT,
  MAX_DECOYS,
  MIN_FAKE_POOL_SIZE,
  MAX_FAKE_POOL_SIZE,
  FAKE_POOL_RATIO,
  BOOTSTRAP_MIN_LENGTH,
  BOOTSTRAP_MAX_LENGTH
} from './constants.js';

/**
 * Main obfuscation function
 * @param {string} src - Lua/Luau source code
 * @param {number} seed - Random seed for reproducibility
 * @param {Object} options - Obfuscation options
 * @returns {Object} {code: string, stats: Object}
 */
export function gngObfuscate(src, seed = 1, options = {}) {
  // Input validation
  if (typeof src !== 'string') {
    throw new Error('Source must be a string');
  }

  // Merge with defaults
  const opts = {
    rename: true,
    strings: true,
    numbers: true,
    place: 0,
    user: 0,
    decoys: 6,
    require: '',
    bootstrap: '',
    vault: '',
    script: '',
    ...options
  };

  // Parse options
  const bindPlace = Math.floor(+opts.place || 0);
  const bindUser = Math.floor(+opts.user || 0);
  const placeId = bindPlace > 0 ? bindPlace : 0;
  const userId = bindUser > 0 ? bindUser : 0;
  const bound = placeId > 0 || userId > 0;
  const RP = bound ? (placeId % MODULUS_251) : 0;
  const RU = (bound && userId > 0) ? (userId % MODULUS_251) : -1;
  const SALT = bound ? ((placeId % MODULUS_251) + (userId > 0 ? ((userId * 13) % MODULUS_251) : 0)) % MODULUS_256 : 0;

  // Validate require path
  const REQPATH = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(opts.require || '') ? (opts.require || '') : '';

  // Validate bootstrap
  let BOOT = opts.bootstrap || '';
  if (BOOT !== '' && !/^[0-9a-fA-F]{32,128}$/.test(BOOT)) {
    throw new Error('Bootstrap must be 32-128 hex characters');
  }

  // Validate vault URL
  let VBASE = opts.vault || '';
  if (!/^https?:\/\/[A-Za-z0-9_.-]+(:\d+)?(\/[A-Za-z0-9_.\-/]*)?$/.test(VBASE)) {
    VBASE = '';
  }

  // Bootstrap requires vault and binding
  if (BOOT !== '' && (VBASE === '' || !bound)) {
    BOOT = '';
  }

  // Validate script ID
  const SCRIPTID = /^[A-Za-z0-9_-]{1,64}$/.test(opts.script || '') ? (opts.script || '') : '';

  // Hierarchical keys for bootstrap
  let BKEY = BOOT;
  if (BOOT !== '' && SCRIPTID !== '') {
    BKEY = fnv64Bytes(utf8Encode(BOOT + '|' + SCRIPTID));
  }

  // Initialize secure RNG
  const rng = new SecureRandom(seed >>> 0 || 1);

  // Choose prefix that doesn't conflict
  const PREFIX = choosePrefix(src);
  const idents = new Set();
  const idre = /[A-Za-z_][A-Za-z0-9_]*/g;
  let match;
  while ((match = idre.exec(src)) !== null) {
    idents.add(match[0]);
  }

  // Choose unique decryptor name
  const DEC = chooseDecryptorName(idents, PREFIX);
  const POOLPFX = `${PREFIX}POOL_`;

  // Tokenize
  const tokens = tokenize(src);

  // Initialize scope analyzer
  const scope = new ScopeAnalyzer(PREFIX);

  // Initialize parser
  const parser = new Parser(tokens, scope, {
    rename: opts.rename !== false,
    strings: opts.strings !== false,
    numbers: opts.numbers !== false,
    rng
  });

  // Parse
  parser.parseBlock([]);

  // Get output
  const outputPieces = parser.getOutput();
  const parserStats = parser.getStats();

  // Combine stats
  const stats = {
    decls: scope.stats.decls,
    renamed: scope.stats.renamed,
    str_enc: parserStats.str_enc,
    str_plain: parserStats.str_plain,
    num_mangled: parserStats.num_mangled,
    pool: { real: 0, fake: 0 },
    decoys: Math.min(Math.floor(+opts.decoys || 0), MAX_DECOYS),
    bound: bound ? (userId > 0 ? 'place+user' : 'place') : 'off',
    require: REQPATH,
    script: SCRIPTID,
    vault: BOOT !== ''
  };

  // Render output with spacing
  const body = render(outputPieces);

  // Generate stub
  const CNM = `${PREFIX}C`;
  const head = generateStub(
    { placeId, userId, requirePath: REQPATH, rng },
    DEC,
    CNM
  );

  // Generate junk locals
  const junk = generateJunkLocals(PREFIX, 6, rng);

  // Generate decoys
  const ndecoy = stats.decoys;
  let decoyOut = '';
  if (ndecoy > 0) {
    const encryptFn = (data) => {
      const k = 1 + rng.nextInt(255);
      const q = 0;
      const encrypted = encryptBytes(data, k, SALT, q, rng);
      return [bytesToHex(encrypted), k, q];
    };
    decoyOut = generateDecoys(PREFIX, ndecoy, encryptFn, rng);
  }

  // Combine everything
  const code = head + junk + decoyOut + body + '\n';

  return { code, stats };
}

/**
 * Render token array to string with proper spacing
 */
function render(pieces) {
  const out = [];
  let prev = '';

  for (let i = 0; i < pieces.length; i++) {
    const cur = pieces[i];

    if (out.length) {
      const pl = prev.charAt(prev.length - 1);
      const cf = cur.charAt(0);

      // Tight cases
      if (cur === ',' || cur === ';' || cur === ')' || cur === ']' || cur === '}' ||
          prev === '(' || prev === '[' || prev === '{') {
        // No space
      } else if (cur === '.' || cur === ':' || prev === '.' || prev === ':') {
        // No space
      } else if (cur === '(' || prev === ')') {
        // No space
      } else if (isAlnum(pl) && isAlnum(cf)) {
        out.push(' ');
      } else if (cur === '-' && pl === '-') {
        out.push(' ');
      } else if (isDigit(pl) && (isAlnum(cf) || cf === '_' || cf === '.')) {
        out.push(' ');
      } else if (isDigit(cf) && (isAlnum(pl) || pl === '_' || pl === '.')) {
        out.push(' ');
      } else if (cur === '..' || cur === '...' || prev === '..' || prev === '...') {
        out.push(' ');
      }
    }

    out.push(cur);
    prev = cur;
  }

  return out.join('');
}

/**
 * Check if character is alphanumeric
 */
function isAlnum(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_';
}

/**
 * Check if character is a digit
 */
function isDigit(c) {
  return c >= '0' && c <= '9';
}

// Export for both ESM and CommonJS
export default gngObfuscate;
