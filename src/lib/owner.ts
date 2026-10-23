// The owner account (23 Oct 2026): Iliesa. Other Admins (the directors) have
// full access to everything in the app except this one account - only the
// owner can change its role, password, name or deactivate it. Set in code on
// purpose, so nobody can change who the owner is from inside the app.
// No server imports - the Users page uses this too.
export const OWNER_EMAIL = "iliesa@loboscontracting.com.au";
export const isOwner = (email: string | null | undefined) => (email ?? "").toLowerCase() === OWNER_EMAIL;
