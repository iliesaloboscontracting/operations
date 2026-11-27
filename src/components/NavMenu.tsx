"use client";

// Grouped top menu (Ilies, 27 Nov 2026: on a laptop "it becomes difficult to navigate the app as its almost like theres
// not enough screen"). About 27 tabs sat in one sideways-scrolling row and most were off the right of a laptop screen.
// Between 768 px and 3440 px wide, TopNav shows the SAME tabs (after its own role filtering - nothing is added or taken
// away here) grouped into a few named menus. At 3440 px and over (Ilies's 49" ultrawide) the flat row is exactly as
// before. Why 3440 and not ~1700: the flat row needs a ~3,250 px (Admin) to ~3,470 px (owner) wide window to show every
// tab, so a 1920 or 2560 px screen hid most of them too. Under 768 px (phones) the flat sideways-scrolling row stays.
//
// A group with no visible pages disappears; a group with one page is a plain link. A page with no group (e.g. the
// coordinator's Dashboard) is a plain link before the groups, so a new tab can never go missing.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
  badgeTitle?: string;
  /** A full page load (Estimating is its own app behind /estimating), not client navigation. */
  external?: boolean;
};

const PRESTARTS = "/faults?tab=checks";
export const NAV_GROUPS: { key: string; label: string; hrefs: string[] }[] = [
  { key: "board", label: "Allocations", hrefs: ["/command"] },
  { key: "projects", label: "Projects", hrefs: ["/projects", "/calendar", "/tracking", "/completed"] },
  { key: "site", label: "Site & safety", hrefs: ["/day-review", "/requests", PRESTARTS, "/variations", "/documents", "/incidents", "/bins", "/receipts"] },
  { key: "people", label: "People & hours", hrefs: ["/attendance", "/timesheets", "/timesheets/labour-hire", "/labour"] },
  { key: "plant", label: "Plant & tools", hrefs: ["/plant", "/vehicles", "/hire", "/tools", "/faults"] },
  { key: "office", label: "Office", hrefs: ["/office-requests", "/purchases", "/messages", "/questions"] },
  { key: "more", label: "More", hrefs: ["/assistant", "/bugs", "/estimating", "/users"] },
];

export type NavEntry =
  | { kind: "link"; item: NavItem }
  | { kind: "group"; key: string; label: string; items: NavItem[] };

/** Group an already role-filtered list. Every item comes out exactly once. */
export function groupNav(items: NavItem[]): NavEntry[] {
  const grouped = new Set(NAV_GROUPS.flatMap((g) => g.hrefs));
  const loose: NavEntry[] = items.filter((i) => !grouped.has(i.href)).map((item) => ({ kind: "link", item }));
  const groups: NavEntry[] = NAV_GROUPS.flatMap((g): NavEntry[] => {
    const mine = g.hrefs.map((h) => items.find((i) => i.href === h)).filter((i): i is NavItem => !!i);
    if (mine.length === 0) return [];
    if (mine.length === 1) return [{ kind: "link", item: mine[0] }];
    return [{ kind: "group", key: g.key, label: g.label, items: mine }];
  });
  return [...loose, ...groups];
}

const TAB = "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm";
const ON = "bg-white/12 font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]";
const OFF = "text-slate-300 hover:bg-white/5 hover:text-white";

function Badge({ n, title }: { n?: number; title?: string }) {
  if (!n) return null;
  return (
    <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-black" title={title}>
      {n}
    </span>
  );
}

function PlainLink({ item }: { item: NavItem }) {
  const cls = `${TAB} ${item.active ? ON : OFF}`;
  const inner = (
    <>
      {item.label}
      <Badge n={item.badge} title={item.badgeTitle} />
    </>
  );
  return item.external ? (
    <a href={item.href} className={cls}>{inner}</a>
  ) : (
    <Link href={item.href} className={cls} aria-current={item.active ? "page" : undefined}>{inner}</Link>
  );
}

function GroupMenu({ entry, open, setOpen }: { entry: Extract<NavEntry, { kind: "group" }>; open: boolean; setOpen: (o: boolean) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const focusOnOpen = useRef<"first" | "last" | null>(null);
  const active = entry.items.some((i) => i.active);
  const badge = entry.items.reduce((n, i) => n + (i.badge ?? 0), 0);

  // Fixed position under the button, so the sideways-scrolling nav row never clips the menu; kept inside the window.
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = menu.current?.offsetWidth ?? 240;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 6 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (focusOnOpen.current) {
      const list = items();
      (focusOnOpen.current === "first" ? list[0] : list[list.length - 1])?.focus();
      focusOnOpen.current = null;
    }
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    const close = () => setOpen(false);
    const scrolled = (e: Event) => { if (!menu.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", scrolled, true);
    };
  }, [open, setOpen]);

  const onButtonKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusOnOpen.current = e.key === "ArrowDown" ? "first" : "last";
      if (open) {
        const list = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        (e.key === "ArrowDown" ? list[0] : list[list.length - 1])?.focus();
        focusOnOpen.current = null;
      } else setOpen(true);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { e.preventDefault(); list[(i + list.length) % list.length]?.focus(); };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === "Tab") { setOpen(false); }
  };

  return (
    <div className="shrink-0">
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen(!open)}
        onKeyDown={onButtonKey}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={`${TAB} ${active ? ON : open ? "bg-white/10 text-white" : OFF}`}
      >
        {entry.label}
        <Badge n={badge} title="Waiting in this menu" />
        <ChevronDown size={14} className={`shrink-0 opacity-70 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={entry.label}
          onKeyDown={onMenuKey}
          style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
          className="animate-modal-in z-50 min-w-[13rem] overflow-hidden rounded-xl border border-white/10 bg-sidebar py-1 shadow-soft-lg"
        >
          {entry.items.map((i) => {
            const cls = `flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm outline-none focus-visible:bg-white/10 ${
              i.active ? "bg-white/10 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`;
            const inner = (
              <>
                <span className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${i.active ? "bg-brand-500" : "bg-transparent"}`} aria-hidden />
                  {i.label}
                </span>
                <Badge n={i.badge} title={i.badgeTitle} />
              </>
            );
            return i.external ? (
              <a key={i.href} href={i.href} role="menuitem" tabIndex={-1} className={cls} onClick={() => setOpen(false)}>{inner}</a>
            ) : (
              <Link key={i.href} href={i.href} role="menuitem" tabIndex={-1} className={cls} aria-current={i.active ? "page" : undefined} onClick={() => setOpen(false)}>
                {inner}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The grouped row. One menu open at a time; any navigation closes it. */
export default function GroupedNav({ entries }: { entries: NavEntry[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const path = usePathname();
  useEffect(() => setOpenKey(null), [path]);
  return (
    <>
      {entries.map((e) =>
        e.kind === "link" ? (
          <PlainLink key={e.item.href} item={e.item} />
        ) : (
          <GroupMenu key={e.key} entry={e} open={openKey === e.key} setOpen={(o) => setOpenKey(o ? e.key : null)} />
        )
      )}
    </>
  );
}
