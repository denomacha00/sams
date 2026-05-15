# Requirements Document

## Introduction

Extend the SAMS AI action system beyond SUPER_ADMIN to support role-specific actions for School Admin, HOD, Teacher, and Student roles. The system uses a hybrid detection approach (regex patterns with LLM fallback) and a single executor with a role-action registry. Destructive actions require user confirmation, and out-of-scope requests are denied with helpful suggestions.

## Glossary

- **Action_System**: The AI subsystem that detects user intent from natural language, maps it to executable actions, and returns results
- **Role_Action_Registry**: A centralized mapping of roles to their permitted actions, patterns, and execution handlers
- **Intent_Detector**: The component that classifies user messages as action requests or informational queries using regex patterns and LLM fallback
- **Action_Executor**: The single executor service that dispatches detected actions to the appropriate handler after authorization checks
- **Destructive_Action**: An action that modifies or deletes data (e.g., removing users, ending sessions) requiring explicit user confirmation before execution
- **School_Admin**: A user with the SCHOOL_ADMIN role who manages users, classes, departments, and timetables within their school
- **HOD**: A user with the HOD role (Head of Department) who manages teachers within their department and views department statistics
- **Teacher**: A user with the TEACHER role who manages attendance sessions and knowledge entries
- **Student**: A user with the STUDENT role who can only perform read-only queries with no destructive actions
- **LLM_Fallback**: The secondary detection mechanism that uses an LLM to classify intent when regex patterns fail to match
- **Confirmation_Prompt**: A response asking the user to confirm a destructive action before execution
- **Denial_Response**: A response informing the user that the requested action is outside their role scope, accompanied by a suggestion of what they can do

## Requirements

### Requirement 1: Role-Action Registry

**User Story:** As a system architect, I want a centralized registry mapping roles to permitted actions, so that action authorization is consistent and maintainable.

#### Acceptance Criteria

1. THE Role_Action_Registry SHALL define permitted actions for each role: SCHOOL_ADMIN, HOD, TEACHER, and STUDENT.
2. THE Role_Action_Registry SHALL associate each action with its regex detection patterns, parameter extraction logic, and execution handler.
3. THE Role_Action_Registry SHALL mark each action as destructive or non-destructive.
4. WHEN a new action is added to the Role_Action_Registry, THE Action_System SHALL make the action available to the associated role without modifying the Intent_Detector core logic.

### Requirement 2: School Admin Actions

**User Story:** As a School Admin, I want to perform administrative tasks through the AI chat, so that I can manage my school efficiently without navigating multiple screens.

#### Acceptance Criteria

1. WHEN a School_Admin requests to add a user, THE Action_System SHALL detect the intent and execute user creation within the School_Admin's school scope.
2. WHEN a School_Admin requests to remove a user, THE Action_System SHALL detect the intent, mark the action as destructive, and present a Confirmation_Prompt before execution.
3. WHEN a School_Admin requests to create a class, THE Action_System SHALL detect the intent and execute class creation within the School_Admin's school scope.
4. WHEN a School_Admin requests to create a department, THE Action_System SHALL detect the intent and execute department creation within the School_Admin's school scope.
5. WHEN a School_Admin requests to manage the timetable, THE Action_System SHALL detect the intent and execute timetable generation or modification within the School_Admin's school scope.
6. THE Action_System SHALL scope all School_Admin actions to the school identified by the schoolId claim in the JWT.

### Requirement 3: HOD Actions

**User Story:** As a Head of Department, I want to manage my department through the AI chat, so that I can add teachers and view department performance without navigating away from the assistant.

#### Acceptance Criteria

1. WHEN an HOD requests to add a teacher to their department, THE Action_System SHALL detect the intent and execute the assignment within the HOD's department scope.
2. WHEN an HOD requests to view department statistics, THE Action_System SHALL detect the intent and return attendance and performance data scoped to the HOD's departmentId.
3. THE Action_System SHALL scope all HOD actions to the department identified by the departmentId claim in the JWT.
4. IF an HOD requests an action targeting a department other than their own, THEN THE Action_System SHALL deny the request with a Denial_Response.

### Requirement 4: Teacher Actions

**User Story:** As a Teacher, I want to manage attendance sessions and knowledge entries through the AI chat, so that I can perform routine tasks hands-free.

#### Acceptance Criteria

