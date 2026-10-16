/**
 * GNG Obfuscator - Parser
 * Parses token stream into obfuscated output
 */

import {
  KEYWORDS,
  BINOP,
  COMPLETE_K,
  COMPLETE_V,
  BLOCK_KW
} from './lexer.js';
import { ScopeAnalyzer } from './scope.js';

/**
 * Parser - Converts token stream to obfuscated Lua code
 */
export class Parser {
  constructor(tokens, scopeAnalyzer, options) {
    this.tokens = tokens;
    this.pos = 0;
    this.output = [];
    this.scope = scopeAnalyzer;
    this.options = options;
    this.braceDepth = 0;
    this.prevToken = '';
    this.stringPool = [];
    this.stringIndex = 0;
    this.poolPrefix = '';
    this.stats = {
      str_enc: 0,
      str_plain: 0,
      num_mangled: 0
    };
  }

  /**
   * Emit a token to output
   */
  emit(s) {
    this.output.push(s);
    this.prevToken = s;
  }

  /**
   * Peek at current token
   */
  peek() {
    if (this.pos < this.tokens.length) {
      return this.tokens[this.pos];
    }
    return [null, null];
  }

  /**
   * Look ahead by offset
   */
  look(offset = 1) {
    const p = this.pos + offset;
    if (p < this.tokens.length) {
      return this.tokens[p];
    }
    return [null, null];
  }

  /**
   * Consume and return current token
   */
  next() {
    return this.tokens[this.pos++];
  }

  /**
   * Get context for error messages
   */
  context() {
    let s = `@${this.pos}:`;
    for (let i = 0; i < 6 && this.pos + i < this.tokens.length; i++) {
      s += ` [${this.tokens[this.pos + i][1]}]`;
    }
    return s;
  }

  /**
   * Throw parse error with context
   */
  fail(msg) {
    throw new Error(`parse: ${msg}${this.context()}`);
  }

  /**
   * Expect a specific token value
   */
  expect(value) {
    const tk = this.next();
    if (tk[1] !== value) {
      this.fail(`expected ${value} got ${tk[1]}`);
    }
    this.emit(tk[1]);
    this.track(tk[1]);
  }

  /**
   * Track bracket depth
   */
  track(token) {
    if (token === '{') this.braceDepth++;
    else if (token === '}') this.braceDepth--;
  }

  /**
   * Parse entire block
   */
  parseBlock(stopTokens = []) {
    while (true) {
      const tk = this.peek();
      if (tk[0] === null) {
        if (stopTokens.length) {
          this.fail(`eof, wanted ${stopTokens.join('/')}`);
        }
        return;
      }
      if (tk[0] === 'KW' && stopTokens.includes(tk[1])) return;
      if (tk[0] === 'KW' && ['end', 'else', 'elseif', 'until'].includes(tk[1])) {
        this.fail(`unexpected ${tk[1]}`);
      }
      this.parseStmt();
    }
  }

  /**
   * Parse a statement
   */
  parseStmt() {
    const tk = this.peek();

    if (tk[0] === 'KW' && tk[1] === 'local') {
      this.parseLocal();
    } else if (tk[0] === 'KW' && tk[1] === 'function') {
      this.parseFunction();
    } else if (tk[0] === 'KW' && tk[1] === 'if') {
      this.parseIf();
    } else if (tk[0] === 'KW' && tk[1] === 'while') {
      this.parseWhile();
    } else if (tk[0] === 'KW' && tk[1] === 'for') {
      this.parseFor();
    } else if (tk[0] === 'KW' && tk[1] === 'repeat') {
      this.parseRepeat();
    } else if (tk[0] === 'KW' && tk[1] === 'do') {
      this.parseDo();
    } else {
      this.parseTail();
    }
  }

