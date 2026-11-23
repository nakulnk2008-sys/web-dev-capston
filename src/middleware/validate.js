const { validationResult } = require('express-validator');
const AppError = require('../utils/AppError');

/** Terminates the request with 400 + field errors when express-validator rules fail. */
module.exports = (req, _res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const details = result.array().map((e) => ({ field: e.path, message: e.msg }));
  next(new AppError('Validation failed', 400, details));
};
