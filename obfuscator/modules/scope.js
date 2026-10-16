/**
 * GNG Obfuscator - Scope Analyzer
 * Handles variable scoping, renaming, and resolution
 */

import { NEVER_RENAME } from './lexer.js';

/**
 * ScopeAnalyzer - Manages lexical scopes and variable renaming
 */
export class ScopeAnalyzer {
  constructor(prefix) {
    this.scopes = [{}]; // Stack of scopes, each is a map: originalName -> obfuscatedName
    this.prefix = prefix;
    this.counter = 0;
    this.stats = { decls: 0, renamed: 0 };
  }

  /**
   * Push a new scope
   */
  push() {
    this.scopes.push({});
  }

  /**
   * Pop the current scope
   */
  pop() {
    this.scopes.pop();
  }

  /**
   * Declare a new variable in the current scope
   * @param {string} name - Original variable name
   * @returns {string} Obfuscated name
   */
  declare(name) {
    if (NEVER_RENAME.has(name)) return name;

    const obfuscated = `${this.prefix}${this.counter++}`;
    this.scopes[this.scopes.length - 1][name] = obfuscated;
    this.stats.decls++;
    return obfuscated;
  }

  /**
   * Resolve a variable name to its obfuscated form
   * @param {string} name - Original variable name
   * @returns {string|null} Obfuscated name, or null if not found (global)
   */
  resolve(name) {
    if (NEVER_RENAME.has(name)) return null;

    // Search from innermost to outermost scope
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i];
      if (Object.prototype.hasOwnProperty.call(scope, name)) {
        return scope[name];
      }
    }

    return null; // Global variable
  }

  /**
   * Check if a name is declared in any scope
   * @param {string} name - Variable name
   * @returns {boolean}
   */
  isDeclared(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i];
      if (Object.prototype.hasOwnProperty.call(scope, name)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the current depth
   * @returns {number}
   */
  get depth() {
    return this.scopes.length - 1;
  }

  /**
   * Reset for new obfuscation run
   */
  reset(prefix) {
    this.scopes = [{}];
    this.prefix = prefix || this.prefix;
    this.counter = 0;
    this.stats = { decls: 0, renamed: 0 };
  }
}

/**
 * Choose a prefix that doesn't conflict with existing identifiers
 * @param {string} src - Source code
 * @param {string} defaultPrefix - Default prefix to use
 * @returns {string} Chosen prefix
 */
export function choosePrefix(src, defaultPrefix = '__GNG') {
  const idents = new Set();
  const idre = /[A-Za-z_][A-Za-z0-9_]*/g;
  let match;

  while ((match = idre.exec(src)) !== null) {
    idents.add(match[0]);
  }

  // Check if default prefix conflicts
  const hasConflict = Array.from(idents).some(id =>
    id.startsWith(defaultPrefix) || id.startsWith('__QZX')
  );

  if (hasConflict) {
    return '__QZX';
  }

  return defaultPrefix;
}

/**
 * Choose a unique decryptor name
 * @param {Set} idents - Set of existing identifiers
 * @param {string} prefix - Prefix to use
 * @returns {string} Unique decryptor name
 */
export function chooseDecryptorName(idents, prefix) {
  let name = `${prefix}D`;
  let di = 0;

  while (idents.has(name)) {
    di++;
    name = `${prefix}D${di}`;
  }

  return name;
}
