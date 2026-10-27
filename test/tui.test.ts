import assert from 'node:assert/strict';
import { test } from 'node:test';
import { charWidth, describeError, fit } from '../src/tui.ts';

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
