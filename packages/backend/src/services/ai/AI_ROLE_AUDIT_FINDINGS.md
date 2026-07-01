# SAMS AI Role Coverage Audit (Updated 2026-07-01)

## Overview
Full audit of all 6 roles × all backend AI handlers, action registry, restrictions, slot filling, intent detection, and human response formatting. Cross-referenced every action definition against the registry, restrictions, and actual handler code.

---

## SUPER_ADMIN (Platform Owner)

### Current Actions (~50+)

**School Management:**
- `suspend_school` — Suspend a school (all logins blocked)
- `unsuspend_school` — Reactivate a suspended school
- `generate_license` — Generate new license key
- `extend_license` — Extend existing license by days
- `get_school_info` — Look up school details (code, plan, users, sessions, payments)
- `list_schools` — List all schools with key stats
- `batch_operation` — Batch suspend/unsuspend/extend/change-plan/notify

**System Management:**
- `get_system_stats` — Total schools, users, students, teachers, active sessions, revenue
- `run_system_readiness_check` — Platform health diagnostic
- `database_overview` — Safe live DB summary
- `db_list_tables` — List all tables with row counts
- `db_query` — Run read-only SQL (SELECT)
- `db_find` — Search DB for any value
- `read_file` — Read source code/config files
- `search_code` — Grep across project files
- `run_terminal_command` — Run allowlisted terminal ops (@-prefixed)

**Notification & Communication:**
- `send_school_notification` — In-app notification to all users in a school
- `send_platform_summary` — Email platform summary to super admin

**User Management:**
- `reset_user_password` — Temp password or OTP trigger
- `who_am_i` — View own profile
- `update_provider_secret` — Update env secrets (masked)

**Platform Features (fully implemented ✅):**
- `view_performance_metrics` — API response times, error rates, top endpoints
- `view_system_health` — Database status, API latency, school stats
- `list_backups` / `trigger_backup` — Database backup management
- `view_license_expiry_summary` — Expired/at-risk/upcoming schools
- `view_revenue_forecast` — 6-month MRR, growth, churn
- `view_school_admin_activity` — Last 48h school admin actions
- `list_feature_flags` / `toggle_feature_flag` — Feature flag management
- `list_security_events` — Recent security events
- `list_brand_templates` — Brand template list
- `list_scheduled_jobs` / `trigger_scheduled_job` — Cron job management
- `trigger_data_export` — Initiate data export

**Shared Features:**
- `view_risk_scores` / `view_student_risk` — Risk score views
- `mark_notifications_read` / `clear_inbox_notifications` — Notification management
- All `knowledgeActions` — Create/list/search knowledge base
- All `profileActions` — Profile, phone, password
- All `virtualAssistantActions` — List capabilities
- All `guardianLinkActions` — Link/unlink guardians

**Status: Fully covered. No gaps.**

---

## SCHOOL_ADMIN (School-wide Manager)

### Current Actions (~30+)

**User Management:**
- `add_user` — Add student/teacher/staff
- `remove_user` — Remove user from school
- `reset_user_password` — Temp password or OTP (within school)
- `view_school_students` — List all students
- `view_school_teachers` — List all teachers

**Class & Department:**
- `create_class` — New class
- `create_department` — New department
- `get_school_stats` — Students, teachers, departments, classes, sessions

**Notifications:**
- `send_school_notification` — School-wide (optional role filter)
- `send_class_notification` — To a specific class
- `send_department_notification` — To a department

**Student Management:**
- `set_class_rep` / `unset_class_rep` — Class rep assignment
- `link_guardian` / `unlink_guardian` / `list_linked_guardians` — Guardian linking
- `create_registration_link` — Student enrollment links

**Timetable:**
- `view_timetable_by_class` — View class timetable
- `create_timetable_entry` — Add lesson slot
- `remove_timetable_entry` — Remove lesson slot

