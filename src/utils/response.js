/** Consistent JSON envelope: { success, message?, data?, meta? } */
exports.ok = (res, data, message, status = 200, meta) => {
  const body = { success: true };
  if (message) body.message = message;
  if (data !== undefined) body.data = data;
  if (meta) body.meta = meta;
  return res.status(status).json(body);
};
exports.created = (res, data, message = 'Created') => exports.ok(res, data, message, 201);
