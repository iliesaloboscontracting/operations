// Phone notifications (Web Push, 21 Oct 2026). The browser on Ilies's phone
// gives us an address (PushDevice); we send a small encrypted message to it
// through the browser maker's push service, and the service worker
// (public/sw.js, or public/site/sw.js on supervisors' links) shows it. Keys live in .env: VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:). No keys -> nothing is sent.
import webpush from "web-push";
import { prisma } from "./prisma";
import { isPushHost } from "./pushHost";

export type PushMessage = {
  title: string;
  body: string;
  url: string; // opened when the notification is tapped
  tag?: string; // a newer message with the same tag replaces the old one
  silent?: boolean; // shows, but no sound or vibration
  sticky?: boolean; // stays until dismissed (urgent)
};

let configured: boolean | null = null;
export function pushPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}
function ready() {
  if (configured === null) {
    const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
    configured = !!(pub && priv);
    if (configured) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:iliesa@loboscontracting.com.au", pub!, priv!);
  }
  return configured;
}

type Device = { id: string; endpoint: string; p256dh: string; auth: string };
type Store = { sent(id: string): Promise<unknown>; gone(id: string): Promise<unknown>; failed(id: string): Promise<unknown> };

// Sends to each device. Never throws - a failed alert must not stop whatever
// triggered it. Returns how many devices it reached.
async function sendToDevices(devices: Device[], msg: PushMessage, urgency: "high" | "normal" | "low", store: Store) {
  // SEC-013: re-checked here too, so an address stored before the check (or written any other way) is never called.
  devices = devices.filter((d) => isPushHost(d.endpoint));
  if (!ready() || !devices.length) return 0;
  let sent = 0;
  await Promise.all(
    devices.map(async (d) => {
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify(msg), {
          TTL: 12 * 3600,
          urgency,
          topic: msg.tag?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
        });
        sent++;
        await store.sent(d.id).catch(() => {});
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410: the phone unsubscribed or the browser data was cleared.
        if (status === 404 || status === 410) await store.gone(d.id).catch(() => {});
        else {
          console.error("push failed", status ?? (e as Error).message);
          await store.failed(d.id).catch(() => {});
        }
      }
    }),
  );
  return sent;
}

// Office people with a login (Admins).
export async function pushToUsers(userIds: string[], msg: PushMessage, urgency: "high" | "normal" | "low" = "normal") {
  if (!userIds.length) return 0;
  const devices = await prisma.pushDevice.findMany({ where: { userId: { in: userIds } } });
  return sendToDevices(devices, msg, urgency, {
    sent: (id) => prisma.pushDevice.update({ where: { id }, data: { lastSentAt: new Date(), failures: 0 } }),
    gone: (id) => prisma.pushDevice.delete({ where: { id } }),
    failed: (id) => prisma.pushDevice.update({ where: { id }, data: { failures: { increment: 1 } } }),
  });
}

// Supervisors' phones, through their site link (24 Oct 2026). Switched-off
// links get nothing.
export async function pushToSiteLinks(linkIds: string[], msg: PushMessage, urgency: "high" | "normal" | "low" = "normal") {
  if (!linkIds.length) return 0;
  const devices = await prisma.siteLinkPushDevice.findMany({ where: { siteLinkId: { in: linkIds }, siteLink: { revokedAt: null } } });
  return sendToDevices(devices, msg, urgency, {
    sent: (id) => prisma.siteLinkPushDevice.update({ where: { id }, data: { lastSentAt: new Date(), failures: 0 } }),
    gone: (id) => prisma.siteLinkPushDevice.delete({ where: { id } }),
    failed: (id) => prisma.siteLinkPushDevice.update({ where: { id }, data: { failures: { increment: 1 } } }),
  });
}

// Who gets request alerts: Admins (Ilies). Alex doesn't decide, so he isn't alerted.
export async function pushToAdmins(msg: PushMessage, urgency: "high" | "normal" | "low" = "normal") {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
  return pushToUsers(admins.map((a) => a.id), msg, urgency);
}
