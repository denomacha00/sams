# Design Document: AI Role Actions

## Overview

Extend the SAMS AI action system beyond SUPER_ADMIN to support role-specific actions for all user roles (SCHOOL_ADMIN, HOD, TEACHER, STUDENT) using a Role-Action Registry pattern. The system uses hybrid intent detection (regex + LLM fallback), a single unified executor, destructive action confirmation, and role-scoped authorization.

## Architecture

The AI Role Actions feature extends the existing SUPER_ADMIN-only action system into a unified, role-aware action pipeline using a **Role-Action Registry** pattern. The architecture replaces the hardcoded `executeSuperAdminAction` method with a single `executeAction` dispatcher that looks up handlers from a centralized registry keyed by role and action name.

### High-Level Flow

```
User Message → Intent Detector → Registry Lookup → Authorization Check → Execute/Deny
                   │                                        │
                   ├─ Regex Match (fast path) ──────────────┤
                   │                                        │
                   └─ LLM Fallback (slow path) ─────────────┘
```

### Key Design Decisions

1. **Single Registry, Multiple Roles**: One `RoleActionRegistry` object maps each `UserRole` to its permitted actions, patterns, and handlers.
2. **Hybrid Detection**: Regex patterns are tried first (fast, deterministic). If no match, the LLM fallback classifies intent using only the actions permitted for the user's role.
3. **Single Executor**: `AIService.executeAction()` replaces `executeSuperAdminAction()`. It validates permissions, extracts scope from JWT, dispatches to the handler, and logs the audit trail.
4. **Destructive Action Confirmation**: Actions marked `destructive: true` return a confirmation prompt instead of executing immediately.
5. **Backward Compatibility**: Existing SUPER_ADMIN patterns and handlers are migrated into the registry without behavioral changes.

## Components and Interfaces

### 1. Role-Action Registry (`roleActionRegistry.ts`)

A new module exporting the registry data structure and lookup utilities.

```typescript
import { UserRole } from '@sams/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActionDefinition {
  action: string;
  description: string;
  destructive: boolean;
  patterns: RegExp[];
  extractParams: (message: string, match: RegExpMatchArray | null) => Record<string, unknown>;
  descriptionTemplate: (params: Record<string, unknown>) => string;
  handler: ActionHandler;
}

export type ActionHandler = (
  params: Record<string, unknown>,
  scope: ActionScope,
) => Promise<ActionResult>;

export interface ActionScope {
  userId: string;
  role: UserRole;
  schoolId: string;
  departmentId?: string;
  classId?: string;
}

export interface ActionResult {
  answer: string;
  data?: unknown;
}

// ─── Registry Structure ───────────────────────────────────────────────────────

export type RoleActionMap = Record<UserRole, ActionDefinition[]>;

// ─── Registry Instance ────────────────────────────────────────────────────────

export const roleActionRegistry: RoleActionMap = {
  [UserRole.SUPER_ADMIN]: [/* migrated existing actions */],
  [UserRole.SCHOOL_ADMIN]: [/* add_user, remove_user, create_class, create_department, manage_timetable */],
  [UserRole.HOD]: [/* add_teacher, view_department_stats */],
  [UserRole.TEACHER]: [/* start_session, end_session, mark_attendance, add_knowledge */],
  [UserRole.STUDENT]: [/* view_attendance, view_timetable (read-only only) */],
};

// ─── Lookup Utilities ─────────────────────────────────────────────────────────

export function getActionsForRole(role: UserRole): ActionDefinition[] {
  return roleActionRegistry[role] ?? [];
}

export function findAction(role: UserRole, actionName: string): ActionDefinition | undefined {
  return getActionsForRole(role).find((a) => a.action === actionName);
}

export function isActionPermitted(role: UserRole, actionName: string): boolean {
  return getActionsForRole(role).some((a) => a.action === actionName);
}

export function getActionNames(role: UserRole): string[] {
  return getActionsForRole(role).map((a) => a.action);
}
```

### 2. Refactored Action Intent Detector (`actionIntentDetector.ts`)

The detector is extended to support all roles by querying the registry instead of using a hardcoded `ACTION_PATTERNS` array.

