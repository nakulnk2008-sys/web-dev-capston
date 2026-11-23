const Exam = require('../models/Exam');
const User = require('../models/User');
const ROLES = require('../utils/roles');
const AppError = require('../utils/AppError');

/** Is this (student) user assigned the exam directly or through one of their groups? */
exports.isAssigned = (user, exam) => {
  const uid = String(user._id);
  if (exam.assignedStudents.some((s) => String(s) === uid)) return true;
  const groups = new Set((user.groups || []).map(String));
  return exam.assignedGroups.some((g) => groups.has(String(g)));
};

/** All active student ids the exam is assigned to (directly or via groups). */
exports.eligibleStudentIds = async (exam) => {
  const or = [];
  if (exam.assignedStudents.length) or.push({ _id: { $in: exam.assignedStudents } });
  if (exam.assignedGroups.length) or.push({ groups: { $in: exam.assignedGroups } });
  if (!or.length) return [];
  return User.find({ role: ROLES.STUDENT, isActive: true, $or: or }).distinct('_id');
};

/** Loads an exam and ensures the staff user owns it (admin may access any). */
exports.getOwnedExam = async (id, user) => {
  const exam = await Exam.findById(id);
  if (!exam) throw new AppError('Exam not found', 404);
  if (user.role !== ROLES.ADMIN && String(exam.createdBy) !== String(user._id)) {
    throw new AppError('You do not have access to this exam', 403);
  }
  return exam;
};

exports.examState = (exam, now = new Date()) =>
  now < exam.startTime ? 'upcoming' : now >= exam.endTime ? 'closed' : 'open';
