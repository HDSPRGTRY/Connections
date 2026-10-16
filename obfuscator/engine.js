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

async function getObfuscator() {
  const modules = await import('./modules/index.js');
  return modules.default;
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
