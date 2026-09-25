import PageShell from "./PageShell";

export default function ComingSoon({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <PageShell title={title} subtitle={blurb}>
      <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">
        Coming soon
      </div>
    </PageShell>
  );
}
