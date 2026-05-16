export interface DateRange {
    from: Date;
    to: Date;
}
export interface StudentReportData {
    studentId: string;
    studentName: string;
    totalSessions: number;
    totalExpected: number;
    totalPresent: number;
    totalLate: number;
    totalExcused: number;
    totalAbsent: number;
    attendancePercentage: number;
}
export interface ClassReportData {
    classId: string;
    className: string;
    totalSessions: number;
    students: StudentReportData[];
    averageAttendancePercentage: number;
}
export interface DepartmentReportData {
    departmentId: string;
    departmentName: string;
    classes: ClassReportData[];
    averageAttendancePercentage: number;
}
export interface SchoolReportData {
    schoolId: string;
    schoolName: string;
    departments: DepartmentReportData[];
    averageAttendancePercentage: number;
}
export declare class ReportService {
    /**
     * Get attendance report for a single student.
     * Attendance % = (totalPresent / totalExpected) * 100, rounded to 2 dp
     * Requirements: 10.1, 10.5, 10.7
     */
    getStudentReport(schoolId: string, studentId: string, dateRange?: DateRange): Promise<StudentReportData>;
    /**
     * Get attendance report for a class.
     * Aggregates attendance data for all students in the class.
     * Requirements: 10.2, 10.5, 10.7
     */
    getClassReport(schoolId: string, classId: string, dateRange?: DateRange): Promise<ClassReportData>;
    /**
     * Get attendance report for a department.
     * Aggregates attendance data across all classes in the department.
     * Requirements: 10.3, 10.5, 10.7
     */
    getDepartmentReport(schoolId: string, departmentId: string, dateRange?: DateRange): Promise<DepartmentReportData>;
    /**
     * Get attendance report for the entire school.
     * Aggregates attendance data across all departments in the school.
     * Requirements: 10.4, 10.5, 10.7
     */
    getSchoolReport(schoolId: string, dateRange?: DateRange): Promise<SchoolReportData>;
    /**
     * Export report by reportId and format.
     * reportId format: "type:schoolId:targetId" (e.g., "student:school-1:student-1")
     * For school reports: "school:school-1"
     * Accepts optional dateRange encoded as query params in the reportId or as a separate param.
     * Requirements: 10.6
     */
    exportReportById(reportId: string, format: 'pdf' | 'excel', dateRange?: DateRange): Promise<Buffer>;
    /**
     * Export report data to PDF, Excel, or CSV format.
     * Requirements: 10.6
     */
    exportReport(data: StudentReportData | ClassReportData | DepartmentReportData | SchoolReportData, format: 'pdf' | 'excel' | 'csv'): Promise<Buffer>;
    private _exportPDF;
    private _exportExcel;
    private _exportCSV;
    private _escapeCSV;
}
export declare const reportService: ReportService;
//# sourceMappingURL=reportService.d.ts.map