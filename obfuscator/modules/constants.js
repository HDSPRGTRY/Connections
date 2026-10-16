/**
 * GNG Obfuscator - Constants
 * Magic numbers and configuration values extracted for maintainability
 */

// Modulus values for residue computation
export const MODULUS_251 = 251;
export const MODULUS_256 = 256;

// LCG PRNG parameters (legacy, will be replaced with secure PRNG)
export const PRNG_MULTIPLIER = 1664525;
export const PRNG_INCREMENT = 1013904223;
export const PRNG_MODULUS = 4294967296;

// FNV-1a 64-bit hash constants
export const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
export const FNV_PRIME = 0x100000001b3n;

// FNV multiplication constant (65536) for 64-bit emulation
export const FNV_MUL_CONSTANT = 435;
export const FNV_SHIFT_CONSTANT = 256;

// Unicode escape sequences
export const CHAR_TAB = 9;
export const CHAR_NEWLINE = 10;
export const CHAR_VTAB = 11;
export const CHAR_FORM_FEED = 12;
export const CHAR_CARRIAGE_RETURN = 13;
export const CHAR_SPACE = 32;

// String escape codes
export const ESCAPE_CODES = {
  a: 7,
  b: 8,
  f: 12,
  n: 10,
  r: 13,
  t: 9,
  v: 11,
  '\\': 92,
  '"': 34,
  "'": 39,
  '\n': 10
};

// Anti-detection loop parameters
export const ANTI_DEBUG_LOOP_COUNT = 25;
export const ANTI_DEBUG_LOOP_DELAY_MS = 1;
export const ANTI_DEBUG_ACCUMULATION_MAX = 5000;
export const ANTI_DEBUG_ACCUMULATION_EXPECTED = 12502500;

// Anti-detection tolerance values
export const TOLERANCE_VECTOR3 = 0.0001;
export const TOLERANCE_CFRAME = 0.0001;

// Pool sizing
export const MIN_FAKE_POOL_SIZE = 8;
export const MAX_FAKE_POOL_SIZE = 64;
export const FAKE_POOL_RATIO = 4;

// Decoy limits
export const MAX_DECOYS = 50;

// Vault token TTL
export const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const NONCE_TTL_MS = 60 * 1000; // 1 minute

// Rate limiting
export const RATE_LIMIT_PER_MINUTE = 40;

// Obfuscator prefix patterns
export const PREFIX_PATTERN_1 = '__GNG';
export const PREFIX_PATTERN_2 = '__QZX';

// UTF-8 encoding bit patterns
export const UTF8_1BYTE_MAX = 128;
export const UTF8_2BYTE_MAX = 2048;
export const UTF8_3BYTE_MAX = 65536;
export const UTF8_2BYTE_MASK = 192;
export const UTF8_3BYTE_MASK = 224;
export const UTF8_CONTINUATION_MASK = 128;
export const UTF8_6BIT_MASK = 63;

// Keystream mixing constant
export const KEYSTREAM_MIX_CONSTANT = 7;

// Bootstrap validation
export const BOOTSTRAP_MIN_LENGTH = 32;
export const BOOTSTRAP_MAX_LENGTH = 128;
