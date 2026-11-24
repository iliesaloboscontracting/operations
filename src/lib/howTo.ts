// "How to use" guides for the crew-facing screens (Ilies, 24 Nov 2026: "yes build how to use, deploy once passes").
// Plain static text - no API, no database, no outbound call, never a dollar figure. Rendered by
// components/site/HowToGuide.tsx:
//   - the driver guide on a DRIVER link (wording from the one-page Driver Guide v1 Ilies has already handed out);
//   - the supervisor guide on a SUPERVISOR link, and a shorter one on a HANDOVER link (sign-in, requests, hire, log);
//   - "How signing in works" on the QR sign-in screen (/site/in/<code>).
// POSTER and OFFICE links get nothing (guideForLink). Button names are the screens' own labels - if a label changes on
// a screen, change it here too (src/lib/howTo.test.ts checks the key ones).
//
// Regional travel (Ilies's travel design, 24 Nov 2026): driving the company truck = the truck's QR out and back, never
// "Start travel"; driving your own car or ute = "Start travel" on your link, then "Travelling home" and "Arrived";
// riding along as crew = nothing to do for travel (worked out from the driver) - sign in on the supervisor's QR at site.

export type HowToStep = { lead?: string; text?: string };
export type HowToSection = { title: string; intro?: string; steps?: HowToStep[]; numbered?: boolean; after?: string };
export type HowToGuide = { id: "driver" | "supervisor" | "handover" | "signin"; title: string; sub: string; rule?: string; sections: HowToSection[] };

export const GOLDEN_RULE =
  "The golden rule: you're signed in at one place at a time. Every time you sign in somewhere new, the last one closes by itself, and your hours keep going. Never sign out in between. Only press Sign out once, at the very end of your day.";

// --- shared pieces --------------------------------------------------------------------------------------------------

const TRUCK_CHECKS: HowToSection = {
  title: "Truck pre-start and knock-off check",
  steps: [
    { lead: "Taking the truck:", text: "scan the truck's QR (in the cab) and tap Sign in. Then take the odometer photo (Take the photo) and do the pre-start, including the walk-around photos (front, back, both sides, cab)." },
    { lead: "First sign-in on that truck today:", text: "the pre-start must be done before you drive. Your sign-in time is already saved while you do it." },
    { lead: "Not driving after all?", text: "Tap Sign out on that screen - you're never stuck." },
    { lead: "End of the day:", text: "scan the truck's QR, tap Sign out, then do the knock-off check." },
    { lead: "Found something wrong?", text: "Mark it Fault, write what's wrong, pick how urgent it is and take a photo. Do not use takes the truck off the road and tells the office straight away." },
  ],
};

const REGIONAL: HowToSection = {
  title: "Regional jobs (e.g. Shellharbour)",
  steps: [
    { lead: "Driving the company truck:", text: "sign in on the truck's QR for the drive out, and again for the drive back. Never press Start travel." },
    { lead: "Driving your own car or ute:", text: "tap Start travel on your link before you leave. On the way back, tap Travelling home, then Arrived when you get home." },
    { lead: "Riding along as crew:", text: "nothing to do for travel - it's worked out from the driver you travelled with. Just sign in on the supervisor's QR when you get to site." },
  ],
};

const SOMETHING_WRONG: HowToSection = {
  title: "If something goes wrong",
  steps: [
    { lead: "It says \"Signed in since ...\" with a Sign out button:", text: "you're already signed in there - nothing to do. Don't tap Sign out unless you're finished for the day." },
    { lead: "\"That's timed out - scan the truck QR again\":", text: "scan the truck's QR again and carry on." },
    { lead: "Forgot to sign in or out, or picked the wrong name?", text: "Tell your supervisor or the office. Only the office can fix a time." },
    { lead: "Anything else:", text: "call the office." },
  ],
};

const MESSAGES: HowToSection = {
  title: "Messages from the office",
  intro: "Sometimes a message from the office pops up after you sign in, or on your link. Read it and tap Got it.",
};

// --- driver (DRIVER link) -------------------------------------------------------------------------------------------

