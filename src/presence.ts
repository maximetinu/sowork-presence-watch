export type Availability = 'available' | 'busy' | 'away' | 'offline';

export interface Member {
  id: string;
  name: string;
  availability: Availability;
  textStatus: string | undefined;
}

export interface PresenceChange {
  member: Member;
  from: Availability;
  to: Availability;
}

const ORDER: Record<Availability, number> = { available: 0, busy: 1, away: 2, offline: 3 };

/** Sorts by availability (available first), then by name. */
export function sortMembers(members: readonly Member[]): Member[] {
  return [...members].sort(
    (a, b) => ORDER[a.availability] - ORDER[b.availability] || a.name.localeCompare(b.name),
  );
}

/**
 * Availability changes of watched members between two checks. A member who is
 * not in the previous check has no "from" value, so it produces no change.
 */
export function presenceChanges(
  previous: readonly Member[],
  current: readonly Member[],
  watched: ReadonlySet<string>,
): PresenceChange[] {
  const before = new Map(previous.map((m) => [m.id, m.availability]));
  const changes: PresenceChange[] = [];
  for (const member of current) {
    const from = before.get(member.id);
    if (watched.has(member.id) && from !== undefined && from !== member.availability) {
      changes.push({ member, from, to: member.availability });
    }
  }
  return changes;
}

/**
 * Finds the members a `--watch` value means: an exact user id, else every
 * member whose name contains the value (case-insensitive).
 */
export function matchMembers(members: readonly Member[], query: string): Member[] {
  const byId = members.filter((m) => m.id === query);
  if (byId.length > 0) {
    return byId;
  }
  const needle = query.toLowerCase();
  return members.filter((m) => m.name.toLowerCase().includes(needle));
}

export function changeMessage(change: PresenceChange): string {
  return `${change.member.name} is now ${change.to} (was ${change.from})`;
}
