"use client";

import { Fragment, useState } from "react";

export interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "select" | "textarea" | "date" | "password" | "number";
  options?: (string | { value: string; label: string })[];
  placeholder?: string;
  required?: boolean;
  full?: boolean; // span both columns
  section?: string; // groups fields under a heading; a new value starts a new section
}

const input =
  "w-full rounded-md border border-edge bg-panel2 px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-brand-500";

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
  wide?: boolean; // use a wider modal, for when `extra` needs the room
  submitLabel?: string;
  savingLabel?: string;
}) {
  const [values, setValues] = useState<Record<string, any>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        onSubmit={submit}
        className={`max-h-full w-full overflow-y-auto rounded-lg border border-edge bg-panel p-4 ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <h2 className="mb-3 text-sm font-semibold text-gray-100">{title}</h2>
        <div className="grid grid-cols-2 gap-2">
          {fields.map((f, i) => (
            <Fragment key={f.key}>
              {f.section && f.section !== fields[i - 1]?.section && (
                <div
                  key={`section-${f.section}`}
                  className={`col-span-2 text-xs font-semibold uppercase tracking-wide text-gray-400 ${
                    i === 0 ? "" : "mt-3 border-t border-edge pt-3"
                  }`}
                >
                  {f.section}
                </div>
              )}
              <label
                className={`flex flex-col gap-1 text-[11px] uppercase tracking-wide text-gray-500 ${
                  f.full || f.type === "textarea" ? "col-span-2" : ""
                }`}
              >
                {f.label}
                {f.type === "select" ? (
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

        {error && <div className="mt-2 text-xs text-red-400">{error}</div>}

        <div className="mt-4 flex items-center justify-between">
          {onDelete ? (
            <button
              type="button"
              onClick={remove}
              className="text-sm text-red-400 hover:text-red-300"
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
              className="rounded-md px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {saving ? savingLabel ?? `${submitLabel}...` : submitLabel}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
