import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

/**
 * Public, read-only download of the agent skill so the connect page can offer one-line installs.
 * Only these files are served; they hold behaviour rules and a git helper script, no secrets.
 */
export const SKILL_FILES: Record<string, string> = {
  'agentcowork/SKILL.md': 'text/markdown; charset=utf-8',
  'agentcowork/scripts/repo-info.sh': 'text/x-shellscript; charset=utf-8',
  'prompt.md': 'text/markdown; charset=utf-8',
};

/** Published package ships the skill in `skill/`; in the monorepo it is `<repo>/skill`. */
export function defaultSkillRoot(): string | undefined {
  // src/transports/http/skill.ts and dist/transports/http/skill.js are both 3 levels below the package.
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  return [join(pkgRoot, 'skill'), join(pkgRoot, '..', '..', 'skill')].find((dir) =>
    existsSync(join(dir, 'agentcowork', 'SKILL.md')),
  );
}

export function registerSkillRoutes(app: FastifyInstance, root: string | undefined) {
  if (!root) return;
  for (const [file, type] of Object.entries(SKILL_FILES)) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const body = readFileSync(path);
    app.get(`/skill/${file}`, async (_req, reply) =>
      reply.header('content-type', type).header('cache-control', 'no-cache').send(body),
    );
  }
}
