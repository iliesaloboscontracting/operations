// Runs once when the server starts. Background check (21 Oct 2026): every
// minute, re-alert Ilies's phone about Urgent site requests still unopened,
// send any request reminders that have come due, and remind supervisors
// 20 minutes before finish when crew are still signed in, and pilot
// supervisors at 19:00 when a job has no daily log.
// The runtime check must be written exactly like this so the Node-only code
// is left out of the edge build.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { realertUnopenedUrgent } = await import("./lib/requestAlerts");
    const { alertDueReminders } = await import("./lib/requestReminders");
    const { remindBeforeFinish } = await import("./lib/signOutReminders");
    const { recordWeeklySnapshot } = await import("./lib/insights/snapshot");
    const { runFindings } = await import("./lib/findings/store");
    const { nightlyXeroSync } = await import("./lib/xero/live/service");
    const { remindDailyLogs } = await import("./lib/dailyLog/reminders");
    const { expireProposals } = await import("./lib/changes/store");
    const { readWaiting } = await import("./lib/receipts/runner");
    const { alertAccountsDue } = await import("./lib/accounts/store");
    setInterval(() => {
      // Xero (read-only, G3): once a day from 2am Sydney, after the backup. Does nothing until set up and connected.
      nightlyXeroSync().catch((e) => console.error("xero nightly", e instanceof Error ? e.message : "failed"));
      // Director Insights: this week's KPI snapshot, if not taken yet (looks at most hourly).
      recordWeeklySnapshot().catch((e) => console.error("director snapshot", e));
      // Findings (Phase 2): signals -> stored findings, at most every 30 min, never two at once.
      runFindings().catch((e) => console.error("findings run", e));
      realertUnopenedUrgent().catch((e) => console.error("re-alert check", e));
      // Ilies's reminders on non-urgent requests (23 Oct 2026).
      alertDueReminders().catch((e) => console.error("reminder check", e));
      // Supervisors: crew still signed in 20 min before finish (24 Oct 2026).
      remindBeforeFinish().catch((e) => console.error("sign-out reminder check", e));
      // Pilot supervisors: no daily log by 19:00 (Task K, 25 Oct 2026). Off when DAILY_LOG_PILOT_LINKS is empty.
      remindDailyLogs().catch((e) => console.error("daily log reminder check", e));
      // Controlled changes (LCI phase 4): proposals not decided in time expire. Nothing is pushed.
      expireProposals().catch((e) => console.error("change proposal expiry", e));
      // Receipts (R2): read any receipt / odometer photo still waiting. Off with RECEIPT_READING=off.
      readWaiting().catch((e) => console.error("receipt reading", e instanceof Error ? e.message : "failed"));
      // Accounts calendar (26 Oct 2026): one phone alert per due date to the accounts login.
      alertAccountsDue().catch((e) => console.error("accounts due-date alerts", e));
    }, 60_000);
  }
}