  /**
   * Parse local declaration
   */
  parseLocal() {
    this.next();
    const tk = this.peek();

    if (tk[0] === 'KW' && tk[1] === 'function') {
      this.next();
      this.emit('local');
      this.emit('function');
      const tok = this.next();
      this.emit(this.scope.declare(tok[1]));
      this.parseBody();
      return;
    }

    const names = [];
    while (true) {
      const tok = this.next();
      if (tok[0] !== 'ID') {
        this.fail(`bad local name ${tok[1]}`);
      }
      names.push(tok[1]);
      const nextTk = this.peek();
      if (nextTk[0] === 'SYM' && nextTk[1] === ',') {
        this.next();
        continue;
      }
      break;
    }

    const nextTk = this.peek();
    if (nextTk[0] === 'SYM' && nextTk[1] === '=') {
      this.next();
      // Parse initializer expressions
      this.parseExprList();
      // Declare names after parsing expressions (scoping rule)
      this.emit('local');
      for (let i = 0; i < names.length; i++) {
        if (i) this.emit(',');
        this.emit(this.scope.declare(names[i]));
      }
    } else {
      this.emit('local');
      for (let i = 0; i < names.length; i++) {
        if (i) this.emit(',');
        this.emit(this.scope.declare(names[i]));
      }
    }
  }

  /**
   * Parse expression list
   */
  parseExprList() {
    // Simplified: just emit tokens until we hit a block keyword
    let depth = 0;
    while (true) {
      const tk = this.peek();
      if (tk[0] === null) break;

      if (tk[0] === 'SYM' && ['(', '[', '{'].includes(tk[1])) depth++;
      else if (tk[0] === 'SYM' && [')', ']', '}'].includes(tk[1])) depth--;

      if (depth === 0 && tk[0] === 'KW' && BLOCK_KW.has(tk[1])) break;

      this.emitToken(this.next());
    }
  }

  /**
   * Parse function definition
   */
  parseFunction() {
    this.next();
    this.emit('function');
    const tk = this.peek();

    if (tk[0] === 'ID') {
      this.next();
      this.emitId(tk[1]);
      // Handle table.field or table:method
      while (true) {
        const nextTk = this.peek();
        if (nextTk[0] === 'SYM' && ['.', ':'].includes(nextTk[1])) {
          this.next();
          this.emit(nextTk[1]);
          const tok = this.next();
          this.emit(tok[1]);
        } else {
          break;
        }
      }
    }

    this.parseBody();
  }

  /**
   * Parse function body
   */
  parseBody() {
    this.expect('(');
    this.scope.push();

    while (true) {
      const tok = this.next();
      const [k, t] = tok;

      if (k === 'SYM' && t === ')') {
        this.emit(')');
        break;
      }
      if (k === 'SYM' && t === ',') {
        this.emit(',');
        continue;
      }
      if (k === 'SYM' && t === '...') {
        this.emit('...');
        continue;
      }
      if (k === 'ID') {
        this.emit(this.scope.declare(t));
        continue;
      }
      this.fail(`bad param ${t}`);
    }

    this.parseBlock(['end']);
    this.expect('end');
    this.scope.pop();
  }

  /**
   * Parse if statement
   */
  parseIf() {
    this.next();
    this.emit('if');
    this.parseUntilKw('then');
    this.expect('then');

    while (true) {
      this.scope.push();
      this.parseBlock(['elseif', 'else', 'end']);
      this.scope.pop();

      const tk = this.peek();
      if (tk[0] === 'KW' && tk[1] === 'elseif') {
        this.next();
        this.emit('elseif');
        this.parseUntilKw('then');
        this.expect('then');
        continue;
      }
      if (tk[0] === 'KW' && tk[1] === 'else') {
        this.next();
        this.emit('else');
        continue;
      }
      this.expect('end');
      return;
    }
  }

  /**
   * Parse while loop
   */
  parseWhile() {
    this.next();
    this.emit('while');
    this.parseUntilKw('do');
    this.expect('do');
    this.scope.push();
    this.parseBlock(['end']);
    this.expect('end');
    this.scope.pop();
  }

  /**
   * Parse repeat-until loop
   */
  parseRepeat() {
    this.next();
    this.emit('repeat');
    this.scope.push();
    this.parseBlock(['until']);
    this.expect('until');
    this.parseUntilKw(';');
    this.scope.pop();
  }

  /**
   * Parse do block
   */
  parseDo() {
    this.next();
    this.emit('do');
    this.scope.push();
    this.parseBlock(['end']);
    this.expect('end');
    this.scope.pop();
  }

