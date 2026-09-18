/**
 * What it means for a row to match what somebody typed.
 *
 * Fourteen screens filter a list by a text box and they had settled on two
 * different answers. Some joined the fields into one string and asked whether it
 * contained the query; others tested each field separately and asked whether any
 * one of them did. That difference is invisible until you type two words:
 * "ravi chennai" finds Ravi on the Chennai Metro project under the first rule
 * and nothing at all under the second, because no single field holds both.
 *
 * This is a third answer, and it is better than either. Every whitespace-
 * separated word in the query has to appear somewhere among the fields — so two
 * words still work, they work in either order, and they work across fields. It
 * is what a person means when they narrow a list by typing more.
 *
 *     matches(q, u.name, u.employeeCode, u.designation)
 *
 * An empty query matches everything, so a caller can pass the box's value
 * straight in without guarding first.
 */

/** One row's worth of searchable values. Nulls and numbers are fine. */
type Field = string | number | null | undefined;

export function matches(query: string, ...fields: Field[]): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  // Joined once per row rather than per token: the haystack does not change
  // between tokens, and these lists run to hundreds of rows on a phone.
  const hay = fields
    .filter((f) => f !== null && f !== undefined)
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

/**
 * The same question for a list, when the caller has a builder rather than a row.
 *
 * Useful where the searchable text is assembled from several objects — an
 * attendance row that reaches through to its user and its project, say.
 */
export function filterBy<T>(
  rows: readonly T[],
  query: string,
  fieldsOf: (row: T) => Field[],
): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...rows];
  return rows.filter((row) => {
    const hay = fieldsOf(row)
      .filter((f) => f !== null && f !== undefined)
      .join(" ")
      .toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}
