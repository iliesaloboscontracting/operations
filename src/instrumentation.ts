// Runs once when the server starts. Background check (21 Oct 2026): every
// minute, re-alert Ilies's phone about Urgent site requests still unopened.
// The runtime check must be written exactly like this so the Node-only code
// is left out of the edge build.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { realertUnopenedUrgent } = await import("./lib/requestAlerts");
    setInterval(() => {
      realertUnopenedUrgent().catch((e) => console.error("re-alert check", e));
    }, 60_000);
  }
}