  /**
   * Parse for loop
   */
  parseFor() {
    this.next();
    const names = [];

    while (true) {
      const tok = this.next();
      if (tok[0] !== 'ID') {
        this.fail('bad for name');
      }
      names.push(tok[1]);
      const tk = this.peek();
      if (tk[0] === 'SYM' && tk[1] === ',') {
        this.next();
        continue;
      }
      break;
    }

    const tk = this.peek();
    let mode;
    if (tk[0] === 'SYM' && tk[1] === '=') mode = '=';
    else if (tk[0] === 'KW' && tk[1] === 'in') mode = 'in';
    else this.fail('bad for header');

    this.next();
    this.emit('for');

    // Declare loop variables
    for (let i = 0; i < names.length; i++) {
      if (i) this.emit(',');
      this.emit(this.scope.declare(names[i]));
    }

    this.emit(mode);
    this.parseUntilKw('do');
    this.expect('do');
    this.scope.push();
    this.parseBlock(['end']);
    this.expect('end');
    this.scope.pop();
  }

  /**
   * Parse until a keyword is reached
   */
  parseUntilKw(stop) {
    while (true) {
      const tk = this.peek();
      const [k, t] = tk;

      if (k === null) this.fail(`eof seeking ${stop}`);
      if (k === 'KW' && t === 'function') {
        this.parseFunction();
        continue;
      }
      if (k === 'KW' && ['if', 'while', 'for', 'repeat'].includes(t)) {
        this.parseStmt();
        continue;
      }
      if (k === 'KW' && t === stop) return;

      this.emitToken(this.next());
    }
  }

  /**
   * Parse tail (expression sequence)
   */
  parseTail() {
    while (true) {
      const tk = this.peek();
      const [k, t] = tk;

      if (k === null) return;
      if (k === 'KW' && ['end', 'else', 'elseif', 'until'].includes(t)) return;
      if (k === 'KW' && ['local', 'function', 'if', 'while', 'for', 'repeat', 'do'].includes(t)) {
        this.parseStmt();
        continue;
      }

      this.emitToken(this.next());
    }
  }

  /**
   * Emit a single token with transformations
   */
  emitToken(tok) {
    const [k, t] = tok;

    if (k === 'STR' || k === 'LSTR') {
      this.emitString(tok);
    } else if (k === 'NUM') {
      this.emitNumber(t);
    } else if (k === 'ID') {
      this.emitId(t);
    } else {
      this.emit(t);
      this.track(t);
    }
  }

  /**
   * Emit identifier (possibly renamed)
   */
  emitId(name) {
    if (this.prevToken !== '.' && this.prevToken !== ':') {
      const la = this.look(0);
      if (!(la[1] === '=' && this.braceDepth > 0)) {
        const obfuscated = this.options.rename ? this.scope.resolve(name) : null;
        if (obfuscated) {
          this.emit(obfuscated);
          this.scope.stats.renamed++;
          return;
        }
      }
    }
    this.emit(name);
  }

  /**
   * Emit string (possibly encrypted)
   */
  emitString(tok) {
    // For now, emit as-is (encryption will be added in transformers)
    this.emit(tok[1]);
    this.stats.str_plain++;
  }

  /**
   * Emit number (possibly mangled)
   */
  emitNumber(text) {
    if (this.options.numbers && /^[0-9]+$/.test(text)) {
      const v = parseInt(text, 10);
      if (v < 2147483648) {
        if (this.options.rng && this.options.rng.nextFloat() < 0.5) {
          this.emit(`0x${v.toString(16)}`);
        } else if (this.options.rng) {
          const a = this.options.rng.nextInt(v + 1);
          this.emit(`(${a}+${v - a})`);
        } else {
          this.emit(`0x${v.toString(16)}`);
        }
        this.stats.num_mangled++;
        return;
      }
    }
    this.emit(text);
  }

  /**
   * Get the output as array
   */
  getOutput() {
    return this.output;
  }

  /**
   * Get statistics
   */
  getStats() {
    return this.stats;
  }
}
