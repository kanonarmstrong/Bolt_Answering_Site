/* Experiment-platform assignment in plain ES5 (no BigInt), for static pages.
 * Contract (platform packages/shared/src/assignment.ts, assignment-v1):
 *   bucket(s) = FNV-1a 64-bit over the UTF-8 bytes of s, unsigned, mod 10000
 *   traffic   = bucket(subject:key:seed:traffic)   < trafficPercentage * 100
 *   variation = bucket(subject:key:seed:variation) walked over cumulative allocations
 */
function boltUtf8(s) { return unescape(encodeURIComponent(s)); }
function boltBucket(s) {
  var bytes = boltUtf8(s);
  // 64-bit state as four 16-bit limbs, little-endian: offset basis 0xcbf29ce484222325
  var h = [0x2325, 0x8422, 0x9ce4, 0xcbf2];
  for (var i = 0; i < bytes.length; i++) {
    h[0] ^= bytes.charCodeAt(i);
    // multiply by FNV prime 0x100000001b3 = 2^40 + 0x1b3, mod 2^64
    var a0 = h[0] * 0x1b3, a1 = h[1] * 0x1b3, a2 = h[2] * 0x1b3, a3 = h[3] * 0x1b3;
    // + (h << 40): 40 bits = 2 limbs + 8 bits
    a2 += (h[0] << 8) & 0xffff;
    a3 += ((h[1] << 8) & 0xffff) + (h[0] >>> 8);
    var c = 0;
    a0 += c; h[0] = a0 & 0xffff; c = Math.floor(a0 / 0x10000);
    a1 += c; h[1] = a1 & 0xffff; c = Math.floor(a1 / 0x10000);
    a2 += c; h[2] = a2 & 0xffff; c = Math.floor(a2 / 0x10000);
    a3 += c; h[3] = a3 & 0xffff;
  }
  // (hi * 2^32 + lo) mod 10000, with 2^32 mod 10000 = 7296
  var hi = h[3] * 0x10000 + h[2], lo = h[1] * 0x10000 + h[0];
  return ((hi % 10000) * 7296 + (lo % 10000)) % 10000;
}
/* exp = { key, seed, trafficPercentage, variants: [{key, allocation}] } in the
 * platform's order (control first). Returns the variant key, or null = not in
 * the test (render control, send no exposure). */
function boltAssign(subjectId, exp) {
  var base = subjectId + ':' + exp.key + ':' + exp.seed + ':';
  if (boltBucket(base + 'traffic') >= exp.trafficPercentage * 100) return null;
  var b = boltBucket(base + 'variation'), cum = 0;
  for (var i = 0; i < exp.variants.length; i++) {
    cum += exp.variants[i].allocation;
    if (b < cum) return exp.variants[i].key;
  }
  return null;
}
if (typeof module !== 'undefined') module.exports = { boltBucket: boltBucket, boltAssign: boltAssign };
