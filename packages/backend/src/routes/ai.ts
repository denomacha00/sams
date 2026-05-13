import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index';
import { UserRole } from '@sams/shared';

const querySchema = z.object({ question: z.string().min(1) });

export const aiRouter = Router();

/**
 * POST /api/v1/ai/query
 * Simple local AI query engine — answers attendance questions based on role scope.
 */
aiRouter.post('/query', async (req: Request, res: Response): Promise<void> => {
  const parsed = querySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Question is required', code: 'VALIDATION_ERROR' });
    return;
  }

  const { question } = parsed.data;
  const user = req.user;
  const schoolId = req.schoolId;
  const q = question.toLowerCase();

  try {
    let answer = '';

    // Attendance percentage queries
    if (q.includes('attendance') && (q.includes('rate') || q.includes('percentage') || q.includes('%'))) {
      const totalRecords = await prisma.attendanceRecord.count({ where: { schoolId } });
      const presentRecords = await prisma.attendanceRecord.count({ where: { schoolId, status: 'PRESENT' } });
      const lateRecords = await prisma.attendanceRecord.count({ where: { schoolId, status: 'LATE' } });
      const rate = totalRecords > 0 ? (((presentRecords + lateRecords) / totalRecords) * 100).toFixed(1) : '0';
      answer = `The overall attendance rate is ${rate}% (${presentRecords + lateRecords} present/late out of ${totalRecords} total records).`;
    }
    // Who is absent / missing
    else if (q.includes('absent') || q.includes('missing') || q.includes('who')) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const absentRecords = await prisma.attendanceRecord.findMany({
        where: { schoolId, status: 'ABSENT', scannedAt: { gte: today } },
        include: { student: { select: { fullName: true } } },
        take: 10,
      });
      if (absentRecords.length === 0) {
        answer = 'No absent students recorded today.';
      } else {
        const names = absentRecords.map((r) => r.student.fullName).join(', ');
        answer = `${absentRecords.length} students marked absent today: ${names}`;
      }
    }
    // How many students / teachers
    else if (q.includes('how many') && (q.includes('student') || q.includes('teacher') || q.includes('user'))) {
      const students = await prisma.user.count({ where: { schoolId, role: 'STUDENT' } });
      const teachers = await prisma.user.count({ where: { schoolId, role: 'TEACHER' } });
      const hods = await prisma.user.count({ where: { schoolId, role: 'HOD' } });
      answer = `Your school has ${students} students, ${teachers} teachers, and ${hods} HODs.`;
    }
    // Sessions today
    else if (q.includes('session') && (q.includes('today') || q.includes('how many'))) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const sessions = await prisma.attendanceSession.count({ where: { schoolId, startedAt: { gte: today } } });
      answer = `${sessions} attendance sessions have been held today.`;
    }
    // Risk / at risk
    else if (q.includes('risk') || q.includes('dropout')) {
      const highRisk = await prisma.riskScore.count({ where: { schoolId, riskLevel: { in: ['HIGH', 'CRITICAL'] } } });
      answer = `There are ${highRisk} students currently at high or critical risk of dropout.`;
    }
    // Default
    else {
      answer = `I can help you with:\n• Attendance rates and percentages\n• Absent students today\n• Student/teacher counts\n• Sessions held today\n• Risk scores\n\nTry asking: "What is the attendance rate?" or "Who is absent today?"`;
    }

    res.json({ answer });
  } catch (err) {
    console.error('[AI] Query error:', err);
    res.json({ answer: 'Sorry, I encountered an error processing your question. Please try again.' });
  }
});
