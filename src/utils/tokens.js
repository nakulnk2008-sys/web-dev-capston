const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

exports.signAccessToken = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role }, env.accessSecret, {
    expiresIn: env.accessExpiresIn,
  });

exports.signRefreshToken = (user) =>
  jwt.sign({ sub: String(user._id), jti: crypto.randomUUID() }, env.refreshSecret, {
    expiresIn: `${env.refreshExpiresDays}d`,
  });

exports.verifyAccessToken = (t) => jwt.verify(t, env.accessSecret);
exports.verifyRefreshToken = (t) => jwt.verify(t, env.refreshSecret);

/** Refresh tokens are stored only as SHA-256 hashes. */
exports.hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