```typescript
import { UserRole } from '@sams/shared';
import { getActionsForRole, type ActionDefinition } from './roleActionRegistry';

export interface DetectedAction {
  isAction: boolean;
  action?: string;
  params?: Record<string, unknown>;
  requiresConfirmation: boolean;
  description?: string;
}

class ActionIntentDetector {
  /**
   * Detect whether a message is an action request for the given role.
   * Step 1: Try regex patterns from the registry for this role.
   * Step 2: If no regex match, invoke LLM fallback with role-scoped candidates.
   */
  async detect(message: string, userRole: UserRole): Promise<DetectedAction> {
    const trimmed = message.trim();
    if (!trimmed) {
      return { isAction: false, requiresConfirmation: false };
    }

    // Step 1: Regex matching against role-specific patterns
    const regexResult = this.detectByRegex(trimmed, userRole);
    if (regexResult.isAction) {
      return regexResult;
    }

    // Step 2: LLM fallback with role-scoped action candidates
    const llmResult = await this.detectByLLM(trimmed, userRole);
    return llmResult;
  }

  /**
   * Regex-based detection. Iterates patterns for the user's role only.
   */
  private detectByRegex(message: string, role: UserRole): DetectedAction {
    const actions = getActionsForRole(role);

    for (const actionDef of actions) {
      for (const pattern of actionDef.patterns) {
        const match = message.match(pattern);
        if (match) {
          const params = actionDef.extractParams(message, match);
          return {
            isAction: true,
            action: actionDef.action,
            params,
            requiresConfirmation: actionDef.destructive,
            description: actionDef.descriptionTemplate(params),
          };
        }
      }
    }

    return { isAction: false, requiresConfirmation: false };
  }

  /**
   * LLM fallback detection. Sends the message and role-permitted action
   * list to the LLM for classification.
   */
  private async detectByLLM(message: string, role: UserRole): Promise<DetectedAction> {
    const actions = getActionsForRole(role);
    if (actions.length === 0) {
      return { isAction: false, requiresConfirmation: false };
    }

    const candidates = actions.map((a) => ({
      action: a.action,
      description: a.description,
    }));

    // Call LLM with structured prompt
    const classification = await this.classifyWithLLM(message, candidates);

    if (!classification || classification.action === 'none') {
      return { isAction: false, requiresConfirmation: false };
    }

    // Find the matched action definition
    const actionDef = actions.find((a) => a.action === classification.action);
    if (!actionDef) {
      return { isAction: false, requiresConfirmation: false };
    }

    // Extract params from LLM response or re-parse from message
    const params = classification.params ?? actionDef.extractParams(message, null);

    return {
      isAction: true,
      action: actionDef.action,
      params,
      requiresConfirmation: actionDef.destructive,
      description: actionDef.descriptionTemplate(params),
    };
  }

  /**
   * Calls the LLM (OpenAI/Groq) with a structured classification prompt.
   * Returns the classified action and extracted parameters, or null.
   */
  private async classifyWithLLM(
    message: string,
    candidates: Array<{ action: string; description: string }>,
  ): Promise<{ action: string; params?: Record<string, unknown> } | null> {
    // Implementation uses openaiEngine with a system prompt
    // that lists candidates and asks for JSON classification
    // Returns null on error or timeout
  }
}

export const actionIntentDetector = new ActionIntentDetector();
```

### 3. Refactored AI Service (`aiService.ts`)

The `executeSuperAdminAction` method is replaced with a generic `executeAction` method.

