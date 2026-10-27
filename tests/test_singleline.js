'use strict';
// End-to-end checks for the "Single-line output" toggle in public/obfuscator.html.
// Loads the real page in headless Chromium (Playwright), runs it through the UI,
// and compares the result with the engine called directly.
// Skips cleanly when Playwright or Chromium is not available.

var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var http = require('http');

var ROOT = path.join(__dirname, '..');
var engine = require(path.join(ROOT, 'obfuscator', 'engine.js'));

var chromium = null;
var skipReason = null;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  skipReason = 'playwright not installed';
}

var skipOpts = skipReason ? { skip: skipReason } : {};

var SAMPLE = fs.readFileSync(
  path.join(ROOT, 'tests', 'fixtures', 'corpus', 'samples', 's2_table_oop.lua'), 'utf8');

// Options the page passes with every control at its default (Fresh seed off, seed 7).
function pageDefaults(vm) {
  return {
    rename: true, strings: true, numbers: true,
    antitamper: true, antiDebug: true,
    place: 0, user: 0, decoys: 6,
    profile: 'medium', vm: !!vm,
  };
}

function startServer() {
  var html = fs.readFileSync(path.join(ROOT, 'public', 'obfuscator.html'));
  var engineSrc = fs.readFileSync(path.join(ROOT, 'obfuscator', 'engine.js'));
  var server = http.createServer(function (req, res) {
    var url = req.url.split('?')[0];
    if (url === '/' || url === '/obfuscator.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else if (url === '/engine.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(engineSrc);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, base: 'http://127.0.0.1:' + server.address().port + '/' });
    });
  });
}

// Runs the page once with the given UI state and returns {output, error}.
async function runPage(browser, base, opts) {
  var context = await browser.newContext();
  var page = await context.newPage();
  // No network access in the sandbox: block Google Fonts so the page does not stall.
  await page.route(/fonts\.g(oogleapis|static)\.com/, function (r) { r.abort(); });
  await page.goto(base);
  await page.fill('#src', opts.source === undefined ? SAMPLE : opts.source);
  await page.fill('#seed', '7');
  await page.evaluate(function () { document.getElementById('optFresh').checked = false; });
  // The switch inputs are visually hidden; click their labels like a user would.
  if (opts.vm) await page.click('label:has(#optVm)');
  if (opts.singleLine === true) await page.click('label:has(#optSingleLine)');
  // Wait for this run to finish: either the output changes or an error appears.
  var before = await page.inputValue('#dst');
  await page.click('#go');
  await page.waitForFunction(function (prev) {
    return document.getElementById('dst').value !== prev ||
      document.getElementById('err').textContent !== '';
  }, before, { timeout: 15000 });
  var result = await page.evaluate(function () {
    return {
      output: document.getElementById('dst').value,
      error: document.getElementById('err').textContent,
    };
  });
  await context.close();
  return result;
}

test('single-line toggle: present, labelled and off by default', skipOpts, async function (t) {
  var srv = await startServer();
  var browser = await chromium.launch();
  try {
    var context = await browser.newContext();
    var page = await context.newPage();
    await page.route(/fonts\.g(oogleapis|static)\.com/, function (r) { r.abort(); });
    await page.goto(srv.base);
    var label = await page.textContent('label:has(#optSingleLine)');
    assert.match(label, /Single-line output/);
    assert.strictEqual(await page.isChecked('#optSingleLine'), false);
    await context.close();
  } finally {
    await browser.close();
    srv.server.close();
  }
});

test('disabled (default): UI output is byte-identical to the engine without singleLine', skipOpts, async function () {
  var srv = await startServer();
  var browser = await chromium.launch();
  try {
    var ui = await runPage(browser, srv.base, {});
    assert.strictEqual(ui.error, '', 'page reported an error: ' + ui.error);
    var direct = engine.obfuscate(SAMPLE, 7, pageDefaults(false)).code;
    assert.strictEqual(ui.output, direct, 'default UI output differs from engine output');
    assert.ok(ui.output.length > 0);
  } finally {
    await browser.close();
    srv.server.close();
  }
});

test('enabled: UI passes singleLine and output has no CR or LF', skipOpts, async function () {
  var srv = await startServer();
  var browser = await chromium.launch();
  try {
    var ui = await runPage(browser, srv.base, { singleLine: true });
    assert.strictEqual(ui.error, '', 'page reported an error: ' + ui.error);
    assert.ok(!/[\r\n]/.test(ui.output), 'single-line output contains CR or LF');
    var direct = engine.obfuscate(SAMPLE, 7,
      Object.assign(pageDefaults(false), { singleLine: true })).code;
    assert.strictEqual(ui.output, direct, 'UI single-line output differs from engine output');
    assert.notStrictEqual(ui.output, engine.obfuscate(SAMPLE, 7, pageDefaults(false)).code,
      'toggle had no effect on output');
  } finally {
    await browser.close();
    srv.server.close();
  }
});

test('enabled with VM layer on: other options still apply and output has no CR or LF', skipOpts, async function () {
  var srv = await startServer();
  var browser = await chromium.launch();
  try {
    var ui = await runPage(browser, srv.base, { singleLine: true, vm: true });
    assert.strictEqual(ui.error, '', 'page reported an error: ' + ui.error);
    assert.ok(!/[\r\n]/.test(ui.output), 'single-line VM output contains CR or LF');
    var direct = engine.obfuscate(SAMPLE, 7,
      Object.assign(pageDefaults(true), { singleLine: true })).code;
    assert.strictEqual(ui.output, direct);
  } finally {
    await browser.close();
    srv.server.close();
  }
});

test('enabled with input the engine rejects: page shows FAILED and produces no output', skipOpts, async function () {
  // Note: the formatter runs on the generated code, so a "single-line refused" message is
  // only reachable when the generated output contains a refused construct. This checks the
  // page's error path with the toggle on; the formatter's own refusals are covered by
  // test_singleline.js.
  var srv = await startServer();
  var browser = await chromium.launch();
  try {
    var src = 'print([[abc\n';
    var ui = await runPage(browser, srv.base, { singleLine: true, source: src });
    assert.match(ui.error, /^FAILED: lex: unterminated long string/);
    assert.strictEqual(ui.output, '');
  } finally {
    await browser.close();
    srv.server.close();
  }
});

test('toggle state survives a reload when "Remember settings" is on', skipOpts, async function () {
  var srv = await startServer();
  var browser = await chromium.launch();
  try {
    var context = await browser.newContext();
    var page = await context.newPage();
    await page.route(/fonts\.g(oogleapis|static)\.com/, function (r) { r.abort(); });
    await page.goto(srv.base);
    await page.click('label:has(#optSingleLine)');
    // Fire the page's own save path (it saves on change of the remember checkbox).
    await page.evaluate(function () {
      document.getElementById('optRemember').dispatchEvent(new Event('change'));
    });
    await page.reload();
    assert.strictEqual(await page.isChecked('#optSingleLine'), true);
    await context.close();
  } finally {
    await browser.close();
    srv.server.close();
  }
});
