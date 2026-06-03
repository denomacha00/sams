import { describe, expect, it } from 'vitest';
import {
  formatStudentClassContextForPrompt,
  formatStudentTeachersAnswer,
  type StudentClassContext,
} from './studentClassTeachers';

describe('studentClassTeachers formatting', () => {
  const sampleCtx: StudentClassContext = {
    classId: 'class-1',
    className: 'Form 2B',
    teachers: [
      { id: 't1', fullName: 'Ms. Wanjiku', subjects: ['Mathematics', 'Physics'], isClassTeacher: true },
      { id: 't2', fullName: 'Mr. Otieno', subjects: ['English'], isClassTeacher: false },
    ],
  };

  it('formatStudentTeachersAnswer lists class teacher and subjects', () => {
    const answer = formatStudentTeachersAnswer(sampleCtx);
    expect(answer).toContain('Form 2B');
    expect(answer).toContain('Ms. Wanjiku');
    expect(answer).toContain('class teacher');
    expect(answer).toContain('Mathematics');
    expect(answer).toContain('Mr. Otieno');
    expect(answer).toContain('show my timetable');
  });

  it('formatStudentClassContextForPrompt is compact for LLM', () => {
    const line = formatStudentClassContextForPrompt(sampleCtx);
    expect(line).toContain('Form 2B');
    expect(line).toContain('Ms. Wanjiku');
    expect(line).toContain('class teacher');
  });

  it('handles empty teacher list', () => {
    const empty: StudentClassContext = { classId: 'c', className: 'Form 1A', teachers: [] };
    expect(formatStudentTeachersAnswer(empty)).toContain('Form 1A');
    expect(formatStudentTeachersAnswer(empty)).toContain('no teachers');
  });
});
