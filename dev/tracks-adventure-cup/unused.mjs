// node dev/tracks-adventure-cup/unused.mjs <files...> — crude unused-import / unused-ctx-field finder
import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const s = fs.readFileSync(f, 'utf8');
  const names = [];
  for (const m of s.matchAll(/import\s*\{([^}]+)\}\s*from/g)) names.push(...m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  const body = s.replace(/import[\s\S]*?from\s*'[^']+';/g, '');
  const unused = names.filter((n) => !new RegExp(`\\b${n}\\b`).test(body));
  const dUnused = [];
  for (const d of s.match(/const \{([^}]+)\} = ctx;/g) || []) {
    const fields = d.replace(/const \{|\} = ctx;/g, '').split(',').map((x) => x.trim()).filter(Boolean);
    const rest = s.replace(d, '');
    for (const fld of fields) if (!new RegExp(`\\b${fld}\\b`).test(rest)) dUnused.push(fld);
  }
  console.log(f, '| unused imports:', unused.join(', ') || '-', '| unused ctx:', dUnused.join(', ') || '-');
}