1. WHEN a Teacher requests to start a session, THE Action_System SHALL detect the intent and initiate an attendance session for the Teacher's assigned class.
2. WHEN a Teacher requests to end a session, THE Action_System SHALL detect the intent, mark the action as destructive, and present a Confirmation_Prompt before ending the active session.
3. WHEN a Teacher requests to mark attendance for a student, THE Action_System SHALL detect the intent and record the attendance entry within the active session.
4. WHEN a Teacher requests to add a knowledge entry, THE Action_System SHALL detect the intent and create the knowledge record scoped to the Teacher's school.
5. THE Action_System SHALL scope all Teacher actions to the school and class identified by the schoolId and classId claims in the JWT.

### Requirement 5: Student Action Restrictions

**User Story:** As a system administrator, I want students to be restricted from performing any destructive actions through the AI chat, so that data integrity is preserved.

#### Acceptance Criteria

1. THE Action_System SHALL permit Student users to perform read-only queries only.
2. IF a Student requests a destructive or modifying action, THEN THE Action_System SHALL return a Denial_Response explaining that the action is not available for students.
3. THE Denial_Response for Student users SHALL include a suggestion of read-only queries the student can perform.

### Requirement 6: Hybrid Intent Detection

**User Story:** As a developer, I want the system to use regex patterns first and fall back to LLM classification, so that detection is fast for common patterns and flexible for ambiguous input.

#### Acceptance Criteria

1. WHEN a user submits a message, THE Intent_Detector SHALL first attempt to match the message against regex patterns defined in the Role_Action_Registry for the user's role.
2. IF regex patterns produce a match, THEN THE Intent_Detector SHALL return the detected action without invoking the LLM_Fallback.
3. IF regex patterns produce no match, THEN THE Intent_Detector SHALL invoke the LLM_Fallback to classify the user's intent against the actions permitted for the user's role.
4. THE LLM_Fallback SHALL receive only the list of actions permitted for the requesting user's role as classification candidates.
5. IF the LLM_Fallback classifies the intent as an action, THEN THE Intent_Detector SHALL extract parameters from the user's message and return the detected action.
6. IF neither regex patterns nor LLM_Fallback detect an action, THEN THE Intent_Detector SHALL return a non-action result allowing the message to proceed through the normal AI query pipeline.

### Requirement 7: Destructive Action Confirmation

**User Story:** As a user, I want the system to ask for confirmation before performing destructive actions, so that I do not accidentally modify or delete data.

#### Acceptance Criteria

1. WHEN the Action_Executor receives a detected action marked as destructive, THE Action_Executor SHALL return a Confirmation_Prompt describing the action and its consequences.
2. WHEN the user confirms a pending destructive action, THE Action_Executor SHALL execute the action and return the result.
3. IF the user declines a pending destructive action, THEN THE Action_Executor SHALL cancel the action and return a cancellation acknowledgment.
4. THE Confirmation_Prompt SHALL include the action name, affected resource, and a description of the consequences.

### Requirement 8: Out-of-Scope Action Denial

**User Story:** As a user, I want to receive a helpful message when I request an action outside my role, so that I understand my permissions and know what I can do instead.

#### Acceptance Criteria

1. IF a user requests an action that exists in the Role_Action_Registry but is not permitted for the user's role, THEN THE Action_System SHALL return a Denial_Response.
2. THE Denial_Response SHALL state that the requested action is not available for the user's role.
3. THE Denial_Response SHALL include a suggestion of actions the user is permitted to perform.
4. THE Action_System SHALL log denied action attempts for audit purposes.

### Requirement 9: Single Executor Architecture

**User Story:** As a developer, I want a single action executor that dispatches to role-specific handlers, so that the execution logic is centralized and consistent.

#### Acceptance Criteria

1. THE Action_Executor SHALL validate that the detected action is permitted for the requesting user's role before execution.
2. THE Action_Executor SHALL extract the user's scope (schoolId, departmentId, classId) from the JWT and pass the scope to the action handler.
3. WHEN an action executes successfully, THE Action_Executor SHALL return a structured response containing the result message and any relevant data.
4. IF an action execution fails, THEN THE Action_Executor SHALL return an error response without exposing internal system details.
5. THE Action_Executor SHALL create an audit log entry for every executed action, recording the actor, role, action type, and affected resource.

### Requirement 10: Backward Compatibility

**User Story:** As a system maintainer, I want the new role-action system to preserve existing SUPER_ADMIN functionality, so that current behavior is not disrupted.

#### Acceptance Criteria

1. THE Action_System SHALL continue to support all existing SUPER_ADMIN actions (suspend_school, unsuspend_school, generate_license, extend_license, get_school_info, get_system_stats) without modification to their behavior.
2. THE Action_System SHALL migrate existing SUPER_ADMIN action patterns into the Role_Action_Registry format.
3. WHEN a SUPER_ADMIN submits an action request, THE Action_System SHALL process the request using the same detection and execution flow as other roles.
