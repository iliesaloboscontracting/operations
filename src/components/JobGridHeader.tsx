export const GRID_COLS =
  "grid-cols-[minmax(190px,1fr)_minmax(180px,1.1fr)_minmax(260px,2fr)_minmax(180px,1.2fr)_minmax(140px,1fr)]";

export interface ColumnTotals {
  crew: [number, number];
  plant: [number, number];
  hire: [number, number];
}

function Count({ v }: { v: [number, number] }) {
  return (
    <span className="ml-1 font-normal normal-case text-gray-500">
      {v[0]} <span className="text-gray-400">/</span> {v[1]}
    </span>
  );
}

export default function JobGridHeader({ totals }: { totals: ColumnTotals }) {
  return (
    <div
      className={`grid ${GRID_COLS} gap-2 border-b border-edge bg-panel px-1 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500`}
    >
      <div className="pl-3">Site</div>
      <div>Day Brief</div>
      <div>
        Crew
        <Count v={totals.crew} />
      </div>
      <div>
        Plant
        <Count v={totals.plant} />
      </div>
      <div>
        Hire
        <Count v={totals.hire} />
      </div>
    </div>
  );
}
