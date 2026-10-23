// Runs once when the server starts. Background check (21 Oct 2026): every
// minute, re-alert Ilies's phone about Urgent site requests still unopened,
// and send any request reminders that have come due.
// The runtime check must be written exactly like this so the Node-only code
// is left out of the edge build.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { realertUnopenedUrgent } = await import("./lib/requestAlerts");
    const { alertDueReminders } = await import("./lib/requestReminders");
    setInterval(() => {
      realertUnopenedUrgent().catch((e) => console.error("re-alert check", e));
      // Ilies's reminders on non-urgent requests (23 Oct 2026).
      alertDueReminders().catch((e) => console.error("reminder check", e));
    }, 60_000);
  }
}
