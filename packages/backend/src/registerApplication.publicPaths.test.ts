import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';

const REQUIRED_PUBLIC_AI_PATHS = [
  '/api/v1/ai/query',
  '/api/v1/ai/query-with-image',
  '/api/v1/ai/generate-image',
  '/api/v1/ai/voice',
];

describe('registerApplication PUBLIC_PATHS', () => {
  it('exposes AI vision and image routes without global JWT', async () => {
    const src = await readFile(new URL('./registerApplication.ts', import.meta.url), 'utf8');
    for (const p of REQUIRED_PUBLIC_AI_PATHS) {
      expect(src).toContain(`'${p}'`);
    }
  });
});
