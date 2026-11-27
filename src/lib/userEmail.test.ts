import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEmailChange, emailChangeable, mayChangeEmail } from "./userEmail";
import { OWNER_EMAIL } from "./owner";
import { BUILDING_AGENT_EMAIL } from "./session";

const yard = { id: "yard", email: "iliesa+yard@loboscontracting.com.au" };
const others = [
  { id: "owner", email: OWNER_EMAIL },
  { id: "agent", email: BUILDING_AGENT_EMAIL },
  { id: "acc", email: "Accounts@LobosContracting.com.au" }, // an older row in mixed case still counts
];
const change = (raw: unknown, actor: string = OWNER_EMAIL, target = yard) => checkEmailChange(actor, target, raw, others);
const refused = (raw: unknown, status: number, actor?: string, target?: { id: string; email: string }) => {
  const r = change(raw, actor, target);
  assert.equal(r.ok, false, `expected a refusal for ${String(raw)}`);
  if (!r.ok) assert.equal(r.status, status, `${String(raw)}: ${r.error}`);
  return r;
};

test("the owner changes the yard login to yard@ - trimmed and lower-cased", () => {
  assert.deepEqual(change("  Yard@LobosContracting.com.au "), { ok: true, email: "yard@loboscontracting.com.au" });
});

test("only the owner may change an email - any other Admin gets 403", () => {
  refused("yard@loboscontracting.com.au", 403, "nick@loboscontracting.com.au");
  refused("yard@loboscontracting.com.au", 403, "");
  refused("yard@loboscontracting.com.au", 403, BUILDING_AGENT_EMAIL);
});

test("not a plausible email", () => {
  for (const raw of ["", "   ", "yard", "yard@", "@loboscontracting.com.au", "ya rd@loboscontracting.com.au", undefined, 42, null]) refused(raw, 400);
});

test("plain characters only (Estimating's rule)", () => {
  refused("yärd@loboscontracting.com.au", 400);
  refused("o'brien@loboscontracting.com.au", 400);
  refused(`${"a".repeat(110)}@loboscontracting.com.au`, 400);
});

test("must end @loboscontracting.com.au - Cloudflare Access lets nothing else in", () => {
  const r = refused("yard@gmail.com", 400);
  if (!r.ok) assert.match(r.error, /Cloudflare Access/);
  refused("yard@loboscontracting.com.au.evil.com", 400);
  refused("yard@sub.loboscontracting.com.au", 400);
  refused("yard@lobos-contracting.com.au", 400);
});

test("unique among all logins, ignoring case", () => {
  refused("accounts@loboscontracting.com.au", 409);
  refused("ACCOUNTS@loboscontracting.com.au", 409);
});

test("never to the owner's or the Building Agent's email", () => {
  refused(OWNER_EMAIL, 400);
  refused(OWNER_EMAIL.toUpperCase(), 400);
  refused(BUILDING_AGENT_EMAIL, 400);
});

test("never on the owner's own login or the Building Agent's", () => {
  refused("new@loboscontracting.com.au", 400, OWNER_EMAIL, { id: "owner", email: OWNER_EMAIL });
  refused("new@loboscontracting.com.au", 400, OWNER_EMAIL, { id: "agent", email: BUILDING_AGENT_EMAIL });
  refused("new@loboscontracting.com.au", 400, OWNER_EMAIL, { id: "agent", email: BUILDING_AGENT_EMAIL.toUpperCase() });
});

test("the same email again is refused", () => {
  refused(yard.email, 400);
  refused(yard.email.toUpperCase(), 400);
});

test("the page shows the button to the owner only, never on the owner's or the agent's login", () => {
  assert.equal(mayChangeEmail(OWNER_EMAIL, yard), true);
  assert.equal(mayChangeEmail("nick@loboscontracting.com.au", yard), false);
  assert.equal(mayChangeEmail(null, yard), false);
  assert.equal(mayChangeEmail(OWNER_EMAIL, { email: OWNER_EMAIL }), false);
  assert.equal(mayChangeEmail(OWNER_EMAIL, { email: BUILDING_AGENT_EMAIL }), false);
  assert.equal(emailChangeable(yard), true);
});
