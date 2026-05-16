# Requirements Document

## Introduction

This feature extends the existing registration link system to give HODs (Heads of Department) full control over generating registration links for both Teachers and Students within their department. Currently, the backend defaults HOD-created links to the TEACHER role only. This feature enables HODs to explicitly choose the target role (TEACHER or STUDENT), select a class when targeting students, and access a dedicated Registration Links page from the HOD dashboard. Additionally, the notification system is enhanced to display sender information and allow senders to edit or delete their own notifications.

## Glossary

- **System**: The SAMS (Smart Attendance Management System) application as a whole
- **HOD_Dashboard**: The dashboard page displayed to users with the HOD role
- **Registration_Link_Service**: The backend service responsible for generating, resolving, and managing registration links
- **Registration_Links_Page**: The frontend page that displays and manages registration links
- **Notification_Service**: The backend service responsible for creating, delivering, and managing notifications
- **HOD**: A user with the Head of Department role, scoped to a single department
- **Target_Role**: The role assigned to users who register via a registration link (TEACHER or STUDENT)
- **Department**: An organizational unit within a school containing classes and users
- **Class**: A student grouping within a department

## Requirements

### Requirement 1: HOD Target Role Selection

**User Story:** As an HOD, I want to choose whether a registration link is for a Teacher or a Student, so that I can onboard both types of users within my department.

#### Acceptance Criteria

1. WHEN an HOD generates a registration link, THE Registration_Links_Page SHALL display a role selector with exactly two options: TEACHER and STUDENT.
2. WHEN an HOD selects TEACHER as the target role, THE Registration_Link_Service SHALL create a link with targetRole set to TEACHER and SHALL embed the HOD's schoolId and departmentId in the link.
3. WHEN an HOD selects STUDENT as the target role, THE Registration_Link_Service SHALL require the HOD to also select a target class within the HOD's department and SHALL create a link with targetRole set to STUDENT and the selected classId embedded.
4. IF an HOD submits a link generation request without selecting a target role, THEN THE Registration_Link_Service SHALL default the targetRole to TEACHER and SHALL indicate the applied default to the HOD in the response.
5. IF an HOD submits a link generation request with a target role value other than TEACHER or STUDENT, THEN THE Registration_Link_Service SHALL reject the request and return an error message indicating the valid role options.

### Requirement 2: Class Selection for Student Links

**User Story:** As an HOD, I want to select a class within my department when generating a student registration link, so that students are assigned to the correct class upon registration.

#### Acceptance Criteria

1. WHEN an HOD selects STUDENT as the target role, THE Registration_Links_Page SHALL display a class selector populated with all classes belonging to the HOD's assigned department and SHALL require the HOD to select a class before the link can be generated.
2. WHEN an HOD selects a class and generates a student link, THE Registration_Link_Service SHALL validate that the selected classId belongs to the HOD's assigned department and SHALL store the validated classId on the registration link.
3. IF no classes exist in the HOD's department, THEN THE Registration_Links_Page SHALL display a message indicating no classes are available and SHALL disable the link generation action.
4. WHEN a student registers via a link with a classId, THE Registration_Link_Service SHALL assign the student to the specified class and the associated department.
5. IF a student registers via a link whose associated class has reached its configured capacity, THEN THE Registration_Link_Service SHALL reject the registration and return an error message indicating the class is full.
6. IF a student registers via a link whose associated classId references a class that no longer exists, THEN THE Registration_Link_Service SHALL reject the registration and return an error message indicating the link is no longer valid.
7. IF an HOD attempts to generate a student link with a classId that does not belong to the HOD's assigned department, THEN THE Registration_Link_Service SHALL reject the request and return a 403 Forbidden response.

### Requirement 3: HOD Dashboard Registration Links Access

**User Story:** As an HOD, I want a quick action on my dashboard to access Registration Links, so that I can manage links without navigating through the admin panel.

#### Acceptance Criteria

1. THE HOD_Dashboard SHALL display a "Registration Links" quick action card within the quick actions grid section alongside the existing HOD quick actions (View Reports, Risk Scores, Manage Users, Timetable, Notifications, AI Assistant)
2. WHEN an HOD clicks the "Registration Links" quick action card, THE System SHALL navigate to the Registration Links page at the `/admin/links` route within 1 second
3. THE Registration_Links_Page at `/admin/links` SHALL be accessible to users with the HOD role via the existing role-based access guard
4. IF a non-HOD and non-SCHOOL_ADMIN user attempts to access the `/admin/links` route directly, THEN THE System SHALL redirect the user to the dashboard page

