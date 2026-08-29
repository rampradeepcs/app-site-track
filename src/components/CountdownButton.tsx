"use client";

/**
 * An action that commits after a few seconds, and can be called off at any
 * point before then.
 *
 * Approving overtime is a decision about someone's pay. It is not
 * destructive enough to deserve a modal in front of every tap — a manager
 * clearing forty-four of these would answer forty-four dialogs — but it is
 * consequential enough that a mis-tap should not be final. So the button
 * arms instead of firing: a fill sweeps left to right, and until it lands
 * the whole thing is still recallable by tapping again.
 *
 * The window is the affordance. There is no separate "undo" toast to find
 * and no dialog to dismiss; the control that started it is the control that
 * stops it, and it is already under the thumb.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export function CountdownButton({
  label,
  armedLabel = "Tap to cancel",
  ms = 3000,
  onCommit,
  className = "",
  disabled,
  title,
}: {
  label: React.ReactNode;
  /** Shown while the countdown runs. Say how to stop it. */
  armedLabel?: string;
  ms?: number;
  onCommit: () => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [left, setLeft] = useState(Math.ceil(ms / 1000));
  const commitAt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (commitAt.current) clearTimeout(commitAt.current);
    if (ticker.current) clearInterval(ticker.current);
    commitAt.current = null;
    ticker.current = null;
  }, []);

  // A row can disappear the moment it commits, so the timers have to be
  // torn down on unmount or the callback fires into a dead component.
  useEffect(() => stop, [stop]);

  const start = () => {
    setArmed(true);
    setLeft(Math.ceil(ms / 1000));
    const started = Date.now();
    ticker.current = setInterval(() => {
      setLeft(Math.max(0, Math.ceil((ms - (Date.now() - started)) / 1000)));
    }, 250);
    commitAt.current = setTimeout(() => {
      stop();
      setArmed(false);
      onCommit();
    }, ms);
  };

  const cancel = () => {
    stop();
    setArmed(false);
  };

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      aria-live="polite"
      className={`wf-countdown ${className}`}
      data-armed={armed}
      onClick={armed ? cancel : start}
    >
      {armed ? (
        <span
          aria-hidden
          className="wf-countdown-fill"
          style={{ animationDuration: `${ms}ms` }}
        />
      ) : null}
      {/* The seconds are spelled out as well as drawn, so the state does not
          depend on noticing an animation. */}
      <span className="wf-countdown-label">
        {armed ? `${armedLabel} ${left}s` : label}
      </span>
    </button>
  );
}
