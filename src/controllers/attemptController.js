const Exam = require('../models/Exam');
const Attempt = require('../models/Attempt');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const { parsePagination, pageMeta } = require('../utils/pagination');
const bus = require('../events/appEvents');
const ROLES = require('../utils/roles');
const svc = require('../services/attemptService');

const remainingSeconds = (a) => Math.max(0, Math.floor((a.deadline - Date.now()) / 1000));

async function inProgressView(attempt) {
  return {
    attemptId: attempt._id,
    exam: attempt.exam,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    startedAt: attempt.startedAt,
    deadline: attempt.deadline,
    remainingSeconds: remainingSeconds(attempt),
    questions: await svc.presentQuestions(attempt),
    answers: attempt.answers.map((a) => ({ question: a.question, selectedOption: a.selectedOption })),
  };
}

/** Result view for a student: marks only when faculty has released results. */
function studentResultView(attempt, exam) {
  const base = { attemptId: attempt._id, exam: exam._id, attemptNumber: attempt.attemptNumber, status: attempt.status, submittedAt: attempt.submittedAt };
  if (!exam.resultsReleased) return { ...base, resultsReleased: false, message: 'Results have not been released yet' };
  return {
    ...base,
    resultsReleased: true,
    score: attempt.score,
    totalMarks: attempt.totalMarks,
    percentage: attempt.totalMarks ? Math.round((attempt.score / attempt.totalMarks) * 10000) / 100 : 0,
    correctCount: attempt.correctCount,
    details: attempt.evaluation.map((e) => ({
      question: e.question, selectedOption: e.selectedOption, isCorrect: e.isCorrect, marksAwarded: e.marksAwarded,
      ...(exam.showCorrectAnswers ? { correctOption: e.correctOption } : {}),
    })),
  };
}

/** Loads the attempt owned by the current student; auto-submits it if its time has run out. */
async function loadOwnAttempt(id, user) {
  const attempt = await Attempt.findById(id);
  // 404 (not 403) when it belongs to someone else, so attempt ids can't be probed
  if (!attempt || String(attempt.student) !== String(user._id)) throw new AppError('Attempt not found', 404);
  return attempt;
}

exports.start = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam || exam.status !== 'published') throw new AppError('Exam not found', 404);
  svc.assertCanAccess(req.user, exam);

  const now = new Date();
  if (now < exam.startTime) throw new AppError('Exam has not started yet', 403);
  if (now >= exam.endTime) throw new AppError('Exam window has closed', 403);

  // Resume an existing in-progress attempt (or close it if it already ran out of time)
  const existing = await Attempt.findOne({ exam: exam._id, student: req.user._id, status: 'in_progress' });
  if (existing) {
    if (!svc.isExpired(existing, now) && now <= existing.deadline) return ok(res, await inProgressView(existing), 'Attempt resumed');
    await svc.finalize(existing, { auto: true });
  }

  const used = await Attempt.countDocuments({ exam: exam._id, student: req.user._id });
  if (used >= exam.maxAttempts) {
    throw new AppError(exam.maxAttempts > 1 ? 'Maximum number of attempts reached' : 'You have already attempted this exam', 409);
  }

  const questions = await svc.buildQuestionSet(exam);
  const deadline = new Date(Math.min(now.getTime() + exam.durationMinutes * 60000, exam.endTime.getTime()));
  let attempt;
  try {
    attempt = await Attempt.create({
      exam: exam._id, student: req.user._id, attemptNumber: used + 1, questions, startedAt: now, deadline,
    });
  } catch (e) {
    if (e.code === 11000) throw new AppError('An attempt is already being started', 409); // concurrent start
    throw e;
  }
  bus.emit('attempt.started', { attempt, exam });
  created(res, await inProgressView(attempt), 'Attempt started');
});

exports.mine = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { student: req.user._id };
  const [attempts, total] = await Promise.all([
    Attempt.find(filter).select('exam attemptNumber status startedAt submittedAt score totalMarks').populate('exam', 'title resultsReleased')
      .sort({ startedAt: -1 }).skip(skip).limit(limit).lean(),
    Attempt.countDocuments(filter),
  ]);
  const items = attempts.map(({ score, totalMarks, ...a }) =>
    a.exam && a.exam.resultsReleased && a.status !== 'in_progress' ? { ...a, score, totalMarks } : a);
  ok(res, items, undefined, 200, pageMeta(total, page, limit));
});

exports.get = asyncHandler(async (req, res) => {
  // Staff: full detail for exams they own
  if (req.user.role !== ROLES.STUDENT) {
    const attempt = await Attempt.findById(req.params.id).populate('student', 'name email rollNumber');
    if (!attempt) throw new AppError('Attempt not found', 404);
    const exam = await Exam.findById(attempt.exam).select('createdBy');
    if (req.user.role !== ROLES.ADMIN && (!exam || String(exam.createdBy) !== String(req.user._id))) {
      throw new AppError('You do not have access to this attempt', 403);
    }
    return ok(res, attempt);
  }
  let attempt = await loadOwnAttempt(req.params.id, req.user);
  if (attempt.status === 'in_progress') {
    if (svc.isExpired(attempt)) attempt = await svc.finalize(attempt, { auto: true });
    else return ok(res, await inProgressView(attempt));
  }
  const exam = await Exam.findById(attempt.exam).select('resultsReleased showCorrectAnswers');
  ok(res, studentResultView(attempt, exam));
});

exports.saveAnswers = asyncHandler(async (req, res) => {
  const attempt = await loadOwnAttempt(req.params.id, req.user);
  if (attempt.status !== 'in_progress') throw new AppError('Attempt has already been submitted', 409);
  if (Date.now() > attempt.deadline.getTime()) {
    if (svc.isExpired(attempt)) await svc.finalize(attempt, { auto: true }).catch(() => {});
    throw new AppError('Time is up. Answers can no longer be saved', 403);
  }
  const merged = svc.mergeAnswers(attempt, req.body.answers);
  const updated = await Attempt.findOneAndUpdate(
    { _id: attempt._id, status: 'in_progress', deadline: { $gte: new Date() } },
    { $set: { answers: merged } },
    { returnDocument: 'after' }
  );
  if (!updated) throw new AppError('Time is up. Answers can no longer be saved', 403);
  bus.emit('attempt.answered', {
    attemptId: updated._id, examId: updated.exam, studentId: updated.student,
    answeredCount: updated.answers.length, total: updated.questions.length,
  });
  ok(res, { answeredCount: updated.answers.length, remainingSeconds: remainingSeconds(updated) }, 'Answers saved');
});

exports.submit = asyncHandler(async (req, res) => {
  const attempt = await loadOwnAttempt(req.params.id, req.user);
  if (attempt.status !== 'in_progress') throw new AppError('Attempt has already been submitted', 409);

  const late = Date.now() > attempt.deadline.getTime() + require('../config/env').submitGraceSeconds * 1000;
  // Answers sent with a late submission are ignored; only what was saved in time is evaluated.
  const answers = !late && req.body.answers ? svc.mergeAnswers(attempt, req.body.answers) : undefined;
  const done = await svc.finalize(attempt, { auto: late, answers });
  ok(res, {
    attemptId: done._id,
    status: done.status,
    submittedAt: done.submittedAt,
    message: late ? 'Time limit exceeded - submitted automatically with previously saved answers' : 'Submitted successfully',
  }, 'Exam submitted');
});