```typescript
import { type AccessTokenPayload, UserRole } from '@sams/shared';
import { actionIntentDetector } from './ai/actionIntentDetector';
import {
  findAction,
  isActionPermitted,
  getActionNames,
  type ActionScope,
} from './ai/roleActionRegistry';
import { auditService } from './auditService';

export class AIService {
  async query(
    user: AccessTokenPayload,
    question: string,
    options?: { threadId?: string; confirmAction?: boolean; pendingAction?: PendingAction },
  ): Promise<AIServiceResponse> {
    // ... local engine attempt (unchanged) ...

    // Step 2: Action intent detection for ALL authenticated roles
    if (user.sub !== 'guest') {
      // If user confirmed a pending action — execute it
      if (options?.confirmAction && options?.pendingAction) {
        const result = await this.executeAction(user, options.pendingAction);
        const threadId = await this.safelyPersist(user, question, result.answer, options?.threadId);
        return { ...result, threadId };
      }

      // Detect action intent using the registry for the user's role
      const actionIntent = await actionIntentDetector.detect(question, user.role);
      if (actionIntent.isAction) {
        // Check if action is permitted (defense in depth)
        if (!isActionPermitted(user.role, actionIntent.action!)) {
          return this.buildDenialResponse(user.role, actionIntent.action!);
        }

        if (actionIntent.requiresConfirmation) {
          return {
            answer: `⚠️ **Confirm Action**: ${actionIntent.description}\n\nDo you want to proceed?`,
            intent: 'action_confirmation',
            engine: 'openai',
            pendingAction: {
              action: actionIntent.action!,
              params: actionIntent.params!,
              description: actionIntent.description!,
            },
            requiresConfirmation: true,
          };
        }

        // Non-destructive — execute immediately
        const result = await this.executeAction(user, {
          action: actionIntent.action!,
          params: actionIntent.params!,
          description: actionIntent.description!,
        });
        const threadId = await this.safelyPersist(user, question, result.answer, options?.threadId);
        return { ...result, threadId };
      }
    }

    // ... OpenAI/Groq fallback (unchanged) ...
  }

  /**
   * Unified action executor. Replaces executeSuperAdminAction.
   * 1. Validates permission via registry lookup
   * 2. Extracts scope from JWT
   * 3. Dispatches to the action handler
   * 4. Logs audit entry
   * 5. Returns structured response
   */
  private async executeAction(
    user: AccessTokenPayload,
    pendingAction: PendingAction,
  ): Promise<AIServiceResponse> {
    const { action, params } = pendingAction;

    // Authorization check
    const actionDef = findAction(user.role, action);
    if (!actionDef) {
      await this.logDeniedAction(user, action);
      return this.buildDenialResponse(user.role, action);
    }

    // Build scope from JWT claims
    const scope: ActionScope = {
      userId: user.sub,
      role: user.role,
      schoolId: user.schoolId,
      departmentId: user.departmentId,
      classId: user.classId,
    };

    try {
      // Dispatch to handler
      const result = await actionDef.handler(params, scope);

      // Audit log
      await auditService.log({
        eventType: 'AI_ACTION_EXECUTED' as any,
        actorId: user.sub,
        actorRole: user.role,
        schoolId: user.schoolId,
        resourceSnapshot: {
          action,
          params,
          result: 'success',
        },
      });

      return {
        answer: result.answer,
        intent: 'action_executed',
        engine: 'openai',
        data: result.data,
      };
    } catch (err) {
      // Safe error response — no internal details exposed
      return {
        answer: 'The action could not be completed. Please try again or contact support.',
        intent: 'action_error',
        engine: 'openai',
      };
    }
  }

  /**
   * Build a denial response with role-appropriate suggestions.
   */
  private buildDenialResponse(role: UserRole, requestedAction: string): AIServiceResponse {
    const permitted = getActionNames(role);
    const suggestions = permitted.length > 0
      ? `You can: ${permitted.map((a) => `• ${a}`).join('\n')}`
      : 'You can ask me questions about your data.';

    return {
      answer: `❌ The action "${requestedAction}" is not available for your role.\n\n${suggestions}`,
      intent: 'action_denied',
      engine: 'openai',
    };
  }

  private async logDeniedAction(user: AccessTokenPayload, action: string): Promise<void> {
    await auditService.log({
      eventType: 'AI_ACTION_DENIED' as any,
      actorId: user.sub,
      actorRole: user.role,
      schoolId: user.schoolId,
      resourceSnapshot: { action, reason: 'not_permitted_for_role' },
    });
  }
}
```


### 4. Action Handlers (per role)

Each role has a dedicated handler module that implements the `ActionHandler` signature.

#### File: `services/ai/handlers/schoolAdminHandlers.ts`

