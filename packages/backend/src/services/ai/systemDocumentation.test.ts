import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearSystemDocumentationCache,
  getSystemDocumentationExcerpt,
} from './systemDocumentation';

describe('systemDocumentation', () => {
  beforeEach(() => {
    clearSystemDocumentationCache();
  });

  it('prioritizes AI safety and Super Admin sections in Super Admin context', () => {
    const excerpt = getSystemDocumentationExcerpt(undefined, 'SUPER_ADMIN');

    expect(excerpt).toContain('Current AI safety contract');
    expect(excerpt).toContain('No fake action success');
    expect(excerpt).toContain('Super Admin `@` command center');
    expect(excerpt).toContain('AI grounding and action safety');
  });
});
