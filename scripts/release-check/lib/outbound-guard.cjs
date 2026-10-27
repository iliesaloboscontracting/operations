// Release check: preloaded into the TEST server only (NODE_OPTIONS=--require). Every TCP connection the app tries to
// open to anything other than this machine's loopback address is BLOCKED and written to RELEASE_CHECK_NET_LOG, so a
// test copy of live data can never call Xero, Microsoft, Anthropic, a push service or anything else - and the check
// can prove it made no such attempt. Unix sockets / named pipes are left alone.
"use strict";
const net = require("net");
const fs = require("fs");

const LOG = process.env.RELEASE_CHECK_NET_LOG;
const LOOPBACK = (h) => !h || h === "localhost" || h === "::1" || h === "0:0:0:0:0:0:0:1" || /^127\./.test(h) || /^::ffff:127\./i.test(h);

function record(host, port) {
  if (!LOG) return;
  try { fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), host: String(host), port: Number(port) || null, pid: process.pid }) + "\n"); } catch { /* best effort */ }
}

const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  let opts = args[0];
  if (Array.isArray(opts)) opts = opts[0]; // Node's internal normalised form
  let host, port;
  if (opts && typeof opts === "object") {
    if (opts.path) return original.apply(this, args);
    host = opts.host; port = opts.port;
  } else {
    port = args[0];
    host = typeof args[1] === "string" ? args[1] : undefined;
  }
  if (!LOOPBACK(host)) {
    record(host, port);
    const err = Object.assign(new Error(`release-check: outbound connection to ${host}:${port} blocked on the test copy`), { code: "ECONNREFUSED" });
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return original.apply(this, args);
};
if (LOG) try { fs.appendFileSync(LOG, ""); } catch { /* ignore */ }
