// SEC-002-R2 (27 Oct 2026): a change to a login and its UserEvent are saved together - if either fails, neither is
// kept, so the log never records a change that didn't happen (or the reverse).
import type { Prisma, PrismaClient } from "@prisma/client";

export type UserEditEvent = { userId: string; action: "EDIT"; changes: string; by: string; byUserId: string } | null;

export function saveUserEdit<S extends Prisma.UserSelect>(db: PrismaClient, id: string, data: Prisma.UserUpdateInput, event: UserEditEvent, select: S) {
  return db.$transaction(async (tx) => {
    if (event) await tx.userEvent.create({ data: event });
    return tx.user.update({ where: { id }, data, select });
  });
}
