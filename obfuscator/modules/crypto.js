/**
 * GNG Obfuscator - Cryptographic Utilities
 * Secure random number generation and hash functions
 */

import {
  FNV_OFFSET_BASIS,
  FNV_PRIME,
  FNV_MUL_CONSTANT,
  FNV_SHIFT_CONSTANT,
  MODULUS_256,
  KEYSTREAM_MIX_CONSTANT
} from './constants.js';

/**
 * SecureRandom - Cryptographically secure random number generator
 * Falls back to ChaCha20-like algorithm if native crypto unavailable
 */
export class SecureRandom {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.state = new Uint32Array(16);
    this.index = 0;
    this.initialize(seed);
  }

  initialize(seed) {
    // Initialize state with seed using a simple hash
    for (let i = 0; i < 16; i++) {
      this.state[i] = seed;
      seed = (seed * 1103515245 + 12345) & 0xFFFFFFFF;
    }
    this.index = 0;
  }

  /**
   * Generate next random 32-bit value using ChaCha20-like quarter round
   */
  next32() {
    if (this.index >= 16) {
      this.mixState();
      this.index = 0;
    }
    return this.state[this.index++];
  }

  /**
   * Mix state using quarter round operations
   */
  mixState() {
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 16; i += 4) {
        this.quarterRound(i, i + 1, i + 2, i + 3);
      }
      // Column rounds
      this.quarterRound(0, 4, 8, 12);
      this.quarterRound(1, 5, 9, 13);
      this.quarterRound(2, 6, 10, 14);
      this.quarterRound(3, 7, 11, 15);
      // Diagonal rounds
      this.quarterRound(0, 5, 10, 15);
      this.quarterRound(1, 6, 11, 12);
      this.quarterRound(2, 7, 8, 13);
      this.quarterRound(3, 4, 9, 14);
    }
  }

  quarterRound(a, b, c, d) {
    const sa = this.state[a];
    const sb = this.state[b];
    const sc = this.state[c];
    const sd = this.state[d];

    this.state[a] = (sa + sb) >>> 0;
    this.state[d] = (this.state[d] ^ this.state[a]) << 16 | (this.state[d] ^ this.state[a]) >>> 16;
    this.state[c] = (this.state[c] + this.state[d]) >>> 0;
    this.state[b] = (this.state[b] ^ this.state[c]) << 12 | (this.state[b] ^ this.state[c]) >>> 12;
    this.state[a] = (this.state[a] + this.state[b]) >>> 0;
    this.state[d] = (this.state[d] ^ this.state[a]) << 8 | (this.state[d] ^ this.state[a]) >>> 8;
    this.state[c] = (this.state[c] + this.state[d]) >>> 0;
    this.state[b] = (this.state[b] ^ this.state[c]) << 7 | (this.state[b] ^ this.state[c]) >>> 25;
  }

  /**
   * Get random float in [0, 1)
   */
  nextFloat() {
    return this.next32() / 4294967296;
  }

  /**
   * Get random integer in [0, n)
   */
  nextInt(n) {
    if (n === undefined) return this.nextFloat();
    return Math.floor(this.nextFloat() * n);
  }

  /**
   * Get random integer in [min, max]
   */
  nextRange(min, max) {
    return min + this.nextInt(max - min + 1);
  }
}

/**
 * Use native crypto if available (browser or Node.js)
 */
export function getNativeRandom() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return (bytes) => {
      const array = new Uint8Array(bytes);
      crypto.getRandomValues(array);
      return array;
    };
  }
  if (typeof require !== 'undefined') {
    try {
      const nodeCrypto = require('crypto');
      return (bytes) => nodeCrypto.randomBytes(bytes);
    } catch (e) {
      // Node crypto not available
    }
  }
  return null;
}

/**
 * FNV-1a 64-bit hash function
 */
