/**
 * Is this enough of an address to send to?
 *
 * One definition, used by the sign-in screen, onboarding and the crew
 * invites, because three subtly different rules is how a form comes to
 * accept something the next screen rejects.
 *
 * Deliberately loose. The only authority on whether an address works is
 * whether mail arrives at it, so this catches what a person can see is
 * wrong — no @, nothing after it, no dot in the domain — and leaves the rest
 * to the send. Refusing a valid-but-unusual address is the worse mistake:
 * the person is locked out of their own company by a regular expression.
 */
export function isUsableEmail(raw: string | undefined | null): boolean {
  const value = (raw ?? "").trim();
  if (value.length < 5 || /\s/.test(value)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(value);
}

/**
 * What to say when it is not.
 *
 * Named for what the person can do about it. "Invalid email" tells somebody
 * staring at their own address that the machine disagrees, and nothing else.
 */
export function emailProblem(raw: string | undefined | null): string | null {
  const value = (raw ?? "").trim();
  if (value === "") return null; // nothing typed yet is not an error
  if (isUsableEmail(value)) return null;
  if (/\s/.test(value)) return "An email address can't contain spaces.";
  if (!value.includes("@")) return "That's missing the @ — try name@company.com.";
  const [, domain = ""] = value.split("@");
  if (domain === "") return "Add the part after the @ — try name@company.com.";
  if (!domain.includes(".")) return "The part after the @ needs a dot — try name@company.com.";
  return "That doesn't look like an email address — try name@company.com.";
}
