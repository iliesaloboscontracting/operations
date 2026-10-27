import { test } from "node:test";
import assert from "node:assert/strict";
import { isPushHost } from "./pushHost";

test("SEC-013: only the browser push services", () => {
  for (const ok of [
    "https://fcm.googleapis.com/fcm/send/abc", "https://web.push.apple.com/QOabc", "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://wns2-sy3p.notify.windows.com/w/?token=abc", "https://db5p.notify.windows.com/w/?token=x",
  ]) assert.equal(isPushHost(ok), true, ok);
  for (const bad of [
    "https://evil.example/x", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.example/x", "https://push.apple.com/x",
    "https://evilpush.apple.com/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://169.254.169.254/latest", "not a url",
  ]) assert.equal(isPushHost(bad), false, bad);
});