**Exams & Academics:**
- `list_terms` / `list_exams` / `view_report_card` / `view_exam_results` / `list_grade_boundaries` / `enter_exam_result`
- `view_class_attendance` — Class attendance stats

**Reports:**
- `export_attendance_report` — PDF/Excel/CSV export
- `view_student_detail` — Detailed student profile (attendance, exams, risk)

**Knowledge & Profile:**
- All `knowledgeActions` — Create, list, search knowledge base
- All `profileActions` — Profile, phone, password
- All `virtualAssistantActions` — List capabilities

**Risk:**
- `view_risk_scores` / `view_student_risk`

**Status: ✅ Fully covered.**

### Minor Gap: Teacher Subject Assignment
School admin can manage teachers but cannot see/assign teacher subjects via AI.
- The route `packages/backend/src/routes/teacherSubjects.ts` and page `TeacherSubjectsPage.tsx` exist
- No AI action for viewing or assigning teacher subjects → LOW priority (done in app UI)

---

## HOD (Department Head)

### Current Actions (~25+)

**Department Management:**
- `add_teacher` — Assign teacher to department
- `create_class` — Create class in department
- `view_department_stats` — Teacher, student, class counts
- `view_department_students` — List department students
- `view_department_teachers` — List department teachers

**Sessions & Attendance:**
- `start_session` — Start attendance for department class
- `end_session` — End active department session
- `mark_attendance` — Mark student present/absent/late
- `view_class_attendance` — Class attendance stats

**Notifications:**
- `send_class_notification` — To department class
- `send_department_notification` — To department (optional role filter)
- `list_school_admin` — Name school admin

**Timetable:**
- `create_timetable_entry` — Add lesson slot
- `remove_timetable_entry` — Remove lesson slot
- `view_timetable_by_class` — View class timetable
- `generate_timetable` — Auto-generate department timetable

**Exams:**
- All `examActions` — Terms, exams, results, grade boundaries, enter results

**Student Workbench:**
- `view_student_detail` — Detailed student profile

**Registration:**
- `create_registration_link` — Student enrollment links

**Reports & Risk:**
- `export_attendance_report` — PDF/Excel/CSV
- `view_risk_scores` / `view_student_risk`

**Knowledge & Profile:**
- All shared actions

**Status: ✅ Mostly covered.**

### Gap: View Teacher Subjects
HOD cannot ask "what subjects does Mr. Kamau teach" via AI.
- `view_teacher_subjects` action exists in `teacherActions`
- BUT `teacherActions` is **not imported** in `roleActionRegistry.ts` for HOD
- **Fix needed** — add `view_teacher_subjects` (or the whole `teacherActions`) to HOD registry

---

## TEACHER (Class Teacher)

### Current Actions (~20+)

**Sessions & Attendance:**
- `start_session` — Start attendance for taught class
- `end_session` — End active session
- `mark_attendance` — Mark student present/absent/late
- `view_class_attendance` — Class attendance stats

**Class Management:**
- `view_class_roster` — List students in assigned/taught classes
- `view_teacher_subjects` — View own assigned subjects
- `send_class_message` — In-app message to class students
- `set_class_rep` / `unset_class_rep` — Class rep assignment

**Student Workbench:**
- `view_student_detail` — Detailed student profile

**Parent Communication:**
- `list_parent_conversations` — View parent messages inbox
- `reply_to_parent` — Reply to parent

**Registration:**
- `create_registration_link` — Student enrollment links

**Reports & Risk:**
- `export_attendance_report` — PDF/Excel/CSV
- `view_risk_scores` / `view_student_risk`
- `list_school_admin` — Name school admin

**Knowledge, Exams, Profile:**
- All shared actions

**Status: ✅ Fully covered.**

---

## STUDENT

### Current Actions (~13+)

