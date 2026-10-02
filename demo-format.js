/* ============================================================
   Demo call flow — canonical phone/email/business formatting
   + validation. Single source of truth shared by the form
   (demo.js) and the regression tests (demo-format.test.mjs).
   Pure functions only: no DOM, no globals beyond the export.
   Browser -> window.DemoFormat ; Node -> module.exports.
   ============================================================ */
(function (factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DemoFormat = api;
})(function () {
  'use strict';

  // All non-digits stripped.
  function digits(s) { return (s == null ? '' : String(s)).replace(/\D/g, ''); }

  // The 10 US national digits (a leading US country code "1" is dropped), or the
  // raw digits when they don't look like a US number. Used for validation + display.
  function nationalDigits(s) {
    var d = digits(s);
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    return d;
  }

  // A complete US phone: exactly 10 national digits (optionally with a leading
  // "1" country code, i.e. 11 digits starting with 1). Anything shorter, longer,
  // or non-US (e.g. 11 digits not starting with 1) is invalid.
  function validPhone(s) {
    var d = digits(s);
    return d.length === 10 || (d.length === 11 && d.charAt(0) === '1');
  }

  // E.164 for the provider/API: "+1XXXXXXXXXX".
  function e164(s) {
    var d = digits(s);
    if (d.length === 11 && d.charAt(0) === '1') return '+' + d;
    if (d.length === 10) return '+1' + d;
    return '+' + d;
  }

  // Live/progressive display format -> "(123) 456-7890". Handles pasted raw,
  // dashed, spaced, parenthesized, and +1 numbers. Never renders past 10 digits.
  function fmtPhone(s) {
    var d = nationalDigits(s).slice(0, 10);
    var a = d.slice(0, 3), b = d.slice(3, 6), c = d.slice(6, 10);
    if (d.length > 6) return '(' + a + ') ' + b + '-' + c;
    if (d.length > 3) return '(' + a + ') ' + b;
    if (d.length >= 1) return '(' + a;
    return '';
  }

  // Pragmatic email check: non-empty local part (permissive), '@', then a real
  // domain — dot-separated alphanumeric/hyphen labels ending in an alphabetic TLD.
  // Rejects junk domains like "@#$gmail.com" without being RFC-exhaustive.
  // Trims surrounding whitespace first.
  function validEmail(s) {
    var v = (s == null ? '' : String(s)).trim();
    return /^[^\s@]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/.test(v);
  }

  // Business name must contain at least one alphabetic character (any script).
  // Numbers/punctuation/symbols/whitespace alone are invalid.
  function validBusiness(s) {
    return /\p{L}/u.test(s == null ? '' : String(s));
  }

  // ---- the demo form's rules (AFMBP-2000) ----
  function str(s) { return s == null ? '' : String(s); }

  // Email is optional: blank, or spaces only, means no email. Anything typed
  // must still be a real address.
  function normEmail(s) { return str(s).trim(); }
  function emailOk(s) { var v = normEmail(s); return v === '' || validEmail(v); }

  // Continue unlocks once phone and business name both have something in them.
  // Email never gates it. What they hold is checked on tap (checkForm).
  function formComplete(v) {
    v = v || {};
    return str(v.phone).trim() !== '' && str(v.business).trim() !== '';
  }

  // What a tap on Continue finds wrong, in priority order: missing required ->
  // phone -> business -> email. null = good to send. `fields` are form keys.
  var MSG_INCOMPLETE = 'Please complete the form to continue.';
  function checkForm(v) {
    v = v || {};
    var missing = [];
    if (str(v.phone).trim() === '') missing.push('phone');
    if (str(v.business).trim() === '') missing.push('business');
    if (missing.length) return { fields: missing, msg: MSG_INCOMPLETE };
    if (!validPhone(v.phone)) return { fields: ['phone'], msg: 'Invalid phone number. Please try again.' };
    if (!validBusiness(v.business)) return { fields: ['business'], msg: 'Invalid business name. Please try again.' };
    if (!emailOk(v.email)) return { fields: ['email'], msg: 'Invalid email address. Please try again.' };
    return null;
  }

  // Body for /api/demo/otp/send. No email -> no `email` key at all: the server
  // treats a missing address as "no marketing lead" and never needs one to text
  // the code. Never a made-up address.
  function otpSendBody(v, consentText) {
    v = v || {};
    var body = { phone: v.phone, businessName: v.business, consentText: consentText };
    var email = normEmail(v.email);
    if (email) body.email = email;
    return body;
  }

  return {
    digits: digits,
    nationalDigits: nationalDigits,
    validPhone: validPhone,
    e164: e164,
    fmtPhone: fmtPhone,
    validEmail: validEmail,
    validBusiness: validBusiness,
    normEmail: normEmail,
    emailOk: emailOk,
    formComplete: formComplete,
    checkForm: checkForm,
    otpSendBody: otpSendBody,
    MSG_INCOMPLETE: MSG_INCOMPLETE
  };
});
