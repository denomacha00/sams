# SAMS AI Role Coverage Audit

Updated: 2026-07-04

This file is a quick operational audit for the Super Admin AI and developers. It should describe the current code, not planned or already-fixed gaps.

## Super Admin

Status: covered for platform operations.

Key capabilities:
- School/license management: suspend, unsuspend, generate/extend license, list schools, school details.
- Platform data: system stats, readiness check, DB overview, table list, read-only SQL, DB search.
- Controlled ops: allowlisted `@` terminal commands, source search, file read, provider secret update.
- Platform features: performance metrics, system health, backups, license expiry, revenue forecast, school admin activity, feature flags, security events, brand templates, scheduled jobs, data export.
- Communication: school notification, batch notify, platform summary email.
- Shared: knowledge, profile, virtual assistant, guardian links, risk view, report export.

Important safety rule:
- For SAMS data, the AI must use local actions/database-backed handlers or say it cannot find the data. It must not invent counts, contacts, exports, sent messages, license keys, passwords, or action confirmations.

## School Admin

Status: covered for school operations.

Key capabilities:
- User management: add/remove users, reset password, list students/teachers.
- Structure: create class, create department, school stats.
- Communication: school, class, and department notifications.
- Student support: class reps, guardian links, registration links, detailed student view.
- Timetable: view/add/remove timetable entries.
- Academics: exams, grade boundaries, report cards, class attendance.
- Reports/risk/profile/knowledge/virtual assistant.

Teacher skilled units:
- Teachers/HODs can enter skilled units during registration.
- School admin can edit skilled units later in user management.
- Backend route `teacherSubjectsRouter` validates school/department scope and normalizes subjects.
- Direct AI subject assignment is intentionally not exposed; use the confirmed UI route.

## HOD

Status: covered for current confirmed actions.

Key capabilities:
- Department users/classes/stats.
- Attendance/session actions within department scope.
- Class and department notifications.
- Timetable view/edit/generation for own department.
- Exams, registration links, reports, risk, profile, knowledge, virtual assistant.
- `view_teacher_subjects` is available because HOD includes `teacherActions` in `roleActionRegistry.ts`.

Security boundaries:
- HOD cannot manage users/classes outside their department.
- HOD cannot assign a user to a class from another department.
- HOD timetable actions are scoped to their department.

## Teacher

Status: covered.

Key capabilities:
- Start/end sessions, mark attendance, class attendance.
- View class roster and own assigned subjects.
- Send in-app class messages.
- Manage class reps for manageable classes.
- Student detail workbench, parent chat, registration links for managed classes.
- Reports, risk, exams, profile, knowledge, virtual assistant.

## Student

Status: covered.

Key capabilities:
- Own attendance, timetable, today's schedule.
- Own HOD, class teachers, school admin, class rep, class/department information.
- Reminder explanation, exams/report card/results, own attendance export.
- Profile, virtual assistant, notification inbox.

Important data rule:
- Student contacts and timetable answers come from database-backed class, department, timetable, and user records. If data is missing, AI should say what is missing instead of guessing.

## Guardian

Status: covered.

Key capabilities:
- Linked children, child attendance, child timetable, child attendance export.
- Child teachers, teacher chat, report cards, child risk scores.
- Profile, virtual assistant, notification inbox.

## Cross-Role Regression Checks

- `roleActionRegistry.ts` includes `teacherActions` for HOD so `view_teacher_subjects` stays available.
- Anti-hallucination tests cover fake sent messages, fake exports, fake license keys, fake temporary passwords, and unknown SAMS data.
- Super Admin `@` commands must map to allowlisted operations and ask for confirmation before execution.
- School closure logic affects student schedule answers, daily schedule reminders, available sessions, and session start validation.
- Teacher skilled-unit registration and later edits normalize blank/duplicate subjects before timetable generation uses them.

## Current Medium/High Gaps

None identified in this pass.
