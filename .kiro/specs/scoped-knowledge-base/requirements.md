# Requirements Document

## Introduction

The Scoped AI Knowledge Base feature extends the existing global AIKnowledge model in SAMS to support role-based, hierarchically scoped knowledge entries. Currently, only Super Admins can manage knowledge entries and all entries are globally visible. This feature allows School Admins, HODs, and Teachers to contribute knowledge entries scoped to their school, department, or class respectively. Students consume this knowledge through the AI chat — receiving contextually relevant answers drawn from all applicable scopes (school-wide, department, and class-level entries).

## Glossary

- **Knowledge_Entry**: A record in the AIKnowledge table containing a title, content, category, and scope metadata (schoolId, departmentId, classId, createdById)
- **Knowledge_Service**: The backend service responsible for CRUD operations on Knowledge_Entry records and scoped retrieval for AI context injection
- **Knowledge_Management_Page**: The frontend page where staff (School Admin, HOD, Teacher) can create, edit, and delete Knowledge_Entry records within their scope
- **Scope_Level**: The visibility boundary of a Knowledge_Entry — one of school, department, or class
- **AI_Chat_Engine**: The OpenAI/Groq engine (openaiEngine.ts) that builds system prompts and injects knowledge context into AI responses
- **Staff_User**: A user with role SCHOOL_ADMIN, HOD, or TEACHER
- **SAMS**: Smart Attendance Management System

## Requirements

### Requirement 1: Knowledge Entry Data Model Extension

**User Story:** As a system architect, I want the AIKnowledge model to include scope fields, so that knowledge entries can be associated with a specific school, department, class, and creator.

#### Acceptance Criteria

1. THE Knowledge_Entry SHALL include a required schoolId field referencing the School entity
2. THE Knowledge_Entry SHALL include an optional departmentId field referencing the Department entity
3. THE Knowledge_Entry SHALL include an optional classId field referencing the Class entity
4. THE Knowledge_Entry SHALL include a required createdById field referencing the User entity
5. WHEN a Knowledge_Entry has only schoolId populated (departmentId and classId are null), THE Knowledge_Service SHALL treat the entry as school-wide scope
6. WHEN a Knowledge_Entry has schoolId and departmentId populated (classId is null), THE Knowledge_Service SHALL treat the entry as department scope
7. WHEN a Knowledge_Entry has schoolId, departmentId, and classId populated, THE Knowledge_Service SHALL treat the entry as class scope

### Requirement 2: Role-Based Knowledge Creation Authorization

**User Story:** As a staff member, I want to add knowledge entries scoped to my area of responsibility, so that students and colleagues in my scope can benefit from the information.

#### Acceptance Criteria

1. WHEN a user with role SCHOOL_ADMIN creates a Knowledge_Entry, THE Knowledge_Service SHALL set the schoolId to the user's school and leave departmentId and classId null
2. WHEN a user with role HOD creates a Knowledge_Entry, THE Knowledge_Service SHALL set the schoolId to the user's school and departmentId to the user's department, leaving classId null
3. WHEN a user with role TEACHER creates a Knowledge_Entry, THE Knowledge_Service SHALL set the schoolId to the user's school, departmentId to the user's department, and classId to the user's class
4. WHEN a user with role STUDENT attempts to create a Knowledge_Entry, THE Knowledge_Service SHALL reject the request with a 403 Forbidden response
5. WHEN an unauthenticated user attempts to create a Knowledge_Entry, THE Knowledge_Service SHALL reject the request with a 401 Unauthorized response

### Requirement 3: Knowledge Entry Management (Edit and Delete)

**User Story:** As a staff member, I want to edit and delete knowledge entries I created, so that I can keep the knowledge base accurate and up to date.

#### Acceptance Criteria

1. WHEN a Staff_User requests to update a Knowledge_Entry, THE Knowledge_Service SHALL allow the update only if the user is the creator of the entry
2. WHEN a user with role SCHOOL_ADMIN requests to update a Knowledge_Entry within their school, THE Knowledge_Service SHALL allow the update regardless of who created the entry
3. WHEN a Staff_User requests to delete a Knowledge_Entry, THE Knowledge_Service SHALL allow the deletion only if the user is the creator of the entry
4. WHEN a user with role SCHOOL_ADMIN requests to delete a Knowledge_Entry within their school, THE Knowledge_Service SHALL allow the deletion regardless of who created the entry
5. IF a Staff_User attempts to update or delete a Knowledge_Entry belonging to a different school, THEN THE Knowledge_Service SHALL reject the request with a 403 Forbidden response
6. IF a HOD attempts to update or delete a Knowledge_Entry created by another HOD in a different department, THEN THE Knowledge_Service SHALL reject the request with a 403 Forbidden response

