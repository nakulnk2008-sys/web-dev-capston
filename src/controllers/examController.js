const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const User = require('../models/User');
const Group = require('../models/Group');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const { parsePagination, pageMeta } = require('../utils/pagination');
const bus = require('../events/appEvents');
const ROLES = require('../utils/roles');
const { isAssigned, eligibleStudentIds, getOwnedExam, examState } = require('../services/examService');

const uniq = (arr = []) => [...new Set(arr.map(String))];

/** Validates every referenced id exists (and that students really are students). */
async function validateReferences({ questions, assignedStudents, assignedGroups }, user) {
  if (questions) {
    const filter = { _id: { $in: questions } };
    if (user.role !== ROLES.ADMIN) filter.createdBy = user._id; // faculty can only use their own question bank
    if ((await Question.countDocuments(filter)) !== uniq(questions).length) {
      throw new AppError('One or more questions do not exist or are not in your question bank', 400);
    }
  }
  if (assignedStudents && (await User.countDocuments({ _id: { $in: assignedStudents }, role: ROLES.STUDENT })) !== uniq(assignedStudents).length) {
    throw new AppError('One or more assigned students do not exist', 400);
  }
  if (assignedGroups && (await Group.countDocuments({ _id: { $in: assignedGroups } })) !== uniq(assignedGroups).length) {
    throw new AppError('One or more assigned groups do not exist', 400);
  }
}

const pickFields = (body) => {
  const f = {};
  ['title', 'instructions', 'durationMinutes', 'startTime', 'endTime', 'questions', 'selection',
    'assignedStudents', 'assignedGroups', 'negativeMarking', 'maxAttempts', 'showCorrectAnswers'].forEach((k) => {
    if (body[k] !== undefined) f[k] = body[k];
  });
  if (f.questions) f.questions = uniq(f.questions);
  if (f.assignedStudents) f.assignedStudents = uniq(f.assignedStudents);
  if (f.assignedGroups) f.assignedGroups = uniq(f.assignedGroups);
  return f;
};

exports.create = asyncHandler(async (req, res) => {
  const fields = pickFields(req.body);
  await validateReferences(fields, req.user);
  const exam = await Exam.create({ ...fields, createdBy: req.user._id });
  created(res, exam, 'Exam created (draft)');
});

exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = req.user.role === ROLES.ADMIN ? {} : { createdBy: req.user._id };
  if (req.query.status) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    Exam.find(filter).select('-questions').sort({ startTime: -1 }).skip(skip).limit(limit),
    Exam.countDocuments(filter),
  ]);
  ok(res, items, undefined, 200, pageMeta(total, page, limit));
});

// Student view of assigned, published exams. No questions and no answer data.
exports.listAssigned = asyncHandler(async (req, res) => {
  const exams = await Exam.find({
    status: 'published',
    $or: [{ assignedStudents: req.user._id }, { assignedGroups: { $in: req.user.groups } }],
  })
    .select('title instructions durationMinutes startTime endTime maxAttempts resultsReleased')
    .sort({ startTime: 1 })
    .lean();
  const counts = await Attempt.aggregate([
    { $match: { student: req.user._id, exam: { $in: exams.map((e) => e._id) } } },
    { $group: { _id: '$exam', used: { $sum: 1 } } },
  ]);
  const used = new Map(counts.map((c) => [String(c._id), c.used]));
  const now = new Date();
  ok(res, exams.map((e) => ({ ...e, state: examState(e, now), attemptsUsed: used.get(String(e._id)) || 0 })));
});

exports.get = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.STUDENT) {
    const exam = await Exam.findById(req.params.id)
      .select('title instructions durationMinutes startTime endTime maxAttempts status assignedStudents assignedGroups resultsReleased');
    if (!exam || exam.status !== 'published') throw new AppError('Exam not found', 404);
    if (!isAssigned(req.user, exam)) throw new AppError('This examination is not assigned to you', 403);
    const { assignedStudents, assignedGroups, status, ...safe } = exam.toObject();
    return ok(res, { ...safe, state: examState(exam) });
  }
  const exam = await getOwnedExam(req.params.id, req.user);
  ok(res, await exam.populate([{ path: 'questions', select: 'text subject topic difficulty marks' }, { path: 'assignedGroups', select: 'name' }]));
});

