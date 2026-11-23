const Group = require('../models/Group');
const User = require('../models/User');
const Exam = require('../models/Exam');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const ROLES = require('../utils/roles');

exports.list = asyncHandler(async (_req, res) => {
  // members count via aggregation on users
  const groups = await Group.aggregate([
    { $lookup: { from: 'users', localField: '_id', foreignField: 'groups', as: 'members' } },
    { $project: { name: 1, description: 1, createdAt: 1, memberCount: { $size: '$members' } } },
    { $sort: { name: 1 } },
  ]);
  ok(res, groups);
});

exports.create = asyncHandler(async (req, res) => {
  created(res, await Group.create(req.body), 'Group created');
});

exports.get = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) throw new AppError('Group not found', 404);
  const members = await User.find({ groups: group._id }).select('name email rollNumber role');
  ok(res, { ...group.toObject(), members });
});

exports.update = asyncHandler(async (req, res) => {
  const group = await Group.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after', runValidators: true });
  if (!group) throw new AppError('Group not found', 404);
  ok(res, group, 'Group updated');
});

exports.remove = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) throw new AppError('Group not found', 404);
  if (await Exam.exists({ assignedGroups: group._id })) {
    throw new AppError('Group is assigned to one or more exams and cannot be deleted', 409);
  }
  await User.updateMany({ groups: group._id }, { $pull: { groups: group._id } });
  await group.deleteOne();
  ok(res, undefined, 'Group deleted');
});

exports.addMembers = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) throw new AppError('Group not found', 404);
  const r = await User.updateMany(
    { _id: { $in: req.body.userIds }, role: ROLES.STUDENT },
    { $addToSet: { groups: group._id } }
  );
  ok(res, { matched: r.matchedCount, modified: r.modifiedCount }, 'Members added');
});

exports.removeMember = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.params.userId }, { $pull: { groups: req.params.id } });
  ok(res, undefined, 'Member removed');
});
