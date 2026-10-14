// Standard scrolling page wrapper for non-board pages.
// `title` takes a ReactNode (not just string) so a page can swap in its own
// heading markup (e.g. a different font) without every other page - which
// just passes a plain string, still valid ReactNode - having to change.
export default function PageShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: React.ReactNode;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto px-6 py-6 lg:px-8">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-100">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
