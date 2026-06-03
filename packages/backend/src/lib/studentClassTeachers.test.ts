import { describe, expect, it } from 'vitest';
import {
  formatStudentClassContextForPrompt,
  formatStudentHodAnswer,
  formatStudentTeachersAnswer,
  type StudentClassContext,
} from './studentClassTeachers';

describe('studentClassTeachers formatting', () => {
  const sampleCtx: StudentClassContext = {
    classId: 'class-1',
    className: 'Form 2B',
    departmentId: 'dept-science',
    departmentName: 'Sciences',
    hod: { id: 'hod-1', fullName: 'Dr. Kamau' },
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
    expect(line).toContain('Dr. Kamau');
    expect(line).toContain('HOD');
    expect(line).toContain('Sciences');
  });

  it('formatStudentHodAnswer names department HOD', () => {
    const answer = formatStudentHodAnswer(sampleCtx);
    expect(answer).toContain('Dr. Kamau');
    expect(answer).toContain('Sciences');
    expect(answer).toContain('Head of Department');
  });

  it('formatStudentHodAnswer when no HOD assigned', () => {
    const noHod: StudentClassContext = { ...sampleCtx, hod: null };
    const answer = formatStudentHodAnswer(noHod);
    expect(answer).toContain('Form 2B');
    expect(answer).toContain('no Head of Department');
  });

  it('handles empty teacher list', () => {
    const empty: StudentClassContext = {
      classId: 'c',
      className: 'Form 1A',
      departmentId: 'dept-1',
      departmentName: 'Languages',
      hod: null,
      teachers: [],
    };
    expect(formatStudentTeachersAnswer(empty)).toContain('Form 1A');
    expect(formatStudentTeachersAnswer(empty)).toContain('no teachers');
  });
});
