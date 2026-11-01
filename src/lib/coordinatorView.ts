// A reply to one of the coordinator's view routes (2 Nov 2026): as everyone else gets it, but for the COORDINATOR
// login with every amount in free text taken out (lib/coordinatorHire.ts withoutAmounts) - his screen carries no
// dollar figure. Use in place of NextResponse.json on the GET routes he reaches.
import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import { withoutAmounts } from "./coordinatorHire";

export async function viewJson(body: unknown, init?: ResponseInit) {
  const user = await getCurrentUser();
  return NextResponse.json(user?.role === "COORDINATOR" ? withoutAmounts(body) : body, init);
}
