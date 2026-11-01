// How the login roles rank, in one place (CO-001, Ilies approved 2 Nov 2026). Fails closed: a role the code doesn't
// know (a rollback to a build without it, or any odd value in the role column) ranks below everything, so guard()
// refuses it and money is stripped for it - before this, an unknown role compared as undefined and passed every guard.
// Plain, no server imports; `npm test` (roleRank.test.ts).
export const RANK: Record<string, number> = { TIMESHEETS: 0, ACCOUNTS: 0, DIRECTOR: 0, VIEWER: 1, MANAGER: 2, ADMIN: 3 };
export const UNKNOWN_RANK = -1;

export const rankOf = (role: string | null | undefined): number =>
  role != null && Object.prototype.hasOwnProperty.call(RANK, role) ? RANK[role] : UNKNOWN_RANK;

// At least `min`? `min` is always a known role; anything unknown on the left is refused.
export const rankAtLeast = (role: string | null | undefined, min: string): boolean => rankOf(role) >= RANK[min];
