const Question = require('../models/Question');
const Exam = require('../models/Exam');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const { parsePagination, pageMeta } = require('../utils/pagination');
const ROLES = require('../utils/roles');

async function ownedQuestion(id, user) {
  const q = await Question.findById(id);
  if (!q) throw new AppError('Question not found', 404);
  if (user.role !== ROLES.ADMIN && String(q.createdBy) !== String(user._id)) {
    throw new AppError('You do not have access to this question', 403);
  }
  return q;
}

// A question used by a published exam is frozen so live/finished exams stay consistent.
async function assertNotInPublishedExam(id) {
  if (await Exam.exists({ questions: id, status: 'published' })) {
    throw new AppError('Question is used in a published exam and cannot be modified or deleted', 409);
  }
}

exports.create = asyncHandler(async (req, res) => {
  created(res, await Question.create({ ...req.body, createdBy: req.user._id }), 'Question created');
});

exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = req.user.role === ROLES.ADMIN ? {} : { createdBy: req.user._id };
  ['subject', 'topic', 'difficulty'].forEach((k) => { if (req.query[k]) filter[k] = req.query[k]; });
  if (req.query.q) filter.$text = { $search: String(req.query.q) };
  const [items, total] = await Promise.all([
    Question.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Question.countDocuments(filter),
  ]);
  ok(res, items, undefined, 200, pageMeta(total, page, limit));
});

exports.get = asyncHandler(async (req, res) => ok(res, await ownedQuestion(req.params.id, req.user)));

exports.update = asyncHandler(async (req, res) => {
  const q = await ownedQuestion(req.params.id, req.user);
  await assertNotInPublishedExam(q._id);
  ['text', 'options', 'marks', 'subject', 'topic', 'difficulty'].forEach((k) => {
    if (req.body[k] !== undefined) q[k] = req.body[k];
  });
  await q.save();
  ok(res, q, 'Question updated');
});

exports.remove = asyncHandler(async (req, res) => {
  const q = await ownedQuestion(req.params.id, req.user);
  await assertNotInPublishedExam(q._id);
  await Exam.updateMany({ questions: q._id }, { $pull: { questions: q._id } }); // remove from drafts
  await q.deleteOne();
  ok(res, undefined, 'Question deleted');
});
