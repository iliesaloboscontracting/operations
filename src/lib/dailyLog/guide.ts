// The supervisor guide for the daily log (30 Oct 2026, wording approved by Ilies - use as written). Shown on links that
// have the daily log (SUPERVISOR, and HANDOVER on a supervisor's job): a "What's new" card on the link's home until
// "Got it", and a "How to use the daily log" link that's always there. Bump GUIDE_VERSION to show a new card.
// No money anywhere in it.
export const GUIDE_VERSION = 1;
export const GUIDE_TITLE = "New: daily log with photos and voice";
export const GUIDE_STEPS: { lead: string; text: string }[] = [
  { lead: "Start of the day - Before photos.", text: "Take up to 6 photos of the site before work starts. Each one saves straight away." },
  { lead: "End of the day - Talk through your day.", text: "Tap the mic and talk for up to 5 minutes: who was on, what you did, machines and how long, hold-ups, tip runs, safety, and the plan for tomorrow. Tap Stop when you're done." },
  { lead: "Check it.", text: "Read the tidy version, including anything under \"Check this\"." },
  { lead: "Tap \"Fill my log from this\",", text: "then check each step." },
  { lead: "After photos.", text: "Take up to 6 photos of the site at the end of the day." },
  { lead: "Send.", text: "" },
];
export const GUIDE_NOTES = [
  "You can still type everything instead of talking.",
  "Record again to add more. It adds on, it doesn't replace.",
  "Anything you typed is never written over.",
  "Don't say prices or dollar amounts.",
  "Keep the phone close to you and away from loud machines.",
  "If a job has no log or no before/after photos, you'll get a reminder at 7pm.",
];
