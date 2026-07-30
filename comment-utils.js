'use strict';

function sanitizeComment(value, maxLength) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .slice(0, maxLength);
}

module.exports = { sanitizeComment };
