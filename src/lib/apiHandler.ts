import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

// Wraps a route handler so a thrown error becomes a clean JSON response instead
// of an unhandled exception - which in dev is a stack-trace page and in
// production is a bare 500 with nothing useful for the frontend to show. This
// only changes what happens when something throws; the happy path is untouched.
//
// Covers the two things that weren't handled anywhere before this: a malformed
// request body (req.json() throws SyntaxError), and a Prisma call against a
// record that's gone - edited or deleted from another tab/device between the
// page loading and the request landing (P2025 "record not found").
//
// Usage: export const PATCH = withErrorHandling(async (req, { params }) => { ... });
export function withErrorHandling<Ctx = unknown>(
  handler: (req: NextRequest, ctx: Ctx) => Promise<NextResponse>
) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof SyntaxError) {
        return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2025") {
          return NextResponse.json(
            { error: "That record doesn't exist anymore - someone may have deleted it." },
            { status: 404 }
          );
        }
        if (err.code === "P2002") {
          return NextResponse.json({ error: "That already exists" }, { status: 409 });
        }
        if (err.code === "P2003") {
          return NextResponse.json(
            { error: "That references something that doesn't exist anymore." },
            { status: 400 }
          );
        }
      }
      // eslint-disable-next-line no-console
      console.error(`[api] ${req.method} ${req.nextUrl.pathname} failed:`, err);
      return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
    }
  };
}
