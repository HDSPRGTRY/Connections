/* GNG obfuscator engine - single-target Lua/Luau source transformer.
 *
 * Shared by the hosted page (public/obfuscator.html) and server-side use.
 * ES3-compatible on purpose (runs in any browser, Node, and cscript).
 *
 * What it does: strips comments, renames every `local`-scoped identifier
 * with scope-correct resolution, encrypts string literals (per-literal
 * random additive key, hex), mangles plain integers, prepends a tiny
 * additive decryptor + dead locals.
 *
 * Semantics-preserving by construction: globals, _G fields, table fields
 * (after . or :), method names, `self`, and cross-chunk bare globals are
 * never renamed (only `local`-declared names are, and those cannot escape
 * the chunk). `local x = <init>` initializers resolve against the OUTER
 * scope; `for` bounds are transformed before loop vars are declared;
 * `repeat..until` conditions see the body scope. Table keys `"k" =` stay
 * plaintext (syntax requirement); `["k"]` becomes `[decrypt(...)]`.
 *
 * Throws Error(...) on constructs outside the supported subset instead of
 * emitting broken code. Re-run with a new seed for a fresh layout.
 *
 * API: gngObfuscate(source, seed, opts) -> {code, stats}
 *   opts: {rename:bool, strings:bool, numbers:bool,
 *          place:number (0 = unbound), user:number (0 = unbound),
 *          decoys:number (fake secrets, decrypted but never used),
 *          require:string (dotted game path waited on, '' = off)}
 *
 * Keystream: every blob mixes its position (byte + key + salt + idx*7),
 * so no two strings share reversible math. Pool: literals live in one
 * shuffled closure pool with fake entries; use sites are bare indices.
 *
 * Environment binding (anti-dump): when place and/or user is given, every
 * string is encrypted with an extra salt derived from those values, and the
 * emitted stub recomputes the salt from the LIVE game and halts the whole
 * chunk on any mismatch or missing executor/game/character/engine fidelity.
 * A sandbox gets zero strings and no stages. Residues (mod 251) are baked,
 * never the raw ids. Clearing both fields restores legacy behavior.
 * Public-safe: with no UserId bound, output runs for every player of the
 * bound game but still refuses sandboxes (place residue + live character +
 * datatype fidelity + VM sanity).
 */
(function (root, factory) {
  var f = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = f; }
  else { root.gngObfuscate = f; }
}(typeof self !== 'undefined' ? self : this, function () {

function gngObfuscate(src, seed, opts) {
  // ... (original implementation would be here)
  // This is a placeholder - see modules/ for the modern ES6+ version
  throw new Error('Please use the modern version in modules/index.js');
}

return gngObfuscate;
}));
