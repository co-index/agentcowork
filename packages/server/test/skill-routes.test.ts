import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultSkillRoot, registerSkillRoutes } from '../src/transports/http/skill.js';

describe('skill download routes', () => {
  const app = Fastify();
  const root = mkdtempSync(join(tmpdir(), 'acw-skill-'));

  beforeAll(async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(root, 'agentcowork', 'scripts'), { recursive: true });
    writeFileSync(join(root, 'agentcowork', 'SKILL.md'), '# skill');
    writeFileSync(join(root, 'agentcowork', 'scripts', 'repo-info.sh'), '#!/bin/sh\n');
    writeFileSync(join(root, 'prompt.md'), '# prompt\n---\nrules');
    writeFileSync(join(root, 'README.md'), 'not served');
    registerSkillRoutes(app, root);
    await app.ready();
  });
  afterAll(() => app.close());

  it('serves the allowlisted files without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/skill/agentcowork/SKILL.md' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('# skill');
    expect(res.headers['content-type']).toContain('text/markdown');
    expect((await app.inject({ method: 'GET', url: '/skill/prompt.md' })).body).toContain('rules');
    expect(
      (await app.inject({ method: 'GET', url: '/skill/agentcowork/scripts/repo-info.sh' }))
        .statusCode,
    ).toBe(200);
  });

  it('does not serve other files or traverse paths', async () => {
    for (const url of ['/skill/README.md', '/skill/../package.json', '/skill/agentcowork/']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  it('finds the repository skill directory by default', () => {
    expect(defaultSkillRoot()).toMatch(/skill$/);
  });
});