exports.update = asyncHandler(async (req, res) => {
  const exam = await getOwnedExam(req.params.id, req.user);
  if (exam.status !== 'draft') throw new AppError('Only draft exams can be edited', 409);
  const fields = pickFields(req.body);
  await validateReferences(fields, req.user);
  exam.set(fields);
  await exam.save();
  ok(res, exam, 'Exam updated');
});

exports.remove = asyncHandler(async (req, res) => {
  const exam = await getOwnedExam(req.params.id, req.user);
  if (await Attempt.exists({ exam: exam._id })) throw new AppError('Exam has attempts and cannot be deleted', 409);
  await exam.deleteOne();
  ok(res, undefined, 'Exam deleted');
});

exports.publish = asyncHandler(async (req, res) => {
  const exam = await getOwnedExam(req.params.id, req.user);
  if (exam.status === 'published') throw new AppError('Exam is already published', 409);
  if (!exam.questions.length) throw new AppError('Add at least one question before publishing', 409);
  if (exam.selection.questionCount && exam.selection.questionCount > exam.questions.length) {
    throw new AppError('selection.questionCount exceeds the number of questions in the pool', 409);
  }
  if (!exam.assignedStudents.length && !exam.assignedGroups.length) {
    throw new AppError('Assign the exam to at least one student or group before publishing', 409);
  }
  if (exam.endTime <= new Date()) throw new AppError('Exam end time is in the past', 409);
  exam.status = 'published';
  await exam.save();
  bus.emit('exam.published', { exam, actorId: req.user._id, studentIds: await eligibleStudentIds(exam) });
  ok(res, exam, 'Exam published');
});

exports.releaseResults = asyncHandler(async (req, res) => {
  const exam = await getOwnedExam(req.params.id, req.user);
  if (exam.status !== 'published') throw new AppError('Exam is not published', 409);
  if (exam.endTime > new Date()) throw new AppError('Results can only be released after the exam window closes', 409);
  if (exam.resultsReleased) throw new AppError('Results are already released', 409);
  if (await Attempt.exists({ exam: exam._id, status: 'in_progress' })) {
    throw new AppError('Some attempts are still in progress', 409);
  }
  exam.resultsReleased = true;
  await exam.save();
  bus.emit('results.released', { exam, actorId: req.user._id, studentIds: await eligibleStudentIds(exam) });
  ok(res, exam, 'Results released');
});

// --- Faculty monitoring / results -------------------------------------------------------------

exports.listAttempts = asyncHandler(async (req, res) => {
  const exam = await getOwnedExam(req.params.id, req.user);
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { exam: exam._id };
  if (req.query.status) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    Attempt.find(filter).select('-questions -evaluation').populate('student', 'name email rollNumber')
      .sort({ startedAt: -1 }).skip(skip).limit(limit).lean(),
    Attempt.countDocuments(filter),
  ]);
  ok(res, items.map((a) => ({ ...a, answeredCount: a.answers.length, answers: undefined })), undefined, 200, pageMeta(total, page, limit));
});

exports.results = asyncHandler(async (req, res) => {
  const exam = await getOwnedExam(req.params.id, req.user);
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { exam: exam._id, status: { $in: ['submitted', 'auto_submitted'] } };
  const [items, total] = await Promise.all([
    Attempt.find(filter).select('student attemptNumber score totalMarks correctCount submittedAt status')
      .populate('student', 'name email rollNumber').sort({ score: -1, submittedAt: 1 }).skip(skip).limit(limit),
    Attempt.countDocuments(filter),
  ]);
  ok(res, items, undefined, 200, pageMeta(total, page, limit));
});

exports.auditLog = asyncHandler(async (req, res) => {
  const exam = await getOwnedExam(req.params.id, req.user);
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20 });
  const [items, total] = await Promise.all([
    AuditLog.find({ exam: exam._id }).populate('actor', 'name role').sort({ createdAt: -1 }).skip(skip).limit(limit),
    AuditLog.countDocuments({ exam: exam._id }),
  ]);
  ok(res, items, undefined, 200, pageMeta(total, page, limit));
});

