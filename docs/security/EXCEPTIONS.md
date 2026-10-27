# Security exceptions (accepted risks)

Each entry: what, why it's accepted, who accepted it, when it expires. An exception ends at its expiry date, at the
event named, or as soon as the reason stops being true - whichever comes first.

## EX-001 - npm audit: postcss / next, uuid / exceljs (accepted 27 Oct 2026)

- **What:** `npm audit` reports 2 high and 4 moderate advisories on main and every release candidate:
  - postcss <= 8.5.22, nested in next 15.5 (high). The only fix is next@16, a major upgrade.
  - source-map-js 1.0.0 - 1.2.1 (high).
  - postcss-selector-parser < 6.1.5 (moderate).
  - next (moderate; this is the postcss item).
  - uuid < 11.1.1 via exceljs 4.4.0 (moderate).
- **Why accepted:** the security review (lobos-security-assurance, 27 Oct 2026) found none of them reachable at run
  time:
  - postcss, source-map-js and postcss-selector-parser only run at `next build`, on the app's own CSS;
    `next start` never processes CSS or source maps from users.
  - exceljs only calls uuid v4. The advisory is in v3 / v5 / v6 with a caller-supplied buffer.
  - Don't take npm's suggested "fix" for exceljs: it's a downgrade to 3.4.0.
- **Accepted by:** Ilies (owner), 27 Oct 2026: "approve ... exception" - "accepting the package weakness for 90 days
  so releases can go out meanwhile".
- **Expires:** 25 Jan 2027, or at the Next.js 16 upgrade, or as soon as the app processes user-supplied CSS / source
  maps - whichever comes first.
- **Meanwhile:**
  - apply `npm audit fix` (no --force) for source-map-js and postcss-selector-parser on a branch, as a small change;
  - plan the Next.js 16 upgrade through the permission gate;
  - the release check's audit step treats exactly these advisories as accepted until the expiry date, and fails on
    anything new.