### Requirement 4: Scoped Knowledge Retrieval for AI Chat

**User Story:** As a student, I want the AI assistant to answer my questions using knowledge from my school, department, and class, so that I receive contextually relevant information.

#### Acceptance Criteria

1. WHEN a student sends a query to the AI_Chat_Engine, THE AI_Chat_Engine SHALL retrieve Knowledge_Entry records matching the student's schoolId
2. WHEN a student sends a query to the AI_Chat_Engine, THE AI_Chat_Engine SHALL retrieve Knowledge_Entry records matching the student's departmentId
3. WHEN a student sends a query to the AI_Chat_Engine, THE AI_Chat_Engine SHALL retrieve Knowledge_Entry records matching the student's classId
4. THE AI_Chat_Engine SHALL combine school-wide, department, and class Knowledge_Entry records into the system prompt context
5. WHEN a teacher sends a query to the AI_Chat_Engine, THE AI_Chat_Engine SHALL retrieve Knowledge_Entry records matching the teacher's schoolId and classId
6. WHEN a HOD sends a query to the AI_Chat_Engine, THE AI_Chat_Engine SHALL retrieve Knowledge_Entry records matching the HOD's schoolId and departmentId
7. WHEN a School Admin sends a query to the AI_Chat_Engine, THE AI_Chat_Engine SHALL retrieve all Knowledge_Entry records within their school

### Requirement 5: Knowledge Entry Listing with Scope Filtering

**User Story:** As a staff member, I want to view knowledge entries relevant to my scope, so that I can manage and review the knowledge base effectively.

#### Acceptance Criteria

1. WHEN a SCHOOL_ADMIN requests the knowledge list, THE Knowledge_Service SHALL return all Knowledge_Entry records within their school
2. WHEN a HOD requests the knowledge list, THE Knowledge_Service SHALL return Knowledge_Entry records scoped to their school (school-wide) and their department
3. WHEN a TEACHER requests the knowledge list, THE Knowledge_Service SHALL return Knowledge_Entry records scoped to their school (school-wide), their department, and their class
4. THE Knowledge_Service SHALL include the creator's name and role in each Knowledge_Entry response
5. THE Knowledge_Service SHALL support pagination with configurable page size for the knowledge list endpoint

### Requirement 6: Knowledge Management Frontend Page

**User Story:** As a staff member, I want a dedicated page to manage knowledge entries, so that I can add, edit, and delete entries through a user-friendly interface.

#### Acceptance Criteria

1. THE Knowledge_Management_Page SHALL be accessible to users with role SCHOOL_ADMIN, HOD, or TEACHER
2. THE Knowledge_Management_Page SHALL NOT be accessible to users with role STUDENT
3. THE Knowledge_Management_Page SHALL display a list of Knowledge_Entry records relevant to the user's scope
4. THE Knowledge_Management_Page SHALL provide a form to create new Knowledge_Entry records with title, content, and category fields
5. THE Knowledge_Management_Page SHALL provide inline edit functionality for Knowledge_Entry records the user is authorized to modify
6. THE Knowledge_Management_Page SHALL provide a delete action with confirmation dialog for Knowledge_Entry records the user is authorized to remove
7. THE Knowledge_Management_Page SHALL display the Scope_Level (school, department, or class) for each Knowledge_Entry as a visual badge

### Requirement 7: Knowledge Entry Validation

**User Story:** As a system, I want to validate knowledge entries before persisting them, so that the knowledge base maintains data quality.

#### Acceptance Criteria

1. THE Knowledge_Service SHALL reject a Knowledge_Entry with a title shorter than 1 character or longer than 200 characters
2. THE Knowledge_Service SHALL reject a Knowledge_Entry with empty content
3. THE Knowledge_Service SHALL reject a Knowledge_Entry with a category longer than 50 characters
4. IF a Knowledge_Entry references a departmentId that does not belong to the user's school, THEN THE Knowledge_Service SHALL reject the request with a 400 Bad Request response
5. IF a Knowledge_Entry references a classId that does not belong to the user's department, THEN THE Knowledge_Service SHALL reject the request with a 400 Bad Request response

### Requirement 8: Cross-School Isolation

**User Story:** As a school administrator, I want knowledge entries to be strictly isolated between schools, so that no school can access another school's knowledge.

#### Acceptance Criteria

1. THE Knowledge_Service SHALL filter all Knowledge_Entry queries by the authenticated user's schoolId
2. IF a user attempts to access a Knowledge_Entry belonging to a different school, THEN THE Knowledge_Service SHALL return a 404 Not Found response
3. THE AI_Chat_Engine SHALL include only Knowledge_Entry records from the querying user's school in the system prompt context
