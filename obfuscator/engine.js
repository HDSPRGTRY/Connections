/**
 * GNG Obfuscator - Entry Point
 * Modern ES6+ version using modular architecture
 *
 * This file provides compatibility for both:
 * - Browser: Uses ES6 modules via <script type="module">
 * - Node.js: Uses dynamic import() (Node 12+)
 *
 * The actual implementation is in modules/index.js
 */

// Resolve the module URL against the document base (not the script URL:
// dynamic import() in a classic <script> resolves relative to the page).
// The page lives at /obfuscator (no trailing slash), so a relative
// './modules/index.js' used to resolve to /modules/index.js by accident and
// broke as soon as the URL gained a trailing slash or the file moved.
// An absolute path is stable for every page URL on this deploy.
function moduleUrl() {
  if (typeof document !== 'undefined' && document.baseURI) {
    try { return new URL('/modules/index.js', document.baseURI).href; }
    catch (e) { /* fall through */ }
    return '/modules/index.js';
  }
  // Node.js: keep file-relative import (resolves against this file).
  return './modules/index.js';
}

async function getObfuscator() {
  const url = moduleUrl();
  try {
    const modules = await import(/* webpackIgnore: true */ url);
    return modules.default || modules.gngObfuscate;
  } catch (e) {
    // Retry with a script-relative URL for local file:// testing
    // (document.baseURI is a file: URL there).
    if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) {
      try {
        const fallback = new URL('./modules/index.js', document.currentScript.src).href;
        if (fallback !== url) {
          const modules = await import(/* webpackIgnore: true */ fallback);
          return modules.default || modules.gngObfuscate;
        }
      } catch (e2) { /* report original below */ }
    }
    throw new Error(
      'Could not load obfuscator engine at ' + url +
      ' (server must serve /modules/*.js as application/javascript). ' +
      'Original: ' + (e && e.message ? e.message : e)
    );
  }
}

// Browser environment
if (typeof window !== 'undefined') {
  window.gngObfuscate = async function(src, seed, opts) {
    const obf = await getObfuscator();
    return obf(src, seed, opts);
  };
}

// Node.js environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = async function(src, seed, opts) {
    const obf = await getObfuscator();
    return obf(src, seed, opts);
  };
}
