# SAMS AI Role Coverage Audit

## Summary
Audited 6 roles × backend AI handlers, frontend hooks, and voice flow.

---

## Voice Flow Analysis

### Bug: FloatingAI.tsx voice-onEnd mic reopening
When `speak()` finishes in FloatingAI, `onEnd` tries to restart mic via `startListeningRef.current()`. This works *if* `voicePendingRef.current` is still `true` — but we never call `setAiSpeakingRef(true)` before speech, causing race condition.

### Bug: useAiChat has NO speech-on-end mic reopen
The `useAiSpeech()` in `useAiChat.ts` has no `onEnd` callback, so voice mode never reopens mic after AI reply.

### Bug: SuperAdminAI imports wrong packages
`use-voice-query` and `use-ai-speech` imports are wrong — should be local hooks.

### Missing: isVoiceMode tracking
The `speak()` function in `useAiSpeech` accepts `isVoiceMode` but never uses it for behavior decisions — should use it to toggle mic reopen.

---

## Role Coverage Audit

### SUPER_ADMIN (26 actions)
✅ Has: suspend_school, unsuspend_school, generate_license, extend_license, get_school_info, who_am_i, list_schools, db_find, send_school_notification, run_terminal_command, update_provider_secret, reset_user_password, get_system_stats, run_system_readiness_check, database_overview, db_list_tables, db_query, read_file, search_code, batch_operation, send_platform_summary, clear_audit_logs, knowledge ops, profile ops, virtual assistant, risk view
❌ Missing: Feature flag toggle, Scheduled jobs view, Brand template management, Security dashboard, Revenue forecast, School admin activity view

### SCHOOL_ADMIN (19 actions)
✅ Has: add_user, remove_user, create_class, create_department, get_school_stats, reset_user_password, send_school_notification, send_class_notification, send_department_notification, view_school_students, view_school_teachers, registration_links, report_export, class_reps, guardian_links, knowledge, exam actions, profile, virtual assistant
❌ Missing: Teacher subject assignment, Session settings

### HOD (22 actions)
✅ Has: start_session, end_session, mark_attendance, add_teacher, create_class, view_department_stats, send_class_notification, send_department_notification, list_school_admin, view_department_students, view_department_teachers, registration_links, report_export, generate_timetable, timetable_edit, knowledge, exam actions, teacher_workbench, profile, virtual assistant, risk view, class_attendance
❌ Missing: Teacher subject view, All department sessions view

### TEACHER (15 actions)
✅ Has: start_session, end_session, mark_attendance, view_class_roster, send_class_message, registration_links, report_export, class_reps, knowledge, exam, profile, virtual assistant, parent_chat, risk_view, class_attendance
❌ Missing: View taught classes, View teacher own subjects

### STUDENT (13 actions)
✅ Has: view_attendance, list_my_hod, list_school_admin, list_my_teachers, who_is_class_rep, describe_my_class, describe_my_department, view_timetable, view_today_schedule, explain_reminders, report_export, exam actions, notification_inbox
✅ Fully covered — no gaps

### GUARDIAN (11 actions)
✅ Has: list_linked_children, view_child_attendance, view_child_timetable, export_child_attendance_report, parent_chat, profile, virtual assistant, exam actions, risk_view, notification_inbox
✅ Fully covered — no gaps

---

## Priority Fixes
1. **Frontend voice flow** — `useAiSpeech()` onEnd + isVoiceMode tracking in FloatingAI
2. **SuperAdminAI imports** — Wrong external package paths
3. **Backend gaps** — Add `view_feature_flags`, `view_scheduled_jobs`, `view_revenue_forecast` for SUPER_ADMIN