export const DRIVER_GUIDE: HowToGuide = {
  id: "driver",
  title: "How to use - drivers",
  sub: "Signing in, truck checks, receipts and bins",
  rule: GOLDEN_RULE,
  sections: [
    {
      title: "Your two tools",
      steps: [
        { lead: "The QR codes (signing in):", text: "scan with your phone camera - the Yard QR, the truck's QR (in the cab), or the supervisor's QR on site. The first time, pick your name. After that it's one tap." },
        { lead: "This driver link:", text: "your own private link from the office for receipts and bins. Save it on your home screen. Don't share it, because it's yours." },
      ],
    },
    {
      title: "A normal truck day",
      numbered: true,
      steps: [
        { lead: "Get to the yard:", text: "scan the Yard QR and tap Sign in." },
        { lead: "Take the truck:", text: "scan the truck's QR and tap Sign in. Then take the odometer photo and do the pre-start, including the walk-around photos (front, back, both sides, cab). On the truck's first sign-in of the day, the pre-start must be done." },
        { lead: "Arrive at a site:", text: "scan the supervisor's QR and sign in." },
        { lead: "Leave the site in the truck:", text: "scan the truck's QR and sign in again." },
        { lead: "End of the day:", text: "scan the truck's QR and tap Sign out, then do the knock-off check." },
      ],
      after: "Found something wrong with the truck? Mark it Fault in the check, write what's wrong, pick how urgent it is, and take a photo. Do not use takes the truck off the road and tells the office straight away.",
    },
    REGIONAL,
    {
      title: "Your driver link",
      steps: [
        { lead: "Add receipt:", text: "every tip docket and fuel receipt - tap Tip docket or Fuel. Take a clear photo of the whole docket when you get it. If the load could be asbestos, say so." },
        { lead: "My receipts:", text: "check what you've sent today." },
        { lead: "Reimbursement:", text: "only when you paid with your own money (e.g. fuel on your own card). Photo of the receipt. Accounts pay you back." },
        { lead: "Bins - Delivered:", text: "photo of the bin on site, then pick the job, Client's bin or Our bin, the size, and what's going in it." },
        { lead: "Bins - Picked up:", text: "pick the bin from the list and take a photo." },
      ],
    },
    MESSAGES,
    SOMETHING_WRONG,
  ],
};

// --- supervisor (SUPERVISOR link; HANDOVER gets the parts its link shows) ----------------------------------------------

const SIGN_IN_CREW: HowToSection = {
  title: "Sign in crew",
  numbered: true,
  steps: [
    { lead: "Tap Sign in crew", text: "and pick the job. Hold your phone up - the crew scan the QR with their phone camera to sign in or out. It changes every 30 seconds, so show it live (not a screenshot)." },
    { lead: "Crew without a phone:", text: "tap Tick in or Tick out next to their name. It uses the time now." },
    { lead: "Signing several out at once:", text: "tick their boxes (or Select all on site), then Sign out ... now." },
    { lead: "Only the office can change a time.", text: "If a time is wrong, tell the office." },
  ],
};

const POSTER_CONFIRM: HowToSection = {
  title: "Confirm poster sign-ins",
  intro: "Crew who sign in on the site poster wait for you to confirm them. They're under the QR on Sign in crew: \"Signed in from the poster - confirm\".",
  steps: [
    { lead: "Confirm all", text: "confirms everyone who was on site. Any with a warning (no location, or far from site) are left for you to check one by one." },
    { lead: "Confirm", text: "one person, or Wasn't here if they weren't on site." },
  ],
};

const HAND_OVER: HowToSection = {
  title: "Hand over sign-in",
  intro: "Leaving site, or someone else is running the crew? At the bottom of Sign in crew, pick who, tap Hand over, then Send. Their link only works today.",
};

const DAILY_LOG: HowToSection = {
  title: "Daily log",
  numbered: true,
  steps: [
    { lead: "Start of the day - Before photos.", text: "Photos of the site before work starts." },
    { lead: "End of the day - Talk through your day.", text: "Tap the mic and talk: who was on, what you did, machines and how long, hold-ups, tip runs, safety, and the plan for tomorrow. Tap Stop when you're done. (You can type everything instead.)" },
    { lead: "Check it,", text: "then tap Fill my log from this and check each step." },
    { lead: "After photos,", text: "then Send." },
  ],
  after: "Don't say prices or dollar amounts. No log or no before/after photos by 7pm and you'll get a reminder. \"How to use the daily log\" under the button has the full steps.",
};

const APPROVE_HOURS: HowToSection = {
  title: "Approve hours",
  numbered: true,
  steps: [
    { lead: "After the crew sign out,", text: "tap Approve hours." },
    { lead: "Check each person's in and out times and hours.", text: "Anyone still signed in? Sign them out first - you can't approve while someone is still signed in." },
    { lead: "Tap Approve the day.", text: "If something changes later it says \"Changed since you approved\" - tap Approve again." },
  ],
};

const REQUESTS: HowToSection = {
  title: "Requests",
  steps: [
    { lead: "Make a request:", text: "labour, trucks, hire, tools, materials - pick what, the site, how urgent (Low, High or Urgent) and when it's needed by. A photo helps. It goes straight to the office." },
    { lead: "My requests:", text: "see where they're up to. If the office asks a question, answer it there. When something is ready at the yard, tap Collected once you've picked it up." },
  ],
};

const HIRE_CHECK: HowToSection = {
  title: "Hire on my site",
  intro: "Shows when there's hire gear on your sites. For each item tap one:",
  steps: [
    { lead: "Still needed", text: "- it stays on hire." },
    { lead: "Finished", text: "- asks the office to call it off. Add a note, e.g. ready for pick-up at the gate." },
    { lead: "Not on site", text: "- tells the office it isn't there." },
  ],
};

