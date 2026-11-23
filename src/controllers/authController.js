const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const T = require('../utils/tokens');
const env = require('../config/env');
const ROLES = require('../utils/roles');

async function issueTokens(user) {
  const accessToken = T.signAccessToken(user);
  const refreshToken = T.signRefreshToken(user);
  await RefreshToken.create({
    user: user._id,
    tokenHash: T.hashToken(refreshToken),
    expiresAt: new Date(Date.now() + env.refreshExpiresDays * 86400000),
  });
  return { accessToken, refreshToken };
}

// Public self-registration always creates a STUDENT. Faculty/admin accounts are created by an admin.
exports.register = asyncHandler(async (req, res) => {
  const { name, email, password, rollNumber } = req.body;
  if (await User.findOne({ email })) throw new AppError('Email is already registered', 409);
  const user = await User.create({ name, email, password, rollNumber, role: ROLES.STUDENT });
  const tokens = await issueTokens(user);
  created(res, { user, ...tokens }, 'Registration successful');
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  // identical message for unknown email / wrong password to avoid account enumeration
  if (!user || !(await user.comparePassword(password))) throw new AppError('Invalid email or password', 401);
  if (!user.isActive) throw new AppError('Account is deactivated', 403);
  const tokens = await issueTokens(user);
  ok(res, { user, ...tokens }, 'Login successful');
});

/** Refresh-token rotation: each refresh token is single-use; reuse of a spent token revokes the whole family. */
exports.refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  let payload;
  try {
    payload = T.verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Invalid or expired refresh token', 401);
  }
  const stored = await RefreshToken.findOneAndDelete({ tokenHash: T.hashToken(refreshToken) });
  if (!stored) {
    await RefreshToken.deleteMany({ user: payload.sub }); // reuse detected
    throw new AppError('Refresh token has been revoked. Please log in again', 401);
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw new AppError('User no longer exists or is deactivated', 401);
  ok(res, await issueTokens(user), 'Token refreshed');
});

exports.logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  await RefreshToken.deleteOne({ tokenHash: T.hashToken(refreshToken) });
  ok(res, undefined, 'Logged out');
});

exports.logoutAll = asyncHandler(async (req, res) => {
  await RefreshToken.deleteMany({ user: req.user._id });
  ok(res, undefined, 'Logged out from all devices');
});