- `view_attendance` — Own attendance records and percentage
- `view_timetable` — Full weekly timetable
- `view_today_schedule` — Today's class schedule
- `list_my_hod` — Name your HOD
- `list_my_teachers` — List class teachers (class teacher + timetable teachers)
- `list_school_admin` — Name school admin
- `who_is_class_rep` — Name class rep
- `describe_my_class` — Show assigned class
- `describe_my_department` — Show department
- `explain_reminders` — Explain notification options
- `export_attendance_report` — PDF/Excel/CSV export
- All `examActions` — Terms, exams, report card, results
- All `profileActions` — Profile, phone, password
- All `virtualAssistantActions` — List capabilities
- Notification inbox actions

**Status: ✅ Fully covered.**

---

## GUARDIAN (Parent/Guardian)

### Current Actions (~13+)

- `list_linked_children` — Linked children list
- `view_child_attendance` — Child attendance summary
- `view_child_timetable` — Child timetable
- `export_child_attendance_report` — Child report export
- `list_my_teachers` — Teachers of linked children
- `send_message_to_teacher` — Message child's teacher
- `view_chat_with_teacher` — Chat history with teacher
- `view_report_card` — Child report card (via examActions)
- `view_risk_scores` / `view_student_risk` — Child risk scores
- All `profileActions`, `virtualAssistantActions`, notification inbox

**Status: ✅ Fully covered.**

---

## Cross-Role Issues Found

### Issue 1: HOD missing `view_teacher_subjects` ❌
**File:** `packages/backend/src/services/ai/roleActionRegistry.ts`
**Problem:** HOD registry includes `teacherWorkbenchActions` but NOT `teacherActions`. The `view_teacher_subjects` action (defined in `teacherActions`) allows viewing assigned subjects. HODs need this to manage their department.
**Fix:** Add `teacherActions` to HOD registry (duplicates with `hodActions` are harmless since registry iterates in order and `hodActions` takes precedence for overlapping actions).

### Issue 2: Stale audit file ❌
**File:** `packages/backend/src/services/ai/AI_ROLE_AUDIT_FINDINGS.md`
**Problem:** Claims several actions are "missing" for SUPER_ADMIN (feature flags, scheduled jobs, brand templates, security events, revenue forecast, school admin activity) — but all these are ALREADY implemented in `superAdminExtraActions` and `superAdminPlatformActions`.
**Fix:** Updated with accurate findings (this document).

### Issue 3: TypeScript / compilation ✅
**File:** — (checked via tsc --noEmit)
**Status:** Previously compiled clean. Key files checked for import correctness.

### Issue 4: Action classRepActions double-registered ✅ (not a bug)
**File:** `packages/backend/src/services/ai/roleActionRegistry.ts`
**SCHOOL_ADMIN** has `classRepActions` (set_class_rep, unset_class_rep)
**TEACHER** also has `classRepActions`
**HOD** does NOT have `classRepActions` (and `set_class_rep`, `unset_class_rep` are in the HOD forbidden list) — intentional

### Issue 5: HumanResponseFormatter action-name alignment ✅
The suggestion labels in `formatHumanResponse` produce action names like `view_timetable`, `absent_students`, `send_class_notification`, `start_session`, `risk_scores`, `class_comparison` — all of which exist in the registry for relevant roles.

### Issue 6: Notification patterns might miss some phrashings ⚠️
**File:** `packages/backend/src/services/ai/handlers/schoolAdminHandlers.ts`
The `send_class_notification` and `send_department_notification` patterns are heavily optimized but might miss edge-case phrasings like "notify all form 2A students about the exam". The LLM classifier fallback catches these.

---

## Priority Fix Recommendations

### HIGH (breaking without fix):
None — the system compiles and runs.

### MEDIUM (quality gap):
1. **Add teacherActions to HOD** — HODs cannot view teacher subjects via AI
2. **Update stale audit doc** — Prevents misdiagnosis

### LOW (nice to have):
- Add `view_teacher_subjects` as standalone export from teacherHandlers for cleaner inclusion
- Add HOD `view_all_department_sessions` action
- Add SCHOOL_ADMIN `assign_teacher_subject` action
