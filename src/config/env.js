require('dotenv').config();

const required = ['MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

function load() {
  if (process.env.NODE_ENV !== 'test') {
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT, 10) || 5000,
    mongoUri: process.env.MONGO_URI,
    accessSecret: process.env.JWT_ACCESS_SECRET || 'test_access_secret_test_access_secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_test_refresh_secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresDays: parseInt(process.env.JWT_REFRESH_EXPIRES_DAYS, 10) || 7,
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 10,
    corsOrigin: process.env.CORS_ORIGIN || '*',
    submitGraceSeconds: parseInt(process.env.SUBMIT_GRACE_SECONDS, 10) || 10,
  };
}

module.exports = load();
