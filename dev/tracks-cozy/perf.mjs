// Draw calls / triangles from the dev track preview (chase + top views), originals vs Cozy Cup.
// Needs `npx vite --port 5221 --strictPort` running.
import { chromium } from 'playwright';
const ids = ['cotton-candy-castle', 'gumdrop-meadow', 'starlight-galaxy', 'sundae-slopes', 'pumpkin-patch', 'teacup-garden', 'peppermint-village', 'pillow-fort'];
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const id of ids) {
  const row = [id];
  for (const view of ['chase', 'top']) {
    const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const info = new Promise((res) => pg.on('console', (m) => { if (m.text().startsWith('info')) res(JSON.parse(m.text().slice(5))); }));
    await pg.goto(`http://localhost:5221/dev/tracks/index.html?track=${id}&view=${view}`);
    const i = await Promise.race([info, new Promise((r) => setTimeout(() => r({}), 30000))]);
    row.push(`${view}: calls ${i.calls} tris ${i.tris} build ${i.buildMs}ms`);
    await pg.close();
  }
  console.log(row.join(' | '));
}
await b.close();
