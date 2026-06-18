export interface ExamScoreComponent {
  examType: string;
  score: number;
  maxScore: number;
}

export interface SubjectFinalScore {
  catAverage: number | null;
  practicalScore: number | null;
  endTermScore: number | null;
  finalScore: number;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalise(score: number, maxScore: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return 0;
  return Math.max(0, Math.min(100, (score / maxScore) * 100));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeSubjectFinalScore(components: ExamScoreComponent[]): SubjectFinalScore {
  const catScores: number[] = [];
  const practicalScores: number[] = [];
  const endTermScores: number[] = [];

  for (const component of components) {
    const normalised = normalise(component.score, component.maxScore);
    if (component.examType.startsWith('CAT')) {
      catScores.push(normalised);
    } else if (component.examType.startsWith('PRACTICAL')) {
      practicalScores.push(normalised);
    } else if (component.examType === 'END_TERM') {
      endTermScores.push(normalised);
    }
  }

  const catAverage = average(catScores);
  const practicalScore = average(practicalScores);
  const endTermScore = average(endTermScores);

  const weightedParts: Array<{ value: number; weight: number }> = [];
  if (practicalScore !== null) {
    if (catAverage !== null) weightedParts.push({ value: catAverage, weight: 30 });
    weightedParts.push({ value: practicalScore, weight: 20 });
    if (endTermScore !== null) weightedParts.push({ value: endTermScore, weight: 50 });
  } else {
    if (catAverage !== null) weightedParts.push({ value: catAverage, weight: 30 });
    if (endTermScore !== null) weightedParts.push({ value: endTermScore, weight: 70 });
  }

  const totalWeight = weightedParts.reduce((sum, part) => sum + part.weight, 0);
  const finalScore = totalWeight > 0
    ? weightedParts.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight
    : 0;

  return {
    catAverage: catAverage === null ? null : roundScore(catAverage),
    practicalScore: practicalScore === null ? null : roundScore(practicalScore),
    endTermScore: endTermScore === null ? null : roundScore(endTermScore),
    finalScore: roundScore(finalScore),
  };
}
