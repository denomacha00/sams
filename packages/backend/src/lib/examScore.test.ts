import { describe, expect, it } from 'vitest';
import { computeSubjectFinalScore } from './examScore';

describe('computeSubjectFinalScore', () => {
  it('uses CAT and end-term weighting when no practical exists', () => {
    const score = computeSubjectFinalScore([
      { examType: 'CAT1', score: 20, maxScore: 40 },
      { examType: 'CAT2', score: 30, maxScore: 60 },
      { examType: 'END_TERM', score: 70, maxScore: 100 },
    ]);

    expect(score).toEqual({
      catAverage: 50,
      practicalScore: null,
      endTermScore: 70,
      finalScore: 64,
    });
  });

  it('averages practical 1-3 and includes them only when present', () => {
    const score = computeSubjectFinalScore([
      { examType: 'CAT1', score: 20, maxScore: 40 },
      { examType: 'PRACTICAL1', score: 8, maxScore: 10 },
      { examType: 'PRACTICAL2', score: 18, maxScore: 20 },
      { examType: 'END_TERM', score: 70, maxScore: 100 },
    ]);

    expect(score).toEqual({
      catAverage: 50,
      practicalScore: 85,
      endTermScore: 70,
      finalScore: 67,
    });
  });
});
