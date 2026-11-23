const User = require('../models/User');
const Group = require('../models/Group');
const RefreshToken = require('../models/RefreshToken');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const { parsePagination, pageMeta } = require('../utils/pagination');

const assertGroupsExist = async (ids = []) => {
  if (!ids.length) return;
  const n = await Group.countDocuments({ _id: { $in: ids } });
  if (n !== new Set(ids.map(String)).size) throw new AppError('One or more groups do not exist', 400);
};

exports.getMe = asyncHandler(async (req, res) => {
  ok(res, await User.findById(req.user._id).populate('groups', 'name'));
});

// Users may update only name / rollNumber / password. Role, groups and status are admin-only.
exports.updateMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  const { name, rollNumber, currentPassword, newPassword } = req.body;
  if (name !== undefined) user.name = name;
  if (rollNumber !== undefined) user.rollNumber = rollNumber;
  if (newPassword) {
    if (!currentPassword || !(await user.comparePassword(currentPassword))) {
      throw new AppError('Current password is incorrect', 401);
    }
    user.password = newPassword;
    await RefreshToken.deleteMany({ user: user._id }); // force re-login on other devices
  }
  await user.save();
  ok(res, user, 'Profile updated');
});

exports.listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.group) filter.groups = req.query.group;
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { rollNumber: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).populate('groups', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  ok(res, items, undefined, 200, pageMeta(total, page, limit));
});

exports.createUser = asyncHandler(async (req, res) => {
  const { groups = [] } = req.body;
  await assertGroupsExist(groups);
  if (await User.findOne({ email: req.body.email })) throw new AppError('Email is already registered', 409);
  const user = await User.create(req.body);
  created(res, user, 'User created');
});

exports.getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate('groups', 'name');
  if (!user) throw new AppError('User not found', 404);
  ok(res, user);
});

exports.updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);
  if (req.body.groups) await assertGroupsExist(req.body.groups);
  if (String(user._id) === String(req.user._id) && (req.body.role || req.body.isActive === false)) {
    throw new AppError('You cannot change your own role or deactivate yourself', 409);
  }
  ['name', 'role', 'groups', 'rollNumber', 'isActive'].forEach((k) => {
    if (req.body[k] !== undefined) user[k] = req.body[k];
  });
  await user.save();
  if (user.isActive === false) await RefreshToken.deleteMany({ user: user._id });
  ok(res, user, 'User updated');
});

exports.deleteUser = asyncHandler(async (req, res) => {
  if (req.params.id === String(req.user._id)) throw new AppError('You cannot delete yourself', 409);
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) throw new AppError('User not found', 404);
  await RefreshToken.deleteMany({ user: user._id });
  ok(res, undefined, 'User deleted');
});