```typescript
import { type ActionHandler, type ActionScope, type ActionResult } from '../roleActionRegistry';

export const addUserHandler: ActionHandler = async (params, scope): Promise<ActionResult> => {
  const { prisma } = await import('../../../index');
  const { fullName, role, email } = params as { fullName: string; role: string; email?: string };

  const user = await prisma.user.create({
    data: {
      schoolId: scope.schoolId,
      fullName,
      role: role as any,
      email,
      passwordHash: '', // Requires activation flow
    },
  });

  return {
    answer: `✅ User "${fullName}" created with role ${role}.`,
    data: { userId: user.id, fullName, role },
  };
};

export const removeUserHandler: ActionHandler = async (params, scope): Promise<ActionResult> => {
  const { prisma } = await import('../../../index');
  const { userId, fullName } = params as { userId?: string; fullName?: string };

  // Find user by name or ID within school scope
  const user = await prisma.user.findFirst({
    where: {
      schoolId: scope.schoolId,
      ...(userId ? { id: userId } : { fullName: { contains: fullName, mode: 'insensitive' } }),
    },
  });

  if (!user) return { answer: `User "${fullName || userId}" not found in your school.` };

  await prisma.user.delete({ where: { id: user.id } });
  return {
    answer: `✅ User "${user.fullName}" has been removed from the system.`,
    data: { userId: user.id, fullName: user.fullName },
  };
};

export const createClassHandler: ActionHandler = async (params, scope): Promise<ActionResult> => {
  const { prisma } = await import('../../../index');
  const { className, departmentId } = params as { className: string; departmentId?: string };

  const dept = departmentId
    ? await prisma.department.findFirst({ where: { id: departmentId, schoolId: scope.schoolId } })
    : await prisma.department.findFirst({ where: { schoolId: scope.schoolId } });

  if (!dept) return { answer: 'No department found. Please create a department first.' };

  const cls = await prisma.class.create({
    data: { schoolId: scope.schoolId, departmentId: dept.id, name: className },
  });

  return {
    answer: `✅ Class "${className}" created in department "${dept.name}".`,
    data: { classId: cls.id, className, departmentName: dept.name },
  };
};

export const createDepartmentHandler: ActionHandler = async (params, scope): Promise<ActionResult> => {
  const { prisma } = await import('../../../index');
  const { departmentName } = params as { departmentName: string };

  const dept = await prisma.department.create({
    data: { schoolId: scope.schoolId, name: departmentName },
  });

  return {
    answer: `✅ Department "${departmentName}" created.`,
    data: { departmentId: dept.id, departmentName },
  };
};

export const manageTimetableHandler: ActionHandler = async (params, scope): Promise<ActionResult> => {
  const { prisma } = await import('../../../index');
  // Delegates to existing timetable generation logic
  return {
    answer: '✅ Timetable updated. Use "view timetable" to see the changes.',
    data: { schoolId: scope.schoolId },
  };
};
```

#### File: `services/ai/handlers/hodHandlers.ts`

```typescript
import { type ActionHandler, type ActionScope, type ActionResult } from '../roleActionRegistry';

export const addTeacherHandler: ActionHandler = async (params, scope): Promise<ActionResult> => {
  const { prisma } = await import('../../../index');
  const { teacherName } = params as { teacherName: string };

  if (!scope.departmentId) {
    return { answer: 'Your account is not associated with a department.' };
  }

  const teacher = await prisma.user.findFirst({
    where: {
      schoolId: scope.schoolId,
      role: 'TEACHER',
      fullName: { contains: teacherName, mode: 'insensitive' },
    },
  });

  if (!teacher) return { answer: `Teacher "${teacherName}" not found in your school.` };

  await prisma.user.update({
    where: { id: teacher.id },
    data: { departmentId: scope.departmentId },
  });

  return {
    answer: `✅ Teacher "${teacher.fullName}" assigned to your department.`,
    data: { teacherId: teacher.id, departmentId: scope.departmentId },
  };
};

export const viewDepartmentStatsHandler: ActionHandler = async (params, scope): Promise<ActionResult> => {
  const { prisma } = await import('../../../index');

  if (!scope.departmentId) {
    return { answer: 'Your account is not associated with a department.' };
  }

  const [teacherCount, classCount] = await Promise.all([
    prisma.user.count({ where: { schoolId: scope.schoolId, departmentId: scope.departmentId, role: 'TEACHER' } }),
    prisma.class.count({ where: { schoolId: scope.schoolId, departmentId: scope.departmentId } }),
  ]);

  return {
    answer: `📊 **Department Stats**\n\n• Teachers: ${teacherCount}\n• Classes: ${classCount}`,
    data: { teacherCount, classCount, departmentId: scope.departmentId },
  };
};
```

#### File: `services/ai/handlers/teacherHandlers.ts`

