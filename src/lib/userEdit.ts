// SEC-002-R2 (27 Oct 2026): a change to a login and its UserEvent are saved together - if either fails, neither is
// kept, so the log never records a change that didn't happen (or the reverse).
import type { Prisma, PrismaClient } from "@prisma/client";

export type UserEditEvent = { userId: string; action: "EDIT"; changes: string; by: string; byUserId: string } | null;

// R2-POST (27 Oct 2026): a new login and its CREATE event, together or not at all.
export function saveUserCreate<S extends Prisma.UserSelect>(db: PrismaClient, data: Prisma.UserCreateInput, by: { name: string; id: string }, select: S) {
  return db.$transaction(async (tx) => {
    const { id } = await tx.user.create({ data, select: { id: true } });
    await tx.userEvent.create({ data: { userId: id, action: "CREATE", changes: JSON.stringify({ name: data.name, email: data.email, role: data.role }), by: by.name, byUserId: by.id } });
    return tx.user.findUniqueOrThrow({ where: { id }, select });
  });
}

export function saveUserEdit<S extends Prisma.UserSelect>(db: PrismaClient, id: string, data: Prisma.UserUpdateInput, event: UserEditEvent, select: S) {
  return db.$transaction(async (tx) => {
    if (event) await tx.userEvent.create({ data: event });
    return tx.user.update({ where: { id }, data, select });
  });
}
