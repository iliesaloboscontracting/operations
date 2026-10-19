// The one way a tool is added to the inventory - from the office screen, an
// office/yard person's phone link, or a supervisor's link - so every path
// follows the same rules (19 Oct 2026):
//   - a new tool needs a serial number OR "plate not readable" ticked;
//   - the same serial can never be registered twice (also enforced by the
//     unique serialKey column, as a backstop);
//   - the LOB tag is given automatically when one isn't supplied.
import { prisma } from "./prisma";
import { moveTool } from "./toolMoves";
import { normSerial } from "./toolboxCheck";
import { pickTool, toolFieldError } from "./pickTool";

export const serialKeyOf = (s: unknown) => (typeof s === "string" ? normSerial(s) || null : null);

export type Duplicate = { id: string; tag: string; name: string; toolbox: string | null };

// The tool already registered with this serial (ignoring spaces, dashes,
// dots and case), if any.
export async function findDuplicate(serial: unknown, excludeId?: string): Promise<Duplicate | null> {
  const key = serialKeyOf(serial);
  if (!key) return null;
  await fillMissingSerialKeys();
  const t = await prisma.tool.findUnique({
    where: { serialKey: key },
    select: { id: true, tag: true, name: true, toolbox: { select: { name: true } } },
  });
  if (!t || t.id === excludeId) return null;
  return { id: t.id, tag: t.tag, name: t.name, toolbox: t.toolbox?.name ?? null };
}

// Tools registered before serialKey existed (or edited outside these routes)
// get their key filled in here, so the duplicate check sees them too. If two
// old tools already share a serial, the second is left without a key - the
// office can see both on the register.
async function fillMissingSerialKeys() {
  const old = await prisma.tool.findMany({ where: { serialKey: null, serialNumber: { not: null } }, select: { id: true, serialNumber: true } });
  for (const t of old) {
    const key = serialKeyOf(t.serialNumber);
    if (!key) continue;
    await prisma.tool.update({ where: { id: t.id }, data: { serialKey: key } }).catch(() => undefined);
  }
}

export const duplicateMessage =(d: Duplicate) =>
  `Already registered as ${d.tag} (${d.name})${d.toolbox ? `, in ${d.toolbox}` : ", in the yard"} - it hasn't been added again.`;

export async function nextToolTag() {
  const tags = await prisma.tool.findMany({ select: { tag: true } });
  const max = tags.reduce((n, t) => Math.max(n, Number(t.tag.match(/LOB-(\d+)/)?.[1] ?? 0)), 0);
  return `LOB-${String(max + 1).padStart(4, "0")}`;
}

type CreateOptions = {
  photoIds?: string[];
  siteLinkId?: string | null; // photos must have come through this link
  toolboxId?: string | null;
  addedFrom: "OFFICE" | "OFFICE_LINK" | "SITE";
  addedBy: string | null;
  needsCheck: boolean;
};

export type CreateResult =
  | { ok: true; tool: { id: string; tag: string; name: string } }
  | { ok: false; status: number; error: string; duplicate?: Duplicate };

export async function createTool(body: Record<string, unknown>, opts: CreateOptions): Promise<CreateResult> {
  const data = pickTool(body);
  const invalid = toolFieldError(data);
  if (invalid) return { ok: false, status: 400, error: invalid };
  if (typeof data.name !== "string" || !data.name.trim()) return { ok: false, status: 400, error: "Say what the tool is." };

  const key = serialKeyOf(data.serialNumber);
  if (!key && !data.plateUnreadable) {
    return { ok: false, status: 400, error: "Enter the serial number, or tick “Plate not readable”." };
  }
  if (key && data.plateUnreadable) data.plateUnreadable = false; // a serial was read after all
  const dup = await findDuplicate(data.serialNumber);
  if (dup) return { ok: false, status: 409, error: duplicateMessage(dup), duplicate: dup };

  if (opts.toolboxId) {
    const box = await prisma.toolbox.findUnique({ where: { id: opts.toolboxId }, select: { active: true } });
    if (!box?.active) return { ok: false, status: 400, error: "That toolbox doesn't exist anymore." };
  }

  // Tag: the one given (office screen), else the next free one. Two people
  // adding at the same moment can collide on the tag - retry with the next.
  const givenTag = typeof data.tag === "string" && data.tag.trim() ? data.tag.trim() : null;
  let tool: { id: string; tag: string; name: string } | null = null;
  for (let attempt = 0; attempt < 3 && !tool; attempt++) {
    const tag = givenTag ?? (await nextToolTag());
    try {
      tool = await prisma.tool.create({
        data: {
          ...(data as Record<string, unknown>),
          tag,
          name: (data.name as string).trim(),
          serialKey: key,
          heldBy: (data.heldBy as string) || "Yard",
          condition: (data.condition as string) || "Good",
          addedFrom: opts.addedFrom,
          addedBy: opts.addedBy,
          needsCheck: opts.needsCheck,
        } as never,
        select: { id: true, tag: true, name: true },
      });
    } catch (err: unknown) {
      const e = err as { code?: string; meta?: { target?: string[] | string } };
      if (e?.code !== "P2002") throw err;
      const target = String(e.meta?.target ?? "");
      if (target.includes("serialKey")) {
        const d = await findDuplicate(data.serialNumber);
        return { ok: false, status: 409, error: d ? duplicateMessage(d) : "That serial number is already registered.", duplicate: d ?? undefined };
      }
      if (givenTag) return { ok: false, status: 409, error: "That tag already exists" };
      // tag clash with someone else adding at the same time - go round again
    }
  }
  if (!tool) return { ok: false, status: 409, error: "Couldn't give the tool a tag - try again." };

  const ids = (opts.photoIds ?? []).filter((x): x is string => typeof x === "string" && !!x);
  if (ids.length) {
    await prisma.toolPhoto.updateMany({
      where: { id: { in: ids }, toolId: null, ...(opts.siteLinkId ? { siteLinkId: opts.siteLinkId } : {}) },
      data: { toolId: tool.id },
    });
  }
  if (opts.toolboxId) await moveTool(tool.id, opts.toolboxId, "Registered into this toolbox", opts.addedBy);
  return { ok: true, tool };
}