```typescript
import { type ActionHandler, type ActionScope, type ActionResult } from '../roleActionRegistry';

export const startSessionHandler: ActionHandler = async (params, scope): Promise<ActionResult> => {
  const { prisma } = await import('../../../index');
  const { subject } = params as { subject?: string };

  if (!scope.classId) {
    return { answer: 'Your account is not associated with a class.' };
  }

  const session = await prisma.attendanceSession.create({
    data: {
      schoolId: scope.schoolId,
      classId: scope.classId,
      teacherId: scope.userId,
      subject: subject || 'General',
      isActive: true,
    },
  });

  return {
    answer: `✅ Attendance session started for "${subject || 'General'}".`,
    data: { sessionId: session.id },
  };
};

export const endSessionHandler: ActionHandler = async (params, scope): Promise<ActionResult> => {
  const { prisma } = await import('../../../index');

  const activeSession = await prisma.attendanceSession.findFirst({
    where: { teacherId: scope.userId, isActive: true },
  });

  if (!activeSession) return { answer: 'No active session found.' };

  await prisma.attendanceSession.update({
    where: { id: activeSession.id },
    data: { isActive: false, endedAt: new Date() },
  });

  return {
    answer: `✅ Session "${activeSession.subject}" ended.`,
    data: { sessionId: activeSession.id },
  };
};

export const markAttendanceHandler: ActionHandler = async (params, scope): Promise<ActionResult> => {
  const { prisma } = await import('../../../index');
  const { studentName, status } = params as { studentName: string; status?: string };

  const activeSession = await prisma.attendanceSession.findFirst({
    where: { teacherId: scope.userId, isActive: true },
  });

  if (!activeSession) return { answer: 'No active session. Start a session first.' };

  const student = await prisma.user.findFirst({
    where: {
      schoolId: scope.schoolId,
      role: 'STUDENT',
      fullName: { contains: studentName, mode: 'insensitive' },
    },
  });

  if (!student) return { answer: `Student "${studentName}" not found.` };

  await prisma.attendanceRecord.upsert({
    where: { sessionId_studentId: { sessionId: activeSession.id, studentId: student.id } },
    create: {
      schoolId: scope.schoolId,
      sessionId: activeSession.id,
      studentId: student.id,
      status: (status as any) || 'PRESENT',
      method: 'MANUAL',
      scannedAt: new Date(),
    },
    update: { status: (status as any) || 'PRESENT' },
  });

  return {
    answer: `✅ ${student.fullName} marked as ${status || 'PRESENT'}.`,
    data: { studentId: student.id, status: status || 'PRESENT' },
  };
};

export const addKnowledgeHandler: ActionHandler = async (params, scope): Promise<ActionResult> => {
  const { prisma } = await import('../../../index');
  const { title, content, category } = params as { title: string; content: string; category?: string };

  const entry = await prisma.aIKnowledge.create({
    data: { title, content, category: category || 'general' },
  });

  return {
    answer: `✅ Knowledge entry "${title}" added.`,
    data: { entryId: entry.id },
  };
};
```

### 5. LLM Fallback Design

The LLM fallback is invoked only when regex patterns fail to match. It receives a constrained prompt containing only the actions permitted for the requesting user's role.

```typescript
// services/ai/llmActionClassifier.ts

import { openaiQueryRaw } from './openaiEngine';

interface ClassificationResult {
  action: string;       // 'none' if no action detected
  params?: Record<string, unknown>;
  confidence: number;   // 0.0 - 1.0
}

const CLASSIFICATION_SYSTEM_PROMPT = `You are an intent classifier for a school management system.
Given a user message and a list of available actions, determine if the message is requesting one of the actions.

Respond with JSON only:
- If the message matches an action: {"action": "<action_name>", "params": {...extracted params...}, "confidence": 0.0-1.0}
- If no action matches: {"action": "none", "confidence": 1.0}

Rules:
- Only classify as an action if confidence >= 0.7
- Extract relevant parameters from the message
- If ambiguous between multiple actions, pick the highest confidence one
- Never classify informational questions as actions`;

export async function classifyIntent(
  message: string,
  candidates: Array<{ action: string; description: string }>,
): Promise<ClassificationResult | null> {
  const userPrompt = `Message: "${message}"

Available actions:
${candidates.map((c) => `- ${c.action}: ${c.description}`).join('\n')}

Classify this message.`;

  try {
    const response = await openaiQueryRaw(CLASSIFICATION_SYSTEM_PROMPT, userPrompt);
    const parsed = JSON.parse(response);

    if (parsed.confidence < 0.7) {
      return { action: 'none', confidence: parsed.confidence };
    }

    return parsed as ClassificationResult;
  } catch {
    // LLM failure — treat as no action detected
    return null;
  }
}
```

