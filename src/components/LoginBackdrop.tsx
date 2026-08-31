"use client";

/**
 * The sign-in screen's moving background.
 *
 * Mounted only on the entry route — the one screen where atmosphere is
 * worth the bytes. Everywhere past the door the product is a tool, and a
 * tool does not play a film behind a payroll table.
 *
 * Two details carry the whole thing:
 *
 *  - The veil is the theme's own background at partial strength, not a
 *    black overlay. In dark mode it darkens the film; in light mode it
 *    whitens it. Either way the form text keeps the contrast it was
 *    designed with, without this component knowing which theme is active.
 *  - Under prefers-reduced-motion the video never renders. A worker who
 *    has switched motion off gets the still theme background, not a
 *    paused frame of someone else's choice.
 *
 * The host <main> must be `relative isolate`: `isolate` gives the -z-10
 * layer a stacking context to sink inside, so the film sits above the
 * page background but below every child of the screen. Without it the
 * negative z-index drops the video behind the body background entirely
 * and it simply never appears.
 */

export function LoginBackdrop() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden">
      <video
        className="h-full w-full object-cover motion-reduce:hidden"
        src="/login-bg.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        tabIndex={-1}
      />
      {/* Theme-coloured veil, thickening toward the form. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom," +
            " color-mix(in srgb, var(--wf-bg) 55%, transparent) 0%," +
            " color-mix(in srgb, var(--wf-bg) 72%, transparent) 55%," +
            " color-mix(in srgb, var(--wf-bg) 92%, transparent) 100%)",
        }}
      />
    </div>
  );
}
