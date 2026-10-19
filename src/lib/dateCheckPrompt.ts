// Client side of the job date checks (lib/dateRulesServer.ts). Runs a save;
// if the server comes back with a DATE_WARNING, shows the warnings and asks
// for a reason, then saves again with it. Cancelling (or giving no reason)
// returns the original warning response, so the caller's normal error
// handling shows the message.
export async function saveWithDateCheck(send: (dateCheckNote?: string) => Promise<Response>): Promise<Response> {
  const res = await send();
  if (res.status !== 409) return res;
  const body = await res.clone().json().catch(() => null);
  if (body?.code !== "DATE_WARNING" || !Array.isArray(body.warnings)) return res;
  const reason = window.prompt(
    `Check the date before saving:\n\n• ${body.warnings.join("\n• ")}\n\nType a reason to save it anyway (e.g. "early works", "weekend shift"), or Cancel:`
  );
  if (!reason || !reason.trim()) return res;
  return send(reason.trim());
}
