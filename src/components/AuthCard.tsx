// Centered card used by the login and first-run setup pages.
export default function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Lobos Contracting" width={400} height={96} className="mx-auto mb-6 h-auto w-64" />
        <div className="rounded-lg border border-edge bg-panel p-5 shadow-sm">
          <h1 className="text-lg font-bold text-gray-100">{title}</h1>
          {subtitle && <p className="mb-4 mt-0.5 text-sm text-gray-500">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export const authInput =
  "w-full rounded-md border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500";