**Fallback Behavior:**
- Timeout: 5 seconds max. If LLM doesn't respond, return `isAction: false`.
- Confidence threshold: 0.7. Below this, treat as non-action.
- Error handling: Any LLM error results in graceful degradation to the normal query pipeline.
- Role scoping: The candidate list sent to the LLM contains ONLY actions for the user's role, preventing information leakage about other roles' capabilities.

---

## Data Flow

### Intent Detection Flow

```
1. User sends message
2. actionIntentDetector.detect(message, user.role)
   a. Get actions from registry for user.role
   b. For each action, try each regex pattern
   c. If match found → extract params → return DetectedAction
   d. If no match → invoke LLM fallback with role-scoped candidates
   e. If LLM classifies → extract params → return DetectedAction
   f. If nothing matches → return { isAction: false }
3. If isAction && destructive → return confirmation prompt
4. If isAction && !destructive → executeAction immediately
5. If !isAction → continue to normal AI query pipeline
```

### Action Execution Flow

```
1. executeAction(user, pendingAction)
2. Look up ActionDefinition in registry for user.role + action name
3. If not found → log denial → return denial response
4. Build ActionScope from JWT claims (schoolId, departmentId, classId)
5. Call actionDef.handler(params, scope)
6. On success → audit log → return structured response
7. On failure → return safe error message (no internal details)
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Regex match but handler throws | Return generic error, log internally |
| LLM timeout (>5s) | Treat as no-action, continue to query pipeline |
| LLM returns invalid JSON | Treat as no-action, continue to query pipeline |
| Action not in registry for role | Return denial response with suggestions |
| Handler receives invalid params | Return user-friendly validation error |
| Database error in handler | Return generic error, log stack trace internally |
| JWT missing scope claims | Return error explaining missing scope |

---

## File Structure

```
packages/backend/src/services/ai/
├── actionIntentDetector.ts      (refactored: role-aware, async with LLM fallback)
├── roleActionRegistry.ts        (NEW: registry data structure + lookup utilities)
├── llmActionClassifier.ts       (NEW: LLM fallback classification)
├── handlers/
│   ├── superAdminHandlers.ts    (NEW: migrated from aiService.ts)
│   ├── schoolAdminHandlers.ts   (NEW: School Admin action handlers)
│   ├── hodHandlers.ts           (NEW: HOD action handlers)
│   ├── teacherHandlers.ts       (NEW: Teacher action handlers)
│   └── studentHandlers.ts       (NEW: Student read-only handlers)
├── localEngine.ts               (unchanged)
└── openaiEngine.ts              (minor: export openaiQueryRaw for classifier)
```

---

## Interfaces

### Registry Entry (per action)

```typescript
interface ActionDefinition {
  action: string;                    // Unique action identifier
  description: string;               // Human-readable description for LLM prompt
  destructive: boolean;              // Whether confirmation is required
  patterns: RegExp[];                // Regex patterns for fast detection
  extractParams: (msg: string, match: RegExpMatchArray | null) => Record<string, unknown>;
  descriptionTemplate: (params: Record<string, unknown>) => string;
  handler: ActionHandler;            // Execution function
}
```

### Action Scope (from JWT)

```typescript
interface ActionScope {
  userId: string;        // user.sub
  role: UserRole;        // user.role
  schoolId: string;      // user.schoolId
  departmentId?: string; // user.departmentId (HOD, Teacher)
  classId?: string;      // user.classId (Teacher, Student)
}
```

### AI Service Response (unchanged interface, new intents)

```typescript
// New intent values:
// - 'action_executed'      → action completed successfully
// - 'action_confirmation'  → destructive action awaiting confirmation
// - 'action_denied'        → action not permitted for role
// - 'action_error'         → action execution failed
```

---

## Data Models

### Registry Data: Actions Per Role

| Role | Action | Destructive | Description |
|------|--------|-------------|-------------|
| SUPER_ADMIN | suspend_school | ✅ | Suspend a school |
| SUPER_ADMIN | unsuspend_school | ❌ | Unsuspend a school |
| SUPER_ADMIN | generate_license | ❌ | Generate a license key |
| SUPER_ADMIN | extend_license | ❌ | Extend a school's license |
| SUPER_ADMIN | get_school_info | ❌ | Get school details |
| SUPER_ADMIN | get_system_stats | ❌ | Get platform statistics |
| SCHOOL_ADMIN | add_user | ❌ | Add a user to the school |
| SCHOOL_ADMIN | remove_user | ✅ | Remove a user from the school |
| SCHOOL_ADMIN | create_class | ❌ | Create a new class |
| SCHOOL_ADMIN | create_department | ❌ | Create a new department |
| SCHOOL_ADMIN | manage_timetable | ❌ | Generate or modify timetable |
| HOD | add_teacher | ❌ | Assign a teacher to department |
| HOD | view_department_stats | ❌ | View department statistics |
| TEACHER | start_session | ❌ | Start an attendance session |
| TEACHER | end_session | ✅ | End the active session |
| TEACHER | mark_attendance | ❌ | Mark a student's attendance |
| TEACHER | add_knowledge | ❌ | Add a knowledge base entry |
| STUDENT | view_attendance | ❌ | View own attendance records |
| STUDENT | view_timetable | ❌ | View class timetable |


---

## Testing Strategy

### Unit Tests
- Each action handler tested with valid and invalid parameters
- Denial response content verification
- Confirmation prompt content verification
- Error response safety (no internal details leaked)

### Property-Based Tests
- Registry structural completeness across all roles
- Intent detection correctness for generated messages matching patterns
- Scope enforcement for all action executions
- Student read-only invariant
- Regex-first priority (LLM not called when regex matches)
- LLM candidate list scoping
- Destructive action confirmation gate
- Out-of-scope denial correctness
- Audit logging completeness

### Integration Tests
- End-to-end flow: message → detection → execution → response
- Backward compatibility: all existing SUPER_ADMIN actions still work
- LLM fallback with mocked OpenAI responses
- Confirmation flow: detect → confirm → execute

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Registry Structural Completeness

*For any* role in the `UserRole` enum and *for any* action definition in that role's registry entry, the action must have a non-empty `action` string, at least one regex pattern, a defined `extractParams` function, a defined `handler` function, and a boolean `destructive` field.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Intent Detection Correctness

*For any* role and *for any* message that matches a regex pattern registered for that role, the `actionIntentDetector.detect()` method shall return `isAction: true` with the correct `action` name and extracted parameters matching the pattern's `extractParams` output.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 6.1**

### Property 3: Scope Enforcement

*For any* action execution request from any authenticated user, the `ActionScope` passed to the handler shall have `schoolId` equal to the user's JWT `schoolId`, `departmentId` equal to the user's JWT `departmentId`, and `classId` equal to the user's JWT `classId`.

**Validates: Requirements 2.6, 3.3, 4.5, 9.2**

### Property 4: Student Read-Only Invariant

*For any* action defined in the STUDENT role's registry entry, the `destructive` field shall be `false`. Additionally, *for any* message from a STUDENT user that would match a destructive action pattern from another role, the system shall return a denial response.

**Validates: Requirements 5.1, 5.2**

### Property 5: Regex-First Detection Priority

*For any* message and role where the message matches a regex pattern in the registry, the intent detector shall return the result without invoking the LLM fallback. Conversely, *for any* message that does not match any regex pattern for the user's role, the LLM fallback shall be invoked.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 6: LLM Fallback Role Scoping

*For any* invocation of the LLM fallback classifier, the candidate action list passed to the LLM shall contain exactly the actions defined in the registry for the requesting user's role — no more, no less.

**Validates: Requirements 6.4**

### Property 7: Destructive Action Confirmation Gate

*For any* action marked as `destructive: true` in the registry, when detected by the intent detector, the system shall return a confirmation prompt (not execute immediately). The confirmation prompt shall contain the action name, affected resource description, and consequence text.

**Validates: Requirements 7.1, 7.4**

### Property 8: Out-of-Scope Denial

*For any* (role, action) pair where the action exists in the registry but is NOT in the specified role's permitted list, the executor shall return a denial response and shall not invoke the action handler.

**Validates: Requirements 3.4, 8.1**

### Property 9: Audit Logging Completeness

*For any* action that is either successfully executed or denied, the system shall create an audit log entry containing the actor ID, actor role, action type, and affected resource (for executions) or denial reason (for denials).

**Validates: Requirements 8.4, 9.5**

### Property 10: Error Response Safety

*For any* action handler that throws an exception during execution, the response returned to the user shall not contain stack traces, internal file paths, database connection strings, or any implementation details.

**Validates: Requirements 9.4**
