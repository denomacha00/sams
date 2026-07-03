import { describe, expect, it } from 'vitest';
import { sanitizeLlmOutput } from './openaiEngine';

describe('sanitizeLlmOutput', () => {
  it('rewrites provider identity drift to a short SAMS identity answer', () => {
    const answer = sanitizeLlmOutput('I am an AI assistant from Indus Valley built by Atomesus.');

    expect(answer).toBe("I'm SAMS AI. Denis Macharia built me, and Denis is my boss.");
    expect(answer).not.toMatch(/Indus|Atomesus|OpenAI|Groq|OpenRouter/i);
  });
});
