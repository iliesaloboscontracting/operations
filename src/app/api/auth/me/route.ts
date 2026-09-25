import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

// GET /api/auth/me -> the signed-in user (id, email, name, role)
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(user);
}
