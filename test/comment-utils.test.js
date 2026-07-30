'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeComment } = require('../comment-utils');

test('keeps every line break in a comment', () => {
  const comment = '\nfirst line\n\nsecond line\n';

  assert.equal(sanitizeComment(comment, 1000), comment);
});

test('normalizes platform line endings without removing lines', () => {
  assert.equal(sanitizeComment('first\r\n\r\nsecond\rthird', 1000), 'first\n\nsecond\nthird');
});

test('removes other control characters while enforcing the length limit', () => {
  assert.equal(sanitizeComment('ab\tcd\0ef', 7), 'ab cd e');
});
