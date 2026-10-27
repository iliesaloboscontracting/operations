// What the chat tells people, always (security review CH-022 / CH-025, Ilies approved 27 Oct 2026). Words only, no
// imports - used by the Messages page and the conversation, and tested in rules.test.ts.

// CH-025: nobody should think a chat is private from the owner, or that delete erases the record.
export const CHAT_NOTICE = "Iliesa can read all conversations. Edits and deleted messages are kept.";
// CH-022: the invoice-fraud route - a "please change our bank details" message is never acted on.
export const BANK_NOTICE = "Bank detail changes are never taken from chat. Tax file numbers and bank details stay in Xero.";
export const DELETE_CONFIRM = 'Delete this message? Everyone will see "message deleted". The text is kept on record and Iliesa can still read it.';
