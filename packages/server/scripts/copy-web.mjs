// Copies the built Web UI and the agent skill into this package so the published CLI can serve them.
import { cpSync, existsSync, rmSync } from 'node:fs';

const webFrom = new URL('../../web/dist/', import.meta.url);
const webTo = new URL('../web/', import.meta.url);
rmSync(webTo, { recursive: true, force: true });
if (existsSync(new URL('index.html', webFrom))) {
  cpSync(webFrom, webTo, { recursive: true });
  console.log('copied web UI into packages/server/web');
} else {
  console.log('web UI not built; skipping copy');
}

// The connect page tells teammates to curl these files from the hub (GET /skill/...).
const skillFrom = new URL('../../../skill/', import.meta.url);
const skillTo = new URL('../skill/', import.meta.url);
rmSync(skillTo, { recursive: true, force: true });
cpSync(skillFrom, skillTo, { recursive: true });
console.log('copied agent skill into packages/server/skill');