/**
 * Analytics (MongoDB aggregation pipelines). "Best attempt per student" is used so retakes
 * don't skew the statistics.
 */
exports.analytics = asyncHandler(async (req, res) => {
  const exam = await getOwnedExam(req.params.id, req.user);
  const examId = exam._id;
  const done = { exam: examId, status: { $in: ['submitted', 'auto_submitted'] }, totalMarks: { $gt: 0 } };
  const bestPerStudent = [
    { $match: done },
    { $sort: { score: -1, submittedAt: 1 } },
    { $group: { _id: '$student', score: { $first: '$score' }, totalMarks: { $first: '$totalMarks' } } },
    { $addFields: { percentage: { $multiply: [{ $divide: ['$score', '$totalMarks'] }, 100] } } },
  ];

  const [summary, questionWise, sectionWise, distribution] = await Promise.all([
    // 1. Overall score statistics
    Attempt.aggregate([
      ...bestPerStudent,
      { $group: { _id: null, students: { $sum: 1 }, averageScore: { $avg: '$score' }, highestScore: { $max: '$score' },
          lowestScore: { $min: '$score' }, averagePercentage: { $avg: '$percentage' }, totalMarks: { $first: '$totalMarks' } } },
      { $project: { _id: 0, students: 1, totalMarks: 1,
          averageScore: { $round: ['$averageScore', 2] }, highestScore: 1, lowestScore: 1,
          averagePercentage: { $round: ['$averagePercentage', 2] } } },
    ]),
    // 2. Question-wise performance
    Attempt.aggregate([
      { $match: done },
      { $unwind: '$evaluation' },
      { $group: { _id: '$evaluation.question', attempts: { $sum: 1 },
          answered: { $sum: { $cond: [{ $ifNull: ['$evaluation.selectedOption', false] }, 1, 0] } },
          correct: { $sum: { $cond: ['$evaluation.isCorrect', 1, 0] } } } },
      { $lookup: { from: 'questions', localField: '_id', foreignField: '_id', as: 'q' } },
      { $unwind: { path: '$q', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, questionId: '$_id', text: '$q.text', topic: '$q.topic', difficulty: '$q.difficulty',
          attempts: 1, answered: 1, correct: 1,
          correctRate: { $round: [{ $multiply: [{ $divide: ['$correct', '$attempts'] }, 100] }, 2] } } },
      { $sort: { correctRate: 1 } },
    ]),
    // 3. Section (group) wise performance
    Attempt.aggregate([
      ...bestPerStudent,
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
      { $unwind: '$u' },
      { $unwind: '$u.groups' },
      ...(exam.assignedGroups.length ? [{ $match: { 'u.groups': { $in: exam.assignedGroups } } }] : []),
      { $lookup: { from: 'groups', localField: 'u.groups', foreignField: '_id', as: 'g' } },
      { $unwind: '$g' },
      { $group: { _id: '$g._id', section: { $first: '$g.name' }, students: { $sum: 1 }, averageScore: { $avg: '$score' },
          highestScore: { $max: '$score' }, lowestScore: { $min: '$score' }, averagePercentage: { $avg: '$percentage' } } },
      { $project: { _id: 0, groupId: '$_id', section: 1, students: 1, highestScore: 1, lowestScore: 1,
          averageScore: { $round: ['$averageScore', 2] }, averagePercentage: { $round: ['$averagePercentage', 2] } } },
      { $sort: { section: 1 } },
    ]),
    // 4. Score distribution
    Attempt.aggregate([
      ...bestPerStudent,
      { $bucket: { groupBy: '$percentage', boundaries: [0, 40, 60, 80, 100.0001], default: 'other',
          output: { students: { $sum: 1 } } } },
    ]),
  ]);

  const labels = { 0: '0-39%', 40: '40-59%', 60: '60-79%', 80: '80-100%' };
  ok(res, {
    exam: { id: exam._id, title: exam.title },
    summary: summary[0] || { students: 0, averageScore: 0, highestScore: 0, lowestScore: 0, averagePercentage: 0 },
    questionWise,
    sectionWise,
    scoreDistribution: distribution.map((b) => ({ range: labels[b._id] || 'other', students: b.students })),
  });
});
