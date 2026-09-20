/* Regression tests for the demo-call canonical format/validation layer.
   Run: node --test demo-format.test.mjs
   Covers the phone-formatting, phone/email/business validation, and
   normalization behaviour required by the Talk-to-Your-Assistant form. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const DF = require('./demo-format.js');

test('phone: typing 10 digits produces (123) 456-7890', () => {
  assert.equal(DF.fmtPhone('1234567890'), '(123) 456-7890');
});

test('phone: progressive formatting while typing', () => {
  assert.equal(DF.fmtPhone('1'), '(1');
  assert.equal(DF.fmtPhone('12'), '(12');
  assert.equal(DF.fmtPhone('123'), '(123');
  assert.equal(DF.fmtPhone('1234'), '(123) 4');
  assert.equal(DF.fmtPhone('1234567'), '(123) 456-7');
  assert.equal(DF.fmtPhone('1234567890'), '(123) 456-7890');
});

test('phone: paste unformatted / dashed / parenthesized / spaced all normalize', () => {
  assert.equal(DF.fmtPhone('4155551234'), '(415) 555-1234');
  assert.equal(DF.fmtPhone('415-555-1234'), '(415) 555-1234');
  assert.equal(DF.fmtPhone('(415) 555-1234'), '(415) 555-1234');
  assert.equal(DF.fmtPhone('415 555 1234'), '(415) 555-1234');
});

test('phone: +1 US number normalizes to national display', () => {
  assert.equal(DF.fmtPhone('+1 415 555 1234'), '(415) 555-1234');
});

test('phone: never renders past 10 national digits', () => {
  assert.equal(DF.fmtPhone('41555512349999'), '(415) 555-1234');
});

test('phone validation: valid 10-digit and formatted pass', () => {
  assert.equal(DF.validPhone('4155551234'), true);
  assert.equal(DF.validPhone('(415) 555-1234'), true);
});

test('phone validation: +1 (11 digits leading 1) passes', () => {
  assert.equal(DF.validPhone('+14155551234'), true);
  assert.equal(DF.validPhone('14155551234'), true);
});

test('phone validation: incomplete fails', () => {
  assert.equal(DF.validPhone('415555'), false);
  assert.equal(DF.validPhone('123456789'), false);
});

test('phone validation: too-long national fails', () => {
  assert.equal(DF.validPhone('415555123499'), false);        // 12 digits
  assert.equal(DF.validPhone('24155512340'), false);          // 11 not starting with 1
});

test('phone normalization: e164 for provider', () => {
  assert.equal(DF.e164('(415) 555-1234'), '+14155551234');
  assert.equal(DF.e164('+1 415 555 1234'), '+14155551234');
  assert.equal(DF.nationalDigits('+1 415 555 1234'), '4155551234');
});

test('business: alphabetic and alphanumeric with letters pass', () => {
  assert.equal(DF.validBusiness('123 Plumbing'), true);
  assert.equal(DF.validBusiness('ABC123'), true);
  assert.equal(DF.validBusiness("O'Brien Plumbing"), true);
});

test('business: no-letter values fail', () => {
  assert.equal(DF.validBusiness('12345'), false);
  assert.equal(DF.validBusiness('---'), false);
  assert.equal(DF.validBusiness('   '), false);
  assert.equal(DF.validBusiness(''), false);
});

test('email: valid passes', () => {
  assert.equal(DF.validEmail('john@gmail.com'), true);
  assert.equal(DF.validEmail('a.b+c@sub.domain.co'), true);
});

test('email: malformed / blank fails', () => {
  assert.equal(DF.validEmail('john@#$gmail.com'), false);
  assert.equal(DF.validEmail('john@gmail'), false);
  assert.equal(DF.validEmail('john gmail.com'), false);
  assert.equal(DF.validEmail(''), false);
  assert.equal(DF.validEmail('   '), false);
});

test('email: surrounding whitespace is trimmed before validating', () => {
  assert.equal(DF.validEmail('  john@gmail.com  '), true);
});
