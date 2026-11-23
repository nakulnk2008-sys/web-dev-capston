const crypto = require('crypto');
/** Fisher-Yates using crypto RNG; returns a new array. */
module.exports = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