### Requirement 4: HOD-Scoped Link Visibility

**User Story:** As an HOD, I want to see only the registration links I created, so that I manage links relevant to my department without seeing other departments' links.

#### Acceptance Criteria

1. WHEN an HOD views the Registration Links page, THE Registration_Link_Service SHALL return only links where createdById matches the HOD's user ID, sorted by creation date in descending order
2. THE Registration_Links_Page SHALL display the target role, usage count, maximum uses, expiry date, and status for each link, where status is one of: active (not expired and useCount below maxUses), expired (current date is past expiresAt), or exhausted (useCount has reached maxUses)
3. WHEN a SCHOOL_ADMIN views the Registration Links page, THE Registration_Link_Service SHALL return all links for the school scoped to the SCHOOL_ADMIN's schoolId
4. IF a user with a role other than HOD or SCHOOL_ADMIN attempts to access the Registration Links page, THEN THE Registration_Link_Service SHALL return a 403 Forbidden response
5. WHEN an HOD views the Registration Links page and has no links, THE Registration_Links_Page SHALL display an empty state indicating no registration links have been created

### Requirement 5: HOD Link Deletion

**User Story:** As an HOD, I want to delete registration links I created, so that I can revoke access when links are no longer needed.

#### Acceptance Criteria

1. WHEN an HOD requests deletion of a link they created, THE Registration_Link_Service SHALL verify that the link's `createdById` matches the requesting HOD's userId and SHALL permanently remove the link record from the system.
2. IF an HOD requests deletion of a link they did not create, THEN THE Registration_Link_Service SHALL reject the request with a 403 Forbidden error and SHALL not modify the link.
3. IF an HOD requests deletion of a link that does not exist or does not belong to the HOD's school, THEN THE Registration_Link_Service SHALL return a 404 Not Found error.
4. WHEN a link is successfully deleted, THE Registration_Links_Page SHALL remove the link from the displayed list within 1 second without requiring a full page reload.
5. WHEN a link is deleted, THE Registration_Link_Service SHALL preserve all user accounts that were previously created via that link.

### Requirement 6: Notification Sender Display

**User Story:** As a user receiving notifications, I want to see who sent each notification, so that I know the source of the message.

#### Acceptance Criteria

1. WHEN a notification is created by a user action, THE Notification_Service SHALL store the sender's user ID on the notification record
2. WHEN notifications are retrieved, THE Notification_Service SHALL include the sender's full name in the response by resolving the stored sender user ID
3. IF the sender's account has been deleted or is no longer available when notifications are retrieved, THEN THE Notification_Service SHALL return a fallback label of "Deleted User" in place of the sender's full name
4. IF a notification is system-generated with no human sender, THEN THE Notification_Service SHALL store a null sender ID and THE Registration_Links_Page SHALL display "System" as the sender name
5. THE Registration_Links_Page SHALL display the sender name adjacent to each notification entry in the notifications list, truncated to a maximum of 50 characters with an ellipsis if the name exceeds that length

### Requirement 7: Notification Sender Edit and Delete

**User Story:** As a notification sender, I want to edit or delete notifications I sent, so that I can correct mistakes or remove outdated messages.

#### Acceptance Criteria

1. WHEN a sender requests to edit a notification they created, THE Notification_Service SHALL update the notification message field with the new content, which must be between 1 and 1000 characters in length.
2. WHEN a sender requests to delete a notification they created, THE Notification_Service SHALL delete all notification records that share the same sender and were created in the same send operation across all recipients.
3. IF a user requests to edit or delete a notification they did not send, THEN THE Notification_Service SHALL return a 403 Forbidden error and SHALL NOT modify any notification records.
4. WHEN a notification is edited, THE Notification_Service SHALL record an updatedAt timestamp on all affected notification records for that send operation.
5. IF a sender requests to edit or delete a notification that was sent more than 24 hours ago, THEN THE Notification_Service SHALL reject the request and return an error message indicating the modification window has expired.
6. WHEN a notification is successfully edited, THE Notification_Service SHALL emit a real-time update event to all connected recipients so that the updated content is reflected without requiring a page refresh.
