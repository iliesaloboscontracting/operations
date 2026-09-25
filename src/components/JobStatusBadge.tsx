import { JobStatus } from "@/lib/types";

const META: Record<JobStatus, { label: string; dot: string; text: string }> = {
  ACTIVE: { label: "Active", dot: "bg-emerald-500", text: "text-emerald-600" },
  INACTIVE: { label: "Inactive", dot: "bg-gray-400", text: "text-gray-500" },
  COMPLETED: { label: "Completed", dot: "bg-blue-500", text: "text-blue-600" },
};

// Active is the expected, common state - a plain green light, no text needed.
// The exceptions (Inactive / Completed) get a label too, since those are the
// ones that need explaining.
export default function JobStatusBadge({
  status,
  className = "",
}: {
  status: JobStatus;
  className?: string;
}) {
  const m = META[status] ?? META.ACTIVE;
  if (status === "ACTIVE") {
    return (
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${m.dot} ${className}`}
        title="Active"
        aria-label="Active"
      />
    );
  }
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase ${m.text} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden />
      {m.label}
    </span>
  );
}
