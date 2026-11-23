const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');

exports.api = () => request(app);

exports.makeUser = async (role, n = Math.random().toString(36).slice(2, 8), extra = {}) =>
  User.create({ name: `${role} ${n}`, email: `${role}.${n}@t.test`, password: 'Password@123', role, ...extra });

exports.login = async (user) => {
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'Password@123' });
  return { token: res.body.data.accessToken, refreshToken: res.body.data.refreshToken };
};

exports.auth = (token) => ({ Authorization: `Bearer ${token}` });

const mcq = (text, correct = 0, extra = {}) => ({
  text, subject: 'Backend', topic: 'Express', difficulty: 'easy', marks: 2, ...extra,
  options: ['A', 'B', 'C', 'D'].map((t, i) => ({ text: t, isCorrect: i === correct })),
});
exports.mcq = mcq;

const min = (n) => new Date(Date.now() + n * 60000).toISOString();
exports.min = min;
