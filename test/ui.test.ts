import assert from 'node:assert/strict';
import { test } from 'node:test';
import { charWidth, describeError, editLine, fit, maskSecret } from '../src/ui.ts';

test('charWidth counts emoji as 2 columns and variation selectors as 0', () => {
  assert.equal(charWidth('a'), 1);
  assert.equal(charWidth('😎'), 2);
  assert.equal(charWidth('️'), 0);
  assert.equal(charWidth('é'), 1);
});

test('fit pads short text and truncates long text to the exact column width', () => {
  assert.equal(fit('Bea', 6), 'Bea   ');
  assert.equal(fit('Bob 😎', 10), 'Bob 😎    ');
  assert.equal(fit('A very long display name', 10), 'A very lo…');
  assert.equal(fit('ab😎cd', 4), 'ab… ');
});

test('describeError explains a rejected key and rate limiting', () => {
  assert.match(describeError({ response: { status: 401 } }), /API key was rejected/);
  assert.match(describeError({ response: { status: 429 } }), /--interval/);
  assert.equal(describeError(new Error('boom')), 'boom');
});

test('maskSecret hides all but the last 4 characters of a long key', () => {
  assert.equal(maskSecret('sw_abcdefgh1234'), '•••••••••••1234');
  assert.equal(maskSecret('short'), '•••••');
});

test('editLine types, deletes, clears, submits and cancels', () => {
  assert.deepEqual(editLine('ab', 'c', { name: 'c', sequence: 'c' }), { kind: 'edit', value: 'abc' });
  assert.deepEqual(editLine('ab😎', undefined, { name: 'backspace' }), { kind: 'edit', value: 'ab' });
  assert.deepEqual(editLine('abc', undefined, { name: 'u', ctrl: true }), { kind: 'edit', value: '' });
  assert.deepEqual(editLine('abc', '\r', { name: 'return' }), { kind: 'submit', value: 'abc' });
  assert.deepEqual(editLine('abc', undefined, { name: 'escape' }), { kind: 'cancel' });
});
