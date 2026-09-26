"use client";

import { Fragment, useEffect, useState } from "react";
import { X } from "lucide-react";

export interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "select" | "textarea" | "date" | "password" | "number" | "static";
  options?: (string | { value: string; label: string })[];
  placeholder?: string;
  required?: boolean;
  full?: boolean; // span every column
  span?: 2 | 3; // span this many columns (ignored if `full` is set) - for a grid wider than 2 columns
  section?: string; // groups fields under a heading; a new value starts a new section
  // For type "static": fixed display text, shown instead of an editable control.
  // values[key] is left untouched and still submitted as-is - use this when the
  // value is already decided by context (e.g. which row you clicked) and picking
  // a different one doesn't make sense.
  staticText?: string;
}

const COLS_CLASS: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };
const SPAN_CLASS: Record<number, string> = { 2: "col-span-2", 3: "col-span-3" };

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";

export default function FormModal({
  title,
  fields,
  initial,
  onSave,
  onClose,
  onDelete,
  deleteLabel = "Delete",
  extra,
  wide,
  cols = 2,
  submitLabel = "Save",
  savingLabel,
}: {
  title: string;
  fields: FieldDef[];
  initial: Record<string, any>;
  onSave: (values: Record<string, any>) => Promise<void>;
  onClose: () => void;
  onDelete?: () => Promise<void>;
  deleteLabel?: string;
  extra?: React.ReactNode; // extra content below the fields (e.g. a related-records panel)
  wide?: boolean; // use a wider modal, for when `extra` needs the room, or a wider field grid
  cols?: 2 | 3 | 4; // grid columns for the fields - more columns fits a wider modal without every field going full-width
  submitLabel?: string;
  savingLabel?: string;
}) {
  const [values, setValues] = useState<Record<string, any>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    for (const f of fields) {
      if (f.required && !String(values[f.key] ?? "").trim()) {
        setError(`${f.label} is required`);
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
      onClose();
    } catch (err) {
      setError((err as Error).message || "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!onDelete) return;
    if (!confirm(`${deleteLabel} this item?`)) return;
    setSaving(true);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError((err as Error).message || "Couldn't delete");
      setSaving(false);
    }
  }

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className={`animate-modal-in max-h-full w-full overflow-y-auto rounded-2xl border border-edge bg-panel p-5 shadow-soft-lg ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-gray-500 hover:bg-panel2 hover:text-gray-200"
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>
        <div className={`grid ${COLS_CLASS[cols]} gap-3`}>
          {fields.map((f, i) => (
            <Fragment key={f.key}>
              {f.section && f.section !== fields[i - 1]?.section && (
                <div
                  key={`section-${f.section}`}
                  className={`col-span-full text-xs font-semibold uppercase tracking-wide text-gray-400 ${
                    i === 0 ? "" : "mt-3 border-t border-edge pt-3"
                  }`}
                >
                  {f.section}
                </div>
              )}
              <label
                className={`flex flex-col gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 ${
                  f.full || f.type === "textarea" ? "col-span-full" : f.span ? SPAN_CLASS[f.span] : ""
                }`}
              >
                {f.label}
                {f.type === "static" ? (
                  <div className={`${input} cursor-default bg-panel2/60 text-gray-300`}>
                    {f.staticText}
                  </div>
                ) : f.type === "select" ? (
                  <select
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    className={input}
                  >
                    {f.options?.map((o) => {
                      const v = typeof o === "string" ? o : o.value;
                      const l = typeof o === "string" ? o : o.label;
                      return (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      );
                    })}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea
                    rows={3}
                    value={values[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    className={input}
                  />
                ) : (
                  <input
                    type={f.type === "date" ? "date" : f.type === "password" ? "password" : f.type === "number" ? "number" : "text"}
                    step={f.type === "number" ? "0.01" : undefined}
                    autoComplete={f.type === "password" ? "new-password" : undefined}
                    value={values[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    className={input}
                  />
                )}
              </label>
            </Fragment>
          ))}
        </div>

        {extra && (
          // Enter inside here (e.g. an inline record form) must not submit the outer form.
          <div
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") e.preventDefault();
            }}
          >
            {extra}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-edge pt-4">
          {onDelete ? (
            <button
              type="button"
              onClick={remove}
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              {deleteLabel}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-gray-400 hover:bg-panel2 hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-500 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {saving ? savingLabel ?? `${submitLabel}...` : submitLabel}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
