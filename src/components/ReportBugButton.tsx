"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";

const input =
  "w-full rounded-md border border-edge bg-panel2 px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-brand-500";

// "Report a bug" trigger + form. Lives inline in The Yard sidebar on the Command
// Centre (not floating - a fixed-position button here used to sit on top of the
// header's own buttons). Anyone signed in can file one; reports land on the Bug
// Reports page for triage.
export default function ReportBugButton({ className = "" }: { className?: string }) {
  const { user } = useAuth();
  const path = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("MEDIUM");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!user) return null;

  function reset() {
    setTitle("");
    setDescription("");
    setSeverity("MEDIUM");
    setError(null);
    setDone(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError("Give it a short title and describe what happened.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          severity,
          page: path,
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error("Couldn't send that. Try again.");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Report a bug"
        className={`flex w-full items-center justify-center gap-1.5 rounded-md border border-edge bg-panel2 px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-panel2/60 ${className}`}
      >
        🐞 Report a bug
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg border border-edge bg-panel p-4"
          >
            {done ? (
              <>
                <h2 className="mb-1 text-sm font-semibold text-gray-100">Thanks — logged.</h2>
                <p className="mb-4 text-sm text-gray-400">
                  It's on the Bug Reports page for triage. You can close this now.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      reset();
                    }}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="mb-1 text-sm font-semibold text-gray-100">Report a bug</h2>
                <p className="mb-3 text-xs text-gray-500">
                  Reported from <span className="text-gray-400">{path}</span> as {user.name}.
                </p>
                <div className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-gray-500">
                    What's it called?
                    <input
                      autoFocus
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Crew chip won't drag onto Night jobs"
                      className={input}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-gray-500">
                    What happened? Steps to see it again help a lot.
                    <textarea
                      rows={4}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What you did, what you expected, what happened instead..."
                      className={input}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-gray-500">
                    How bad is it?
                    <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={input}>
                      <option value="LOW">Low — minor annoyance</option>
                      <option value="MEDIUM">Medium — gets in the way</option>
                      <option value="HIGH">High — blocks the work</option>
                    </select>
                  </label>
                </div>
                {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      reset();
                    }}
                    className="rounded-md px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                  >
                    {saving ? "Sending..." : "Send report"}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
}
