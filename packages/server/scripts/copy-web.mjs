// Copies the built Web UI into this package so the published CLI can serve it.
import { cpSync, existsSync, rmSync } from 'node:fs';

const from = new URL('../../web/dist/', import.meta.url);
const to = new URL('../web/', import.meta.url);
rmSync(to, { recursive: true, force: true });
if (existsSync(new URL('index.html', from))) {
  cpSync(from, to, { recursive: true });
  console.log('copied web UI into packages/server/web');
} else {
  console.log('web UI not built; skipping copy');
}
