"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roleActionRegistry = void 0;
exports.getActionsForRole = getActionsForRole;
exports.findAction = findAction;
exports.isActionPermitted = isActionPermitted;
exports.getActionNames = getActionNames;
const superAdminHandlers_1 = require("./handlers/superAdminHandlers");
const schoolAdminHandlers_1 = require("./handlers/schoolAdminHandlers");
const hodHandlers_1 = require("./handlers/hodHandlers");
const teacherHandlers_1 = require("./handlers/teacherHandlers");
const studentHandlers_1 = require("./handlers/studentHandlers");
// ─── Registry ─────────────────────────────────────────────────────────────────
// Registry - populated by handler imports
exports.roleActionRegistry = {};
exports.roleActionRegistry['SUPER_ADMIN'] = superAdminHandlers_1.superAdminActions;
exports.roleActionRegistry['SCHOOL_ADMIN'] = schoolAdminHandlers_1.schoolAdminActions;
exports.roleActionRegistry['HOD'] = hodHandlers_1.hodActions;
exports.roleActionRegistry['TEACHER'] = teacherHandlers_1.teacherActions;
exports.roleActionRegistry['STUDENT'] = studentHandlers_1.studentActions;
// ─── Lookup Utilities ─────────────────────────────────────────────────────────
function getActionsForRole(role) {
    return exports.roleActionRegistry[role] ?? [];
}
function findAction(role, actionName) {
    return getActionsForRole(role).find((a) => a.action === actionName);
}
function isActionPermitted(role, actionName) {
    return getActionsForRole(role).some((a) => a.action === actionName);
}
function getActionNames(role) {
    return getActionsForRole(role).map((a) => a.action);
}
//# sourceMappingURL=roleActionRegistry.js.map