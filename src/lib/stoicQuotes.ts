// A small bank of short, well-known (public domain) Stoic lines for the day sheet's
// "quote of the day". Picked deterministically from the date, so regenerating the
// sheet later the same day gives the same quote.
export const STOIC_QUOTES: { quote: string; author: string; source: string }[] = [
  { quote: "You have power over your mind - not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius", source: "Meditations" },
  { quote: "Luck is what happens when preparation meets opportunity.", author: "Seneca", source: "Letters from a Stoic" },
  { quote: "It's not what happens to you, but how you react to it that matters.", author: "Epictetus", source: "Discourses" },
  { quote: "Waste no more time arguing about what a good man should be. Be one.", author: "Marcus Aurelius", source: "Meditations" },
  { quote: "He who fears death will never do anything worthy of a man who is alive.", author: "Seneca", source: "Letters from a Stoic" },
  { quote: "First say to yourself what you would be; and then do what you have to do.", author: "Epictetus", source: "Discourses" },
  { quote: "The impediment to action advances action. What stands in the way becomes the way.", author: "Marcus Aurelius", source: "Meditations" },
  { quote: "We suffer more often in imagination than in reality.", author: "Seneca", source: "Letters from a Stoic" },
  { quote: "No man is free who is not master of himself.", author: "Epictetus", source: "Discourses" },
  { quote: "Confine yourself to the present.", author: "Marcus Aurelius", source: "Meditations" },
  { quote: "Difficulties strengthen the mind, as labor does the body.", author: "Seneca", source: "Letters from a Stoic" },
  { quote: "Circumstances don't make the man, they only reveal him to himself.", author: "Epictetus", source: "Discourses" },
  { quote: "How much trouble he avoids who does not look to see what his neighbor says or does.", author: "Marcus Aurelius", source: "Meditations" },
  { quote: "Every new beginning comes from some other beginning's end.", author: "Seneca", source: "Letters from a Stoic" },
  { quote: "Only the educated are free.", author: "Epictetus", source: "Discourses" },
  { quote: "The best revenge is to be unlike him who performed the injury.", author: "Marcus Aurelius", source: "Meditations" },
];

export function quoteOfDay(dateISO: string) {
  let h = 0;
  for (let i = 0; i < dateISO.length; i++) h = (h * 31 + dateISO.charCodeAt(i)) >>> 0;
  return STOIC_QUOTES[h % STOIC_QUOTES.length];
}
