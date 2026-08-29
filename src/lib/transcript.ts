/**
 * Turning a spoken note into something a manager can skim.
 *
 * This is extractive, not generative: it selects sentences the worker
 * actually said and files them under the headings the site diary already
 * uses. Nothing is invented, nothing is paraphrased. That is a deliberate
 * limit — a summary of a safety report is the wrong place for a model to
 * be creative, and it also means the whole thing runs offline in a few
 * milliseconds on a cheap phone.
 *
 * The keyword tables are English, tuned to Indian site vocabulary. Android
 * transcribes Tamil and Hindi in their own scripts, which these tables
 * cannot read, so for those the summary falls back to the opening lines and
 * the headings are simply not claimed. Saying less is better than filing a
 * sentence under "Safety" because it happened to be first.
 */

export interface TranscriptPoint {
  label: string;
  text: string;
}

export interface TranscriptSummary {
  /** A two-or-three sentence gist, in the order it was said. */
  gist: string;
  /** Sentences filed under a site-diary heading. Empty for non-Latin text. */
  points: TranscriptPoint[];
  words: number;
  /** False when the transcript is in a script the keyword tables can't read. */
  structured: boolean;
}

/** Heading → the words that put a sentence under it. Order is priority. */
const ACTIONABLE = new Set(["Safety", "Blockers", "Tomorrow"]);

const CATEGORIES: Array<{ label: string; words: RegExp }> = [
  {
    label: "Safety",
    words:
      /\b(safety|accident|injur\w*|near miss|helmet|harness|barricade|toolbox talk|ppe|hazard|unsafe|first aid|fell|fall)\b/gi,
  },
  {
    label: "Blockers",
    words:
      /\b(waiting|blocked|blocker|delay|delayed|shortage|not\s+(?:\w+\s+){0,2}(?:received|delivered|available|come|working|ready)|pending|issue|problem|stopped|breakdown|servicing|no (?:power|water|material)|hold|stuck|short|(?:was|were|is|are)\s+down)\b/gi,
  },
  {
    label: "Completed",
    words:
      /\b(complet\w*|finish\w*|done|poured|cast|tested|closed|handed over|signed off|fixed|installed|erected)\b/gi,
  },
  {
    label: "In progress",
    words:
      /\b(in progress|ongoing|continu\w*|started|starting|working on|going on|half|partial\w*|\d+\s*(%|percent))\b/gi,
  },
  {
    label: "Materials",
    words:
      /\b(cement|steel|rod|rods|bar|bars|sand|concrete|brick|bags?|tons?|kgs?|litres?|pipes?|valves?|cable|wire|tiles?|load|truck|delivery|material)\b/gi,
  },
  {
    label: "Tomorrow",
    words:
      /\b(tomorrow|next (?:day|shift|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|will start|will begin|plan to|planning to|scheduled for)\b/gi,
  },
];

/** Words that carry no signal, so they don't inflate a sentence's score. */
const NUMBER_LIKE = /\b\d+(\.\d+)?\s*(%|percent|mm|cm|m|metre|meter|kg|ton|tonne|bag|nos|no)?\b/i;

function hasLatin(text: string): boolean {
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return latin > text.replace(/\s/g, "").length * 0.4;
}

/**
 * Split into sentences. Dictation rarely produces punctuation, so a run of
 * words with no full stop is broken on conjunctions instead of being
 * treated as one enormous sentence.
 */
function sentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  return clean
    .split(/(?<=[.!?।])\s+/)
    .flatMap(splitOnMarkers)
    .map((s) => s.trim().replace(/^[,;]\s*/, ""))
    .filter((s) => s.split(/\s+/).length >= 3);
}

/**
 * A spoken paragraph is several statements wearing one coat. Split before
 * the words people use to change subject, keeping the marker with the
 * clause it introduces — "tomorrow" belongs to what comes after it, and a
 * Tomorrow heading is unreadable without it.
 */
const MARKERS = new RegExp(
  "\\s+(?=(?:" +
    [
      // discourse markers
      "and then", "after that", "then", "also", "but", "however",
      "tomorrow", "next day", "next shift",
      // a new clause usually opens with its subject, and dictated site
      // speech is almost entirely first person plural
      "we (?:are|were|have|had|did|will|need|require|started|completed|finished|stopped|lost|plan|gave|found)",
      "they (?:are|were|have|had|will)",
      "there (?:was|were|is|are)",
      "it (?:was|is)",
      "no (?:injury|issues|problem)",
      // "the crane was down", "the consultant signed off"
      "the \\w+ (?:was|were|is|are|has|have)",
    ].join("|") +
    ")\\b)",
  "i",
);

