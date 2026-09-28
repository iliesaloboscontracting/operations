// "Today" for cutoffs like Project Tracking's cost-to-date - always
// Australia/Sydney's calendar day, not the server's UTC day. Before roughly
// 10-11am UTC (Sydney's midnight into morning), the UTC day is still
// yesterday, which silently excluded a whole morning's worth of today's own
// running jobs from every "to date" total.
export function todaySydney(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
