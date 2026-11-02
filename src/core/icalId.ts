// The shared escaping table for calendar-entry addresses (idea.md):
// whitespace, quotes, angle brackets and `%` itself so the encoding is
// injective. Everything else passes verbatim. MUST stay byte-identical
// with the Dart implementation (deedsats-wallet knowstr_core ical_id.dart).
const ICAL_UNSAFE_RE = /[\s"'<>%]/u;

function escapeIcalPart(value: string): string {
  if (!ICAL_UNSAFE_RE.test(value)) {
    return value;
  }
  const encoder = new TextEncoder();
  return [...value]
    .map((char) => {
      if (!ICAL_UNSAFE_RE.test(char)) {
        return char;
      }
      return [...encoder.encode(char)]
        .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
        .join("");
    })
    .join("");
}

// The deterministic fragment of a calendar entry's address
// `<calendar address>#<UID>`, recurring occurrences
// `<UID>@<RECURRENCE-ID>`. Addresses are opaque — both sides derive them
// from feed data and nobody parses them back.
export function icalEntryId(uid: string, recurrenceId?: string): string {
  if (uid === "") {
    throw new Error("icalEntryId: uid must not be empty");
  }
  const suffix =
    recurrenceId !== undefined ? `@${escapeIcalPart(recurrenceId)}` : "";
  return `${escapeIcalPart(uid)}${suffix}`;
}
