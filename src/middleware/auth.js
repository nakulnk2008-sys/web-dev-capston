const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyAccessToken } = require('../utils/tokens');
const User = require('../models/User');

/** Protects a route: validates the Bearer access token and loads the (active) user. */
exports.authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new AppError('Authentication required', 401);

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (e) {
    throw new AppError(e.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token', 401);
  }
  const user = await User.findById(payload.sub).select('name email role groups isActive');
  if (!user || !user.isActive) throw new AppError('User no longer exists or is deactivated', 401);
  req.user = user;
  next();
});

/** Role-based access control: authorize('faculty', 'admin') */
exports.authorize = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new AppError('Authentication required', 401));
  if (!roles.includes(req.user.role)) {
    return next(new AppError(`Role '${req.user.role}' is not permitted to perform this action`, 403));
  }
  next();
};