const RECEIPTS_BINS: HowToSection = {
  title: "Receipts, reimbursement and bins",
  steps: [
    { lead: "Add receipt:", text: "tip docket or fuel - a photo of the whole docket when you get it." },
    { lead: "My receipts:", text: "what you sent today." },
    { lead: "Reimbursement:", text: "only when you paid with your own money. Photo of the receipt. Accounts pay you back." },
    { lead: "Bins:", text: "Delivered (photo, job, Client's bin or Our bin, size, what's going in it) or Picked up (pick the bin, take a photo)." },
  ],
};

const TOOLS: HowToSection = {
  title: "Tools (if you have a toolbox)",
  steps: [
    { lead: "Add a tool:", text: "photo of the rating plate and the whole tool - the details are read for you. Check them, then Add to inventory." },
    { lead: "Check my toolbox:", text: "lay the tools out, labels up, and take 1 to 4 photos." },
    { lead: "Report a fault:", text: "pick the tool, say what's wrong, add a photo." },
  ],
};

const REMINDERS: HowToSection = {
  title: "Reminders on your phone",
  intro: "Turn on reminders at the top of your link: an alert 20 minutes before the shift finishes if anyone is still signed in, and at 7pm if a job has no daily log or before/after photos.",
};

export const SUPERVISOR_GUIDE: HowToGuide = {
  id: "supervisor",
  title: "How to use - supervisors",
  sub: "Crew sign-in, hours, the daily log, requests, hire, receipts and bins",
  rule: "Save this link on your home screen and don't share it - it's yours. Questions from the office show at the top - answer them there.",
  sections: [SIGN_IN_CREW, POSTER_CONFIRM, HAND_OVER, APPROVE_HOURS, DAILY_LOG, REQUESTS, HIRE_CHECK, RECEIPTS_BINS, MESSAGES, TOOLS, REMINDERS,
    { title: "If something goes wrong", steps: [
      { lead: "A wrong time, a missed sign-out or the wrong person?", text: "Only the office can fix a time - tell them." },
      { lead: "Link not working?", text: "Ask the office for a new one." },
      { lead: "Anything else:", text: "call the office." },
    ] },
  ],
};

export const HANDOVER_GUIDE: HowToGuide = {
  id: "handover",
  title: "How to use - running sign-in today",
  sub: "This link only works today",
  rule: "You're running sign-in for this job today. The link stops working tonight - don't share it.",
  sections: [SIGN_IN_CREW, POSTER_CONFIRM, DAILY_LOG, REQUESTS, HIRE_CHECK,
    { title: "If something goes wrong", steps: [
      { lead: "A wrong time or a missed sign-out?", text: "Only the office can fix a time - tell them or the supervisor." },
      { lead: "Anything else:", text: "call the office." },
    ] },
  ],
};

// --- the QR sign-in screen ------------------------------------------------------------------------------------------

export const SIGNIN_GUIDE: HowToGuide = {
  id: "signin",
  title: "How signing in works",
  sub: "Scan, tap, done",
  rule: GOLDEN_RULE,
  sections: [
    {
      title: "Signing in",
      numbered: true,
      steps: [
        { lead: "Scan the QR", text: "with your phone camera - the supervisor's QR on site, the site poster, the Yard or Office QR, or the truck's QR." },
        { lead: "The first time, pick your name.", text: "From a hire company or a subcontractor? Tap \"I'm from a hire company / subcontractor\" and give your name and company. After that it's one tap." },
        { lead: "Tap Sign in.", text: "Moving somewhere new? Scan the next QR and tap Sign in - the last one closes by itself." },
        { lead: "Finished for the day?", text: "Scan and tap Sign out - once, at the very end." },
      ],
      after: "Signed in from the site poster? Your supervisor confirms it.",
    },
    TRUCK_CHECKS,
    REGIONAL,
    MESSAGES,
    SOMETHING_WRONG,
  ],
};

/** Which guide a site link gets: DRIVER, SUPERVISOR and HANDOVER only - never POSTER or OFFICE (or the yard's link). */
export function guideForLink(kind: string, shared = false): HowToGuide | null {
  if (shared) return null;
  if (kind === "DRIVER") return DRIVER_GUIDE;
  if (kind === "SUPERVISOR") return SUPERVISOR_GUIDE;
  if (kind === "HANDOVER") return HANDOVER_GUIDE;
  return null;
}

/** All the words of a guide, as one string - for the money check and the tests. */
export function guideText(g: HowToGuide): string {
  const parts = [g.title, g.sub, g.rule ?? ""];
  for (const s of g.sections) {
    parts.push(s.title, s.intro ?? "", s.after ?? "");
    for (const st of s.steps ?? []) parts.push(st.lead ?? "", st.text ?? "");
  }
  return parts.filter(Boolean).join("\n");
}

export const ALL_GUIDES: HowToGuide[] = [DRIVER_GUIDE, SUPERVISOR_GUIDE, HANDOVER_GUIDE, SIGNIN_GUIDE];
