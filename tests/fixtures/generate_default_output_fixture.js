'use strict';
// Regenerates tests/fixtures/default_output_sha256.json from a baseline engine: the engine at the commit
// before the single-line formatter was added. Usage: node tests/fixtures/generate_default_output_fixture.js <baseline-engine.js>
// Each entry is the SHA-256 of the default (singleLine off) output for one corpus file, configuration, and seed,
// so the current engine can be checked for byte-identical default output.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const SEEDS = [17, 18];
const CONFIGS = [
  { name: 'maximum-vm', o: { profile: 'maximum', vm: true } },
  { name: 'maximum-vm-nostrings', o: { profile: 'maximum', vm: true, strings: false } },
  { name: 'maximum', o: { profile: 'maximum' } },
  { name: 'minimal', o: { profile: 'minimal' } },
];
const CORPUS_DIRS = ['samples', 'diff_cases', 'luau_cases', 'workloads', 'edge'];
function sha(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }
function corpusFiles() {
  const base = path.join(ROOT, 'tests', 'fixtures', 'corpus');
  return CORPUS_DIRS.flatMap(d => fs.readdirSync(path.join(base, d)).filter(n => n.endsWith('.lua')).sort().map(n => path.join(base, d, n)));
}
function corpusAndConfigs() {
  return corpusFiles().flatMap(f => CONFIGS.flatMap(cfg => SEEDS.map(seed => ({
    key: path.relative(ROOT, f) + '|' + cfg.name + '|' + seed,
    hash: (eng) => {
      const src = fs.readFileSync(f, 'utf8');
      try { return sha(eng.obfuscate(src, seed, cfg.o).code); }
      catch (e) { return 'REFUSED:' + e.message; }
    }
  }))));
}
module.exports = { corpusAndConfigs, sha, CONFIGS, SEEDS, CORPUS_DIRS };
if (require.main === module) {
  const engine = require(path.resolve(process.argv[2]));
  const out = { note: 'default output of the engine before the single-line formatter (git main 4cc06879…, engine blob c545ceff…)', entries: {} };
  for (const c of corpusAndConfigs()) out.entries[c.key] = c.hash(engine);
  fs.writeFileSync(path.join(__dirname, 'default_output_sha256.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('entries', Object.keys(out.entries).length);
}
