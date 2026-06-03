import { describe, expect, it } from 'vitest';
import { parseAiMessageSegments } from './aiMessageContent';

describe('parseAiMessageSegments', () => {
  it('parses markdown links', () => {
    const segs = parseAiMessageSegments('Click [Register Ken](https://app.example.com/register/tok)');
    expect(segs).toEqual([
      { kind: 'text', value: 'Click ' },
      { kind: 'link', label: 'Register Ken', href: 'https://app.example.com/register/tok' },
    ]);
  });

  it('linkifies bare https URLs', () => {
    const segs = parseAiMessageSegments('URL: https://app.example.com/register/abc');
    expect(segs[1]).toEqual({
      kind: 'link',
      label: 'https://app.example.com/register/abc',
      href: 'https://app.example.com/register/abc',
    });
  });

  it('prefers markdown over double-linkifying', () => {
    const segs = parseAiMessageSegments('[Open](https://x.com/register/t1)');
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('link');
  });
});
