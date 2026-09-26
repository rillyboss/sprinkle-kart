// dev: triangles per source line for racers:  npx vite-node dev/characters-b/tribreak.mjs <id> [id...]
import { Kit } from '../../src/characters/parts.js';
import { CHARACTERS } from '../../src/data/characters.js';
import { buildKartModel } from '../../src/render/characterModels.js';
for (const id of process.argv.slice(2)) {
  const by = new Map();
  const orig = Kit.prototype.add;
  Kit.prototype.add = function (target, geo, mat, o = {}) {
    const line = new Error().stack.split('\n').slice(2).find((l) => l.includes(`${id}.js`) || l.includes('parts.js')) || '?';
    const key = line.replace(/.*[\\/]([\w-]+\.js):(\d+).*/, '$1:$2');
    const n = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const r = orig.call(this, target, geo, mat, o);
    const b = this.buckets.get(target);
    const ol = b[b.length - 1].ol ? n : 0;
    by.set(key, (by.get(key) || 0) + n + ol);
    return r;
  };
  const m = buildKartModel(CHARACTERS.find((c) => c.id === id));
  Kit.prototype.add = orig;
  console.log('==', id, 'total', m.triangles);
  [...by].sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, v]) => console.log(String(Math.round(v)).padStart(6), k));
}
