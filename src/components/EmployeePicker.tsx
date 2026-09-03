"use client";

/**
 * Choosing people, everywhere people are chosen.
 *
 * Every screen that picks employees was growing its own list — one with
 * search, one without, one alphabetised, one in whatever order the store
 * happened to hold. That is a small inconsistency with a real cost: the
 * skill you build assigning a shift does not transfer to assigning a
 * project, and the list you trust in one place is missing a name in
 * another for reasons you cannot see.
 *
 * So there is one list. Search covers the three things anyone actually
 * knows about a person — what they are called, their code, what they do —
 * and the A–Z rail jumps rather than filters, so a selection already made
 * stays visible while you go looking for the next person.
 *
 * `mode` is the only real variation. Multi-select is a set you build and
 * confirm; single-select acts immediately, because there is nothing to
 * confirm about one tap.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { User } from "@/lib/types";
import { Avatar } from "./ui";
import { ISearch } from "./WfIcons";

/** The rail, plus a bucket for names that do not start with a letter. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

export function EmployeePicker({
  people,
  selected,
  onToggle,
  mode = "multi",
  /**
   * Grow to fill the container instead of capping at a height.
   *
   * A fixed cap inside a taller sheet leaves dead space under the list and
   * makes the sheet scroll as well — two scrollers for one gesture. Filling
   * gives the list every pixel there is and leaves exactly one.
   */
  fill = false,
  maxHeight = "18rem",
  emptyLabel = "Nobody matches",
  secondary,
  action,
}: {
  people: User[];
  /** Ids currently ticked. Ignored in single mode. */
  selected?: Set<string>;
  onToggle: (user: User) => void;
  mode?: "multi" | "single";
  fill?: boolean;
  maxHeight?: string;
  emptyLabel?: string;
  /** Second line under the name; defaults to designation · code. */
  secondary?: (u: User) => React.ReactNode;
  /** Trailing control in single mode — a button, usually. */
  action?: (u: User) => React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () => [...people].sort((a, b) => a.name.localeCompare(b.name)),
    [people],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((u) =>
      [u.name, u.employeeCode, u.designation, u.department]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q)),
    );
  }, [sorted, query]);

  /** Grouped by first letter, in order — the shape the rail indexes into. */
  const sections = useMemo(() => {
    const map = new Map<string, User[]>();
    for (const u of matches) {
      const c = (u.name.trim()[0] ?? "#").toUpperCase();
      const letter = /[A-Z]/.test(c) ? c : "#";
      const list = map.get(letter);
      if (list) list.push(u);
      else map.set(letter, [u]);
    }
    return [...map.entries()];
  }, [matches]);

  const present = useMemo(() => new Set(sections.map(([l]) => l)), [sections]);

  /**
   * Scroll a letter's group to the top of the list. Offsets within the
   * scroller rather than `scrollIntoView`, which would also scroll the
   * sheet around it and the page behind that.
   */
  const jumpTo = useCallback((letter: string) => {
    const box = listRef.current;
    const target = box?.querySelector<HTMLElement>(`[data-letter="${letter}"]`);
    if (box && target) box.scrollTop = target.offsetTop;
  }, []);

  return (
    <div className={`flex min-h-0 flex-col gap-3 ${fill ? "flex-1" : ""}`}>
      <div className="relative">
        <ISearch
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--wf-faint)]"
        />
        <input
          className="wf-input wf-input-search"
          placeholder="Search name, code, trade…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className={`flex gap-1 ${fill ? "min-h-0 flex-1" : ""}`}>
        {/* The rail is as tall as the list, never taller. Twenty-seven
            fixed-height letters overflowed a short list and ran on behind
            the CTA; letting them share the height means the rail always
            ends where the list does. */}
        <div
          aria-hidden
          className="flex w-5 min-h-0 shrink-0 flex-col items-center justify-between overflow-hidden py-1"
        >
          {ALPHABET.map((letter) => {
            const has = present.has(letter);
            return (
              <button
                key={letter}
                type="button"
                tabIndex={-1}
                disabled={!has}
                onClick={() => jumpTo(letter)}
                className={`w-full min-h-0 flex-1 rounded text-[0.56rem] font-bold leading-none ${
                  has
                    ? "cursor-pointer text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
                    : "text-[var(--wf-line-strong)]"
                }`}
              >
                {letter}
              </button>
            );
          })}
        </div>

        <div
          ref={listRef}
          data-sheet-scroll
          className="min-w-0 flex-1 overflow-y-auto"
          style={fill ? undefined : { maxHeight }}
        >
          {sections.length === 0 ? (
            <p className="px-1.5 py-6 text-center text-[0.82rem] text-[var(--wf-muted)]">
              {query ? `${emptyLabel} “${query}”.` : `${emptyLabel}.`}
            </p>
          ) : (
            sections.map(([letter, group]) => (
              <div key={letter} data-letter={letter}>
                <p className="sticky top-0 z-10 bg-[var(--wf-surface)] px-1.5 py-1 text-[0.68rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                  {letter}
                </p>
                {group.map((u) =>
                  mode === "single" ? (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 rounded-xl px-1.5 py-2"
                    >
                      <Avatar name={u.name} hue={u.avatarHue} photo={u.photo} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.88rem] font-semibold">
                          {u.name}
                        </span>
                        <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                          {secondary ? secondary(u) : `${u.designation} · ${u.employeeCode}`}
                        </span>
                      </span>
                      {action ? action(u) : null}
                    </div>
                  ) : (
                    <button
                      key={u.id}
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-1.5 py-2 text-left hover:bg-[var(--wf-fill-3)]"
                      aria-pressed={selected?.has(u.id) ?? false}
                      onClick={() => onToggle(u)}
                    >
                      <Avatar name={u.name} hue={u.avatarHue} photo={u.photo} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.86rem] font-semibold">
                          {u.name}
                        </span>
                        <span className="block truncate text-[0.7rem] text-[var(--wf-muted)]">
                          {secondary ? secondary(u) : `${u.designation} · ${u.employeeCode}`}
                        </span>
                      </span>
                      <span
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[0.7rem] font-bold"
                        style={{
                          background: selected?.has(u.id)
                            ? "var(--wf-amber)"
                            : "transparent",
                          color: selected?.has(u.id)
                            ? "var(--wf-on-amber)"
                            : "transparent",
                          borderColor: "var(--wf-line-strong)",
                        }}
                      >
                        ✓
                      </span>
                    </button>
                  ),
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
