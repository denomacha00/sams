# SAMS Checkpoint — Parent-Teacher Chat + AI Role Audit

> **Last Updated:** 2026-06-28 15:03 EAT
> **Commit:** `c9eb0473` (latest deployed)
> **State:** Building parent-teacher chat feature

## Current Task
1. Add backend routes for parent↔teacher two-way messaging
2. Update scopedNotificationSend to support GUARDIAN senders
3. Add AI handlers for parent-teacher chat
4. Update NotificationsPage frontend for parent inbox + teacher parent inbox
5. AI role completeness audit — compare every role's app pages vs AI action handlers

## Files being created/modified
- `packages/backend/src/routes/parentChat.ts` (NEW) — Parent-teacher chat API
- `packages/backend/src/services/scopedNotificationSend.ts` (MODIFY) — Allow GUARDIAN to send
- `packages/backend/src/services/ai/handlers/parentChatHandlers.ts` (NEW) — AI chat handlers
- `packages/backend/src/registerApplication.ts` (MODIFY) — Register new route
- `packages/frontend/src/pages/NotificationsPage.tsx` (MODIFY) — Parent chat UI
