'use strict';
// Kismet patch check for GHSA-fc5q-39xc-vjpf (CVE-2026-112366). Run: node --test vendor/picomatch/test
// Usage against another copy: PICOMATCH_DIR=<dir> node --test vendor/picomatch/test
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const pm = require(process.env.PICOMATCH_DIR || path.join(__dirname, '..'));

const timed = (fn) => {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
};

test('advisory PoC shapes finish fast (would take seconds unpatched)', () => {
  const cases = [
    ['+(*)', 'a'.repeat(28) + '/'],
    ['*(*)', 'a'.repeat(28) + '/'],
    ['+(*a)', 'a'.repeat(28) + 'b'],
    ['*(*a)', 'a'.repeat(28) + 'b'],
    ['+(*a|b)', 'a'.repeat(28) + 'c'],
    ['+(*{a,b})', 'a'.repeat(28) + 'c'],
    ['+(*[0-9])', '1'.repeat(28) + 'x']
  ];
  for (const [pattern, subject] of cases) {
    const ms = timed(() => pm.isMatch(subject, pattern));
    assert.ok(ms < 200, `${pattern} took ${ms.toFixed(0)} ms`);
  }
});

test('single-branch wildcard extglobs keep their meaning', () => {
  assert.strictEqual(pm.isMatch('aaa', '+(*a)'), true);
  assert.strictEqual(pm.isMatch('aab', '+(*a)'), false);
  assert.strictEqual(pm.isMatch('x.js', '+(*.js)'), true);
  assert.strictEqual(pm.isMatch('x.js.js', '+(*.js)'), true);
  assert.strictEqual(pm.isMatch('x.ts', '+(*.js)'), false);
  assert.strictEqual(pm.isMatch('a/b', '+(*)'), false);
  assert.strictEqual(pm.isMatch('', '*(*a)'), false);
  assert.strictEqual(pm.isMatch('src/a.js', 'src/+(*.js)'), true);
  assert.strictEqual(pm.isMatch('ab', '+(*(a)|*(b))'), true);
  assert.strictEqual(pm.isMatch('abab', '*(a|b)'), true);
});