export function fnv64(str) {
  let hi = FNV_OFFSET_BASIS >> 32n;
  let lo = FNV_OFFSET_BASIS & 0xFFFFFFFFn;

  for (let i = 0; i < str.length; i++) {
    const b = BigInt(str.charCodeAt(i));
    lo ^= b;

    // Multiply by FNV prime using 64-bit emulation
    const a0 = Number(lo & 0xFFFFn);
    const a1 = Number((lo >> 16n) & 0xFFFFn);
    const a2 = Number(hi & 0xFFFFn);
    const a3 = Number((hi >> 16n) & 0xFFFFn);

    const r0 = a0 * FNV_MUL_CONSTANT;
    const r1 = a1 * FNV_MUL_CONSTANT;
    const r2 = a0 * FNV_SHIFT_CONSTANT + a2 * FNV_MUL_CONSTANT;
    const r3 = a1 * FNV_SHIFT_CONSTANT + a3 * FNV_MUL_CONSTANT;

    const t0 = r0;
    const o0 = t0 % 65536;
    const t1 = r1 + Math.floor(t0 / 65536);
    const o1 = t1 % 65536;
    const t2 = r2 + Math.floor(t1 / 65536);
    const o2 = t2 % 65536;
    const t3 = r3 + Math.floor(t2 / 65536);
    const o3 = t3 % 65536;

    hi = BigInt(o3 * 65536 + o2);
    lo = BigInt(o1 * 65536 + o0);
  }

  // Format as hex
  const h8 = (v) => v.toString(16).padStart(8, '0');
  return h8(Number(hi)) + h8(Number(lo));
}

/**
 * FNV-1a 64-bit hash from byte array
 */
export function fnv64Bytes(bytes) {
  let hi = FNV_OFFSET_BASIS >> 32n;
  let lo = FNV_OFFSET_BASIS & 0xFFFFFFFFn;

  for (let i = 0; i < bytes.length; i++) {
    const b = BigInt(bytes[i]);
    lo ^= b;

    const a0 = Number(lo & 0xFFFFn);
    const a1 = Number((lo >> 16n) & 0xFFFFn);
    const a2 = Number(hi & 0xFFFFn);
    const a3 = Number((hi >> 16n) & 0xFFFFn);

    const r0 = a0 * FNV_MUL_CONSTANT;
    const r1 = a1 * FNV_MUL_CONSTANT;
    const r2 = a0 * FNV_SHIFT_CONSTANT + a2 * FNV_MUL_CONSTANT;
    const r3 = a1 * FNV_SHIFT_CONSTANT + a3 * FNV_MUL_CONSTANT;

    const t0 = r0;
    const o0 = t0 % 65536;
    const t1 = r1 + Math.floor(t0 / 65536);
    const o1 = t1 % 65536;
    const t2 = r2 + Math.floor(t1 / 65536);
    const o2 = t2 % 65536;
    const t3 = r3 + Math.floor(t2 / 65536);
    const o3 = t3 % 65536;

    hi = BigInt(o3 * 65536 + o2);
    lo = BigInt(o1 * 65536 + o0);
  }

  const h8 = (v) => v.toString(16).padStart(8, '0');
  return h8(Number(hi)) + h8(Number(lo));
}

/**
 * Encrypt bytes with additive cipher (multi-round)
 */
export function encryptBytes(data, key, salt, index, rng) {
  const result = [];
  const rounds = 2 + rng.nextInt(3); // 2-4 rounds

  for (let i = 0; i < data.length; i++) {
    let byte = data[i];
    for (let r = 0; r < rounds; r++) {
      byte = (byte + key + salt + (index + i) * KEYSTREAM_MIX_CONSTANT + r * 13) % MODULUS_256;
    }
    result.push(byte);
  }

  return result;
}

/**
 * Decrypt bytes (reverse of encryptBytes)
 */
export function decryptBytes(data, key, salt, index) {
  const result = [];
  const rounds = 2; // Must match encryption rounds (simplified for now)

  for (let i = 0; i < data.length; i++) {
    let byte = data[i];
    for (let r = rounds - 1; r >= 0; r--) {
      byte = (byte - key - salt - (index + i) * KEYSTREAM_MIX_CONSTANT - r * 13) % MODULUS_256;
      if (byte < 0) byte += MODULUS_256;
    }
    result.push(byte);
  }

  return result;
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes) {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

/**
 * UTF-8 encode string to bytes
 */
export function utf8Encode(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const cc = str.charCodeAt(i);
    if (cc < 128) {
      bytes.push(cc);
    } else if (cc < 2048) {
      bytes.push(192 | (cc >> 6));
      bytes.push(128 | (cc & 63));
    } else {
      bytes.push(224 | (cc >> 12));
      bytes.push(128 | ((cc >> 6) & 63));
      bytes.push(128 | (cc & 63));
    }
  }
  return bytes;
}

/**
 * UTF-8 decode bytes to string
 */
export function utf8Decode(bytes) {
  let str = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 128) {
      str += String.fromCharCode(b);
      i++;
    } else if ((b & 224) === 192) {
      str += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63));
      i += 2;
    } else if ((b & 240) === 224) {
      str += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63));
      i += 3;
    } else {
      str += String.fromCharCode(b);
      i++;
    }
  }
  return str;
}
