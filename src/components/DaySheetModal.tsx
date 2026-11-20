"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, FileText, Mail, TriangleAlert, Users, X } from "lucide-react";
import { assertNoMoney } from "@/lib/moneyGuard";
import { apiFetch } from "@/lib/apiFetch";
import { buildSheetMailto, outlookToList } from "@/lib/sheetEmails/rules";
import { useAuth } from "./AuthProvider";
import SheetEmailListModal from "./SheetEmailListModal";

// Preview of the generated day sheet before it goes out. Editable, since truck/driver
// movements aren't tracked in the app yet and a supervisor may want to tweak wording -
// then either copy it straight into WhatsApp/etc, or open it as an email draft.
export default function DaySheetModal({
  subject,
  body,
  scopeJobs,
  onSent,
  onClose,
}: {
  subject: string;
  body: string;
  scopeJobs: { id: string; title: string; projectId: string }[];
  // The sheet went out (copied or opened in email) - the board records when, so it can tell if the day changes after.
  onSent?: (how: "COPY" | "EMAIL") => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(body);
  const [copied, setCopied] = useState(false);
  // This goes straight to the whole crew - re-checked on every edit, since a
  // supervisor is free to paste something in before it goes out (Phase 6).
  const clean = useMemo(() => assertNoMoney(text), [text]);

  // The allocation email list (Ilies, 20 Nov 2026): Managers / Admins get its addresses in To. Anyone else opens the
  // email as before, with no recipients. null = still loading (Open in email waits for it).
  const { canEdit } = useAuth();
  const [emails, setEmails] = useState<string[] | null>(canEdit ? null : []);
  const [listError, setListError] = useState(false);
  const [showList, setShowList] = useState(false);
  const [listCopied, setListCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const onListChanged = useCallback((e: string[]) => setEmails(e), []);

  useEffect(() => {
    if (!canEdit) return;
    let live = true;
    apiFetch("/api/sheet-emails", { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) { setListError(true); setEmails([]); return; }
        const l = await res.json();
        if (live) setEmails((l.active ?? []).map((r: { email: string }) => r.email));
      })
      .catch(() => { if (live) { setListError(true); setEmails([]); } });
    return () => { live = false; };
  }, [canEdit]);

  // What "Open in email" will do with this list and this text - worked out before the click, so it's on screen.
  const mail = useMemo(() => buildSheetMailto(emails ?? [], subject, text), [emails, subject, text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !showList && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, showList]);

  async function copyList() {
    try {
      await navigator.clipboard.writeText(outlookToList(emails ?? []));
      setListCopied(true);
      setTimeout(() => setListCopied(false), 2000);
    } catch {
      setNotice("Couldn't copy the email list - open Email list to see the addresses.");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      onSent?.("COPY");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions, non-secure context) - the textarea is still
      // right there to select and copy by hand.
    }
  }

  // Opens Outlook. Whatever is too long for an email link (lib/sheetEmails/rules.ts MAILTO_SAFE_LENGTH) is left out
  // whole and copied instead, with a note saying what to paste where - never a cut-short sheet or a partial To list.
  async function emailIt() {
    const { href, mode } = mail;
    onSent?.("EMAIL");
    let copiedOk = true;
    if (mode !== "FULL") {
      try {
        await navigator.clipboard.writeText(mode === "NO_BODY" ? text : outlookToList(emails ?? []));
      } catch {
        copiedOk = false;
      }
    }
    if (mode === "FULL") setNotice(null);
    else if (mode === "NO_BODY")
      setNotice(
        copiedOk
          ? "The sheet is too long to go in the email link, so it's copied: click in the email's body and paste (Ctrl+V)."
          : "The sheet is too long to go in the email link: press \"Copy to clipboard\", then paste it into the email's body."
      );
    else
      setNotice(
        copiedOk
          ? `The email list is too long for an email link, so the email opened with no one in To. The ${emails?.length ?? 0} addresses are copied: paste (Ctrl+V) into To. Then press "Copy to clipboard" here and paste the sheet into the body.`
          : `The email list is too long for an email link: press "Copy email list" and paste into To, then "Copy to clipboard" and paste the sheet into the body.`
      );
    window.location.href = href;
  }

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Day sheet"
    >
      <div
        className="animate-modal-in flex max-h-full w-full max-w-2xl flex-col rounded-2xl border border-edge bg-canvas shadow-soft-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
          <div>
            <div className="text-base font-semibold text-gray-100">Day sheet</div>
            <div className="text-xs text-gray-500">
              Review before it goes out. Truck &amp; driver movements aren't tracked in the app -
              fill that bit in below.
            </div>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-gray-500 hover:bg-panel2 hover:text-gray-200"
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={22}
            className="w-full resize-y rounded-lg border border-edge bg-panel2 p-3 font-mono text-xs leading-relaxed text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
          />
        </div>

        {scopeJobs.length > 0 && (
          <div className="border-t border-edge px-5 py-3.5">
            <div className="text-xs font-medium text-gray-300">
              Scope-of-works PDFs for today's jobs
            </div>
            <div className="mt-1 text-[11px] text-gray-500">
              Outlook's "mailto" link can't carry attachments - download the ones you need below, then drag them
              into the email window once it opens.
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {scopeJobs.map((j) => (
                <a
                  key={j.id}
                  href={`/api/projects/${j.projectId}/scope-pdf?download=1`}
                  download
                  className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-panel2"
                >
                  <FileText size={13} className="text-brand-500" />
                  {j.title}
                </a>
              ))}
            </div>
          </div>
        )}

        {canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge px-5 py-3">
            <div className="text-xs text-gray-400" data-testid="sheet-email-to">
              {emails === null
                ? "Loading the email list..."
                : listError
                  ? "Couldn't load the email list - the email will open with no one in To."
                  : emails.length
                    ? `To: ${emails.length} address${emails.length === 1 ? "" : "es"} on the email list`
                    : "No one on the email list yet - the email opens with an empty To line."}
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyList}
                disabled={!emails?.length}
                className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-40"
                title="Copy the addresses, separated by semicolons, to paste into Outlook's To box"
              >
                {listCopied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                {listCopied ? "Copied!" : "Copy email list"}
              </button>
              <button
                onClick={() => setShowList(true)}
                className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-panel2"
              >
                <Users size={13} />
                Email list ({emails?.length ?? "…"})
              </button>
            </div>
          </div>
        )}

        {clean && mail.mode !== "FULL" && !notice && (
          <div className="border-t border-edge px-5 py-2 text-xs text-amber-500" data-testid="sheet-email-hint">
            {mail.mode === "NO_BODY"
              ? "Sheet too long for an email link: Outlook opens with To and subject, and the sheet is copied - paste it into the body."
              : "Email list too long for an email link: Outlook opens with the subject only, and the addresses are copied - paste them into To."}
          </div>
        )}

        {notice && (
          <div className="flex items-start gap-2 border-t border-edge bg-amber-950/20 px-5 py-2.5 text-xs text-amber-400" role="status">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            {notice}
          </div>
        )}

        {!clean && (
          <div className="flex items-center gap-2 border-t border-edge bg-red-950/20 px-5 py-2.5 text-xs text-red-400">
            <TriangleAlert size={14} className="shrink-0" />
            This looks like it contains a dollar amount - remove it before sending this to the crew.
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-edge px-5 py-4">
          <button
            onClick={copy}
            disabled={!clean}
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-gray-300 hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {copied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
          <button
            onClick={emailIt}
            disabled={!clean || emails === null}
            data-mailto={mail.href}
            data-mailto-mode={mail.mode}
            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
          >
            <Mail size={15} />
            Open in email
          </button>
        </div>
      </div>
      {showList && (
        <div onClick={(e) => e.stopPropagation()}>
          <SheetEmailListModal onClose={() => setShowList(false)} onChanged={onListChanged} />
        </div>
      )}
    </div>
  );
}
