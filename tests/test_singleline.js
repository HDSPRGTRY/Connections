'use strict';
// Single-line output: default-output fingerprints, formatter cases, behaviour under Luau, and refusals.
// Requires Node 18+ (node:test). Luau checks run only when LUAU_BIN points at a Luau CLI; otherwise they are skipped with a reason.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const ROOT = path.join(__dirname, '..');
const ENGINE_PATH = path.join(ROOT, 'obfuscator', 'engine.js');
const engine = require(ENGINE_PATH);
const L = process.env.LUAU_BIN;
const skipLuau = { skip: !L && 'set LUAU_BIN to a Luau CLI to run the Luau checks' };
const FIX = path.join(__dirname, 'fixtures');

// The formatter under test is extracted from the shipped engine text (not a copy).
const toSingleLine = (() => {
  const text = fs.readFileSync(ENGINE_PATH, 'utf8');
  const a = text.indexOf('function slRefuse'), b = text.indexOf('\r\nfunction obfuscate(src, seed, opts)');
  if (a < 0 || b < 0) throw new Error('formatter block not found in engine');
  return new Function(text.slice(a, b).replace(/\r\n/g, '\n') + '\nreturn toSingleLine;')();
})();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'singleline-'));
let counter = 0;
function runLua(src) {
  const f = path.join(tmp, 'r' + (counter++) + '.lua');
  fs.writeFileSync(f, src, 'utf8');
  try { return { s: 0, o: cp.execFileSync(L, [f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { s: e.status, o: (e.stdout || '') + '|ERR|' + (e.stderr || '') }; }
}
const norm = (s) => s.replace(/\S*?\.lua:\d+/g, 'CHUNK:N');

// 1. Default output is byte-identical to the baseline (fingerprints recorded from it).
test('default output matches the baseline fingerprints for the corpus', () => {
  const gen = require(path.join(FIX, 'generate_default_output_fixture.js'));
  const expected = JSON.parse(fs.readFileSync(path.join(FIX, 'default_output_sha256.json'), 'utf8')).entries;
  const mismatches = [];
  for (const c of gen.corpusAndConfigs()) {
    if (c.hash(engine) !== expected[c.key]) mismatches.push(c.key);
  }
  assert.deepEqual(mismatches, [], 'default output changed for these cases');
});

test('default options do not add a format key to stats', () => {
  const r = engine.obfuscate('print(1)\n', 17, { profile: 'maximum', vm: true });
  assert.equal('format' in r.stats, false);
});

test('singleLine: true adds stats.format = single-line', () => {
  const r = engine.obfuscate('print(1)\n', 17, { profile: 'maximum', vm: true, singleLine: true });
  assert.equal(r.stats.format, 'single-line');
});

// 2. Formatter cases: valid inputs keep behaviour and contain no LF/CR; invalid inputs are refused with a message.
const CASES = require(path.join(FIX, 'singleline', 'cases.js'));
for (const [name, src, kind] of CASES) {
  test(`formatter: ${name}`, skipLuau, () => {
    if (kind === 'refuse') {
      assert.throws(() => toSingleLine(src), /single-line output refused/);
      return;
    }
    const out = toSingleLine(src);
    assert.equal(/[\r\n]/.test(out), false, 'formatted output must contain no LF or CR');
    const a = runLua(src), b = runLua(out);
    assert.equal(b.s, a.s); assert.equal(b.o, a.o);
  });
}

test('formatter: seeded random valid programs keep behaviour and contain no LF/CR', skipLuau, () => {
  const progs = JSON.parse(fs.readFileSync(path.join(FIX, 'singleline', 'fuzz_programs.json'), 'utf8'));
  progs.forEach((p, i) => {
    const out = toSingleLine(p);
    assert.equal(/[\r\n]/.test(out), false, 'program ' + i);
    const a = runLua(p), b = runLua(out);
    assert.equal(b.s, a.s, 'exit status, program ' + i);
    assert.equal(b.o, a.o, 'output, program ' + i);
  });
});

// 3. Obfuscator output with singleLine: zero LF/CR, same behaviour as multiline after normalizing positions.
const CORPUS = ['samples', 'diff_cases', 'luau_cases', 'workloads', 'edge'].flatMap(d =>
  fs.readdirSync(path.join(FIX, 'corpus', d)).filter(n => n.endsWith('.lua')).sort().map(n => path.join(FIX, 'corpus', d, n)));
for (const f of CORPUS) {
  test(`singleLine output: ${path.relative(FIX, f)}`, skipLuau, () => {
    const src = fs.readFileSync(f, 'utf8');
    for (const o of [{ profile: 'maximum', vm: true }, { profile: 'maximum', vm: true, strings: false }]) {
      let m;
      try { m = engine.obfuscate(src, 17, o).code; } catch (e) { return; } // refused in both modes (see the fingerprint test)
      const s = engine.obfuscate(src, 17, { ...o, singleLine: true }).code;
      assert.equal(/[\r\n]/.test(s), false, 'single-line output must contain no LF or CR');
      const rm = runLua(m), rs = runLua(s);
      assert.equal(rs.s, rm.s);
      assert.equal(norm(rs.o), norm(rm.o));
    }
  });
}

// 4. Refusals: unsupported input is refused in both modes with the same message (no silent multiline fallback).
test('unsupported input is refused in both modes with the same message', () => {
  for (const src of ['#!/usr/bin/env lua\nprint(1)\n', 'print(1)\n--[[ open\nprint(2)\n']) {
    let d = null, s = null;
    try { engine.obfuscate(src, 17, { profile: 'maximum', vm: true }); } catch (e) { d = e.message; }
    try { engine.obfuscate(src, 17, { profile: 'maximum', vm: true, singleLine: true }); } catch (e) { s = e.message; }
    assert.ok(d !== null, 'default mode should refuse: ' + JSON.stringify(src));
    assert.equal(s, d);
  }
});

// 5. Documented behaviour: every reported line number is 1 in single-line output.
test('error position reports line 1 in single-line output (documented)', skipLuau, () => {
  const src = 'local a = 1\nlocal b = 2\nerror("boom")\n';
  const s = engine.obfuscate(src, 17, { profile: 'maximum', vm: true, singleLine: true }).code;
  const r = runLua(s);
  assert.match(r.o, /r\d+\.lua:1: boom/);
});

// 6. Formatter refusal messages carry the actionable hint.
test('formatter refusal messages say what to change', () => {
  let msg = '';
  try { toSingleLine('print("abc\n'); } catch (e) { msg = e.message; }
  assert.match(msg, /single-line output refused: .*Remove or rewrite .* turn singleLine off/);
});
