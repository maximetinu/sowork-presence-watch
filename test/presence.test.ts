import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchMembers, presenceChanges, sortMembers, type Availability, type Member } from '../src/presence.ts';

const member = (id: string, name: string, availability: Availability): Member => ({
  id,
  name,
  availability,
  textStatus: undefined,
});

test('sortMembers puts available first, then busy, away, offline, then by name', () => {
  const sorted = sortMembers([
    member('1', 'Zoe', 'offline'),
    member('2', 'Bob', 'away'),
    member('3', 'Ann', 'available'),
    member('4', 'Cid', 'busy'),
    member('5', 'Abe', 'available'),
  ]);
  assert.deepEqual(
    sorted.map((m) => m.name),
    ['Abe', 'Ann', 'Cid', 'Bob', 'Zoe'],
  );
});

test('presenceChanges reports only watched members whose availability changed', () => {
  const before = [member('a', 'Alex', 'away'), member('b', 'Bea', 'away'), member('c', 'Cy', 'busy')];
  const after = [member('a', 'Alex', 'available'), member('b', 'Bea', 'busy'), member('c', 'Cy', 'busy')];
  const changes = presenceChanges(before, after, new Set(['a', 'c']));
  assert.deepEqual(
    changes.map((c) => [c.member.id, c.from, c.to]),
    [['a', 'away', 'available']],
  );
});

test('presenceChanges ignores a text status change with the same availability', () => {
  const before = [member('a', 'Alex', 'away')];
  const after = [{ ...member('a', 'Alex', 'away'), textStatus: 'lunch' }];
  assert.deepEqual(presenceChanges(before, after, new Set(['a'])), []);
});

test('presenceChanges reports nothing on the first check', () => {
  assert.deepEqual(presenceChanges([], [member('a', 'Alex', 'available')], new Set(['a'])), []);
});

test('matchMembers prefers an exact id, else a case-insensitive name part', () => {
  const members = [member('alex1', 'Alex [team]', 'away'), member('x', 'Kim', 'away'), member('y', 'Kim ⚔️', 'away')];
  assert.deepEqual(
    matchMembers(members, 'alex1').map((m) => m.id),
    ['alex1'],
  );
  assert.deepEqual(
    matchMembers(members, 'ALEX').map((m) => m.id),
    ['alex1'],
  );
  assert.deepEqual(
    matchMembers(members, 'kim').map((m) => m.id),
    ['x', 'y'],
  );
  assert.deepEqual(matchMembers(members, 'nobody'), []);
});
