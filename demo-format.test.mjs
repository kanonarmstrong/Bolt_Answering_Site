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

// ---- the demo form's rules: email is optional (AFMBP-2000) ----
const OK = { phone: '(415) 555-1234', business: 'QA Test Co' };

test('form: empty email is valid and does not block Continue', () => {
  assert.equal(DF.emailOk(''), true);
  assert.equal(DF.formComplete({ ...OK, email: '' }), true);
  assert.equal(DF.checkForm({ ...OK, email: '' }), null);
});

test('form: whitespace-only email normalizes to empty and is valid', () => {
  assert.equal(DF.normEmail('   '), '');
  assert.equal(DF.emailOk('   '), true);
  assert.equal(DF.checkForm({ ...OK, email: '   ' }), null);
});

test('form: a missing email key is the same as a blank one', () => {
  assert.equal(DF.formComplete(OK), true);
  assert.equal(DF.checkForm(OK), null);
});

test('form: valid email is accepted', () => {
  assert.equal(DF.emailOk('james@example.com'), true);
  assert.equal(DF.checkForm({ ...OK, email: 'james@example.com' }), null);
});

test('form: malformed non-empty email is rejected with the email message', () => {
  for (const bad of ['james', '@example.com', 'james@', 'james@example', 'ja mes@example.com']) {
    assert.equal(DF.emailOk(bad), false, bad);
    assert.deepEqual(DF.checkForm({ ...OK, email: bad }), { fields: ['email'], msg: 'Invalid email address. Please try again.' }, bad);
  }
});

test('form: a malformed email does not grey out Continue (it is caught on tap)', () => {
  assert.equal(DF.formComplete({ ...OK, email: 'james' }), true);
});

test('form: email is never in the required set', () => {
  const r = DF.checkForm({ phone: '', business: '', email: '' });
  assert.deepEqual(r, { fields: ['phone', 'business'], msg: 'Please complete the form to continue.' });
  assert.ok(!r.fields.includes('email'));
});

test('form: phone and business name still gate Continue', () => {
  assert.equal(DF.formComplete({ phone: '', business: '' }), false);
  assert.equal(DF.formComplete({ phone: '(415) 555-1234', business: '' }), false);
  assert.equal(DF.formComplete({ phone: '', business: 'QA Test Co' }), false);
  assert.equal(DF.formComplete({ phone: '   ', business: 'QA Test Co' }), false);
  assert.equal(DF.formComplete({ phone: '(415) 555-1234', business: '  ' }), false);
  assert.deepEqual(DF.checkForm({ phone: '(415) 555-1234', business: '' }).fields, ['business']);
  assert.deepEqual(DF.checkForm({ phone: '', business: 'QA Test Co', email: 'james@example.com' }).fields, ['phone']);
});

test('form: an incomplete or invalid phone still blocks, before any email check', () => {
  assert.equal(DF.formComplete({ phone: '555', business: 'QA Test Co' }), true);
  assert.deepEqual(DF.checkForm({ phone: '555', business: 'QA Test Co', email: 'james' }), { fields: ['phone'], msg: 'Invalid phone number. Please try again.' });
});

test('form: a business name with no letters still blocks', () => {
  assert.deepEqual(DF.checkForm({ phone: '(415) 555-1234', business: '123', email: '' }), { fields: ['business'], msg: 'Invalid business name. Please try again.' });
});

test('otp/send body: no email -> no email key (never a placeholder address)', () => {
  for (const e of ['', '   ', undefined, null]) {
    const b = DF.otpSendBody({ phone: '+14155551234', business: 'QA Test Co', email: e }, 'CONSENT');
    assert.equal('email' in b, false, String(e));
    assert.deepEqual(b, { phone: '+14155551234', businessName: 'QA Test Co', consentText: 'CONSENT' });
  }
});

test('otp/send body: a given email is sent trimmed', () => {
  const b = DF.otpSendBody({ phone: '+14155551234', business: 'QA Test Co', email: '  james@example.com ' }, 'CONSENT');
  assert.equal(b.email, 'james@example.com');
});