function splitOnMarkers(s: string): string[] {
  if (s.split(/\s+/).length <= 10) return [s];
  const out: string[] = [];
  let carry = "";
  for (const part of s.split(new RegExp(MARKERS.source, "gi"))) {
    const t = part.trim();
    if (!t) continue;
    /* A bare "tomorrow" or "also" is the opening of the next statement, not
       the tail of the last one — carry it forward. Getting this backwards
       ends a Safety line with the word "tomorrow" and loses the plan. */
    if (t.split(/\s+/).length < 3) {
      carry = carry ? carry + " " + t : t;
      continue;
    }
    out.push(carry ? carry + " " + t : t);
    carry = "";
  }
  if (carry) {
    if (out.length) out[out.length - 1] += " " + carry;
    else out.push(carry);
  }
  return out;
}

/** How strongly a sentence speaks to one heading. */
function hits(sentence: string, re: RegExp): number {
  re.lastIndex = 0;
  return (sentence.match(re) ?? []).length;
}

function score(sentence: string, index: number, total: number): number {
  let n = 0;
  for (const c of CATEGORIES) n += 3 * Math.min(hits(sentence, c.words), 2);
  if (NUMBER_LIKE.test(sentence)) n += 2;
  const words = sentence.split(/\s+/).length;
  // Sentence-length sweet spot: long enough to say something, short enough to read.
  if (words >= 6 && words <= 24) n += 2;
  if (index === 0) n += 1;
  if (index === total - 1) n += 1;
  return n;
}

function tidy(s: string): string {
  const t = s.trim().replace(/[,;]+$/, "");
  const cased = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?।]$/.test(cased) ? cased : cased + ".";
}

export function summariseTranscript(text: string): TranscriptSummary {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const parts = sentences(text);
  if (parts.length === 0) {
    return { gist: "", points: [], words, structured: false };
  }

  const structured = hasLatin(text);

  /* The gist: the highest-scoring few sentences, put back in spoken order
     so the note still reads as a sequence of events. */
  const ranked = parts
    .map((s, i) => ({ s, i, v: structured ? score(s, i, parts.length) : parts.length - i }))
    .sort((a, b) => b.v - a.v || a.i - b.i);

  const keep: typeof ranked = [];
  let budget = 240;
  for (const r of ranked) {
    if (keep.length >= 3 || budget <= 0) break;
    if (r.s.length > budget && keep.length > 0) continue;
    keep.push(r);
    budget -= r.s.length + 1;
  }
  const gist = keep
    .sort((a, b) => a.i - b.i)
    .map((r) => tidy(r.s))
    .join(" ");

  if (!structured) return { gist, points: [], words, structured };

  /* Each sentence goes to the heading it speaks to most strongly, rather
     than each heading grabbing the best sentence it can find. The two give
     very different answers on a note like "one labour injured his hand,
     work stopped in that area" — which is a Safety line, not a Blocker. */
  const filed = new Map<string, string[]>();
  parts.forEach((sentence, i) => {
    /* "waiting for the gate valves" mentions two valves and one delay.
       Counting alone files it under Materials; it is a Blocker. */
    const ranked = CATEGORIES.map((c) => ({
      label: c.label,
      n: hits(sentence, c.words) * (ACTIONABLE.has(c.label) ? 2 : 1),
    }))
      .filter((c) => c.n > 0)
      .sort((a, b) => b.n - a.n);

    /* Falling through to the next-best heading matters: without it, a
       sentence whose best heading is already full is dropped from the
       summary altogether, and a stated plan for tomorrow just disappears. */
    for (const { label } of ranked) {
      const list = filed.get(label) ?? [];
      // Two lines per heading is a summary; five is the transcript again.
      if (list.length >= 2) continue;
      list.push(tidy(parts[i]));
      filed.set(label, list);
      return;
    }
  });

  const points: TranscriptPoint[] = CATEGORIES.filter((c) => filed.has(c.label)).map((c) => ({
    label: c.label,
    text: filed.get(c.label)!.join(" "),
  }));

  return { gist, points, words, structured };
}
