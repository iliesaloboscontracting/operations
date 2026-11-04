// A reply to one of the coordinator's view routes (2 Nov 2026): as everyone else gets it, but for the COORDINATOR
// login with every amount in free text taken out (lib/coordinatorHire.ts withoutAmounts) - his screen carries no
// dollar figure. Use in place of NextResponse.json on the GET routes he reaches.
// The YARD login (Ilies, 4 Nov 2026: the yard computer sees no money anywhere) gets the same treatment on the Tools
// routes it shares with him - the tool register has no price field, but notes are free text.
import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import { withoutAmounts } from "./coordinatorHire";

export const STRIPPED_ROLES: readonly string[] = ["COORDINATOR", "YARD"];

export async function viewJson(body: unknown, init?: ResponseInit) {
  const user = await getCurrentUser();
  return NextResponse.json(user && STRIPPED_ROLES.includes(user.role) ? withoutAmounts(body) : body, init);
}
