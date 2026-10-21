// Site requests: telling Ilies the moment something arrives or changes.
// Stage 1 (21 Oct 2026) records only - the Requests page and the menu badge
// show it. Stage 2 adds phone notifications (Web Push) here, so the routes
// that call these don't change.
import type { SiteRequest } from "@prisma/client";

export async function notifyNewRequest(_r: SiteRequest): Promise<void> {}

export async function notifyRequestUpdate(_r: SiteRequest, _what: string): Promise<void> {}
