const mongoose = require('mongoose');
const Attempt = require('../models/Attempt');
const User = require('../models/User');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const ROLES = require('../utils/roles');

const oid = (v) => new mongoose.Types.ObjectId(v);

/**
 * Student performance across exams (aggregation).
 *  - student  : own results, only for exams whose results are released
 *  - faculty  : the student's results for exams the faculty created
 *  - admin    : everything
 */
exports.studentPerformance = asyncHandler(async (req, res) => {
  const studentId = req.params.studentId;
  if (req.user.role === ROLES.STUDENT && String(req.user._id) !== studentId) {
    throw new AppError('You can only view your own performance', 403);
  }
  const student = await User.findOne({ _id: studentId, role: ROLES.STUDENT }).select('name email rollNumber');
  if (!student) throw new AppError('Student not found', 404);

  const examMatch = {};
  if (req.user.role === ROLES.STUDENT) examMatch['exam.resultsReleased'] = true;
  if (req.user.role === ROLES.FACULTY) examMatch['exam.createdBy'] = req.user._id;

  const rows = await Attempt.aggregate([
    { $match: { student: oid(studentId), status: { $in: ['submitted', 'auto_submitted'] }, totalMarks: { $gt: 0 } } },
    { $lookup: { from: 'exams', localField: 'exam', foreignField: '_id', as: 'exam' } },
    { $unwind: '$exam' },
    { $match: examMatch },
    { $sort: { score: -1 } },
    { $group: { _id: '$exam._id', title: { $first: '$exam.title' }, bestScore: { $first: '$score' }, totalMarks: { $first: '$totalMarks' },
        attempts: { $sum: 1 }, lastSubmittedAt: { $max: '$submittedAt' } } },
    { $addFields: { percentage: { $round: [{ $multiply: [{ $divide: ['$bestScore', '$totalMarks'] }, 100] }, 2] } } },
    { $sort: { lastSubmittedAt: -1 } },
    { $group: { _id: null, exams: { $push: { examId: '$_id', title: '$title', bestScore: '$bestScore', totalMarks: '$totalMarks', percentage: '$percentage', attempts: '$attempts' } },
        examsTaken: { $sum: 1 }, averagePercentage: { $avg: '$percentage' } } },
    { $project: { _id: 0, exams: 1, examsTaken: 1, averagePercentage: { $round: ['$averagePercentage', 2] } } },
  ]);
  ok(res, { student, ...(rows[0] || { exams: [], examsTaken: 0, averagePercentage: 0 }) });
});

/** Admin: platform overview using $facet / $group. */
exports.platform = asyncHandler(async (_req, res) => {
  const [users, exams, attempts, questions] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    Exam.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Attempt.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Question.aggregate([{ $group: { _id: '$difficulty', count: { $sum: 1 } } }]),
  ]);
  const toMap = (arr) => Object.fromEntries(arr.map((r) => [r._id, r.count]));
  ok(res, { usersByRole: toMap(users), examsByStatus: toMap(exams), attemptsByStatus: toMap(attempts), questionsByDifficulty: toMap(questions) });
});
