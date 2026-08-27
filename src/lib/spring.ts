"use client";

/**
 * The physics behind a gesture that feels like it obeys the world.
 *
 * A CSS transition cannot do this job. It interpolates from a start value
 * to an end value over a fixed duration, which means it cannot be grabbed
 * mid-flight, cannot inherit the speed your finger was already moving, and
 * cannot be redirected without a visible jump. Every one of those is
 * something a person does to a sheet without thinking about it.
 *
 * So: a spring, driven from rAF, that always animates from the *current*
 * on-screen value and accepts the velocity the gesture ended with.
 */

/**
 * Where a flick would come to rest.
 *
 * This is the exponential-decay form Apple ships in the Designing Fluid
 * Interfaces sample code — deliberately not the textbook `v²/(2a)`, which
 * decelerates too abruptly and makes a throw feel like it hit something.
 *
 * Snapping to the nearest boundary from the *release point* ignores the
 * throw entirely: a hard flick and a slow drag ending in the same place
 * would do the same thing, which is exactly the feeling of an interface
 * that is not listening.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Progressive resistance past a boundary.
 *
 * A hard stop reads as frozen — the user cannot tell a limit from a bug.
 * Resistance that grows the further you pull says "there is nothing more
 * here" while staying obviously alive.
 */
export function rubberband(
  overshoot: number,
  dimension: number,
  constant = 0.55,
): number {
  return (
    (overshoot * dimension * constant) /
    (dimension + constant * Math.abs(overshoot))
  );
}

export interface SpringOptions {
  /** Overshoot. 1 = critically damped (no bounce); ~0.8 bounces a little. */
  damping?: number;
  /** How quickly it reaches the target, in seconds. Not a duration. */
  response?: number;
  /** Where the gesture left off, in px/s. This is the seam that matters. */
  velocity?: number;
}

/**
 * Animate `from` to `to`, and keep animating until it settles.
 *
 * Returns a stop function. Call it and start another spring from the value
 * you were on to redirect mid-flight — which is what interruption is.
 *
 * Damping defaults to 1: no overshoot. Bounce is reserved for motion the
 * user's own gesture put momentum into. A menu that merely appeared and
 * then wobbles is the interface showing off; a card you flicked that
 * overshoots slightly is the card behaving like an object.
 */
export function spring(
  from: number,
  to: number,
  onFrame: (value: number) => void,
  { damping = 1, response = 0.4, velocity = 0 }: SpringOptions = {},
  onDone?: () => void,
): () => void {
  const stiffness = (2 * Math.PI / response) ** 2;
  const damper = (4 * Math.PI * damping) / response;

  let value = from;
  let v = velocity;
  let raf = 0;
  let last = 0;
  let stopped = false;

  const step = (now: number) => {
    if (stopped) return;
    // First frame has no delta; clamp the rest so a backgrounded tab does
    // not resume with one enormous step that teleports the sheet.
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;

    const a = -stiffness * (value - to) - damper * v;
    v += a * dt;
    value += v * dt;

    // Settled: close enough to the target and slow enough that another
    // frame would not move it a visible amount.
    if (Math.abs(value - to) < 0.1 && Math.abs(v) < 0.5) {
      onFrame(to);
      onDone?.();
      return;
    }
    onFrame(value);
    raf = requestAnimationFrame(step);
  };

  raf = requestAnimationFrame(step);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

/**
 * A short history of pointer positions, for the velocity at release.
 *
 * The last two events are not enough: a finger that pauses for one frame
 * before lifting would report ~0 velocity and the throw would be lost. A
 * window of recent samples survives that.
 */
export class VelocityTracker {
  private samples: Array<{ v: number; t: number }> = [];

  add(value: number, time = performance.now()) {
    this.samples.push({ v: value, t: time });
    if (this.samples.length > 6) this.samples.shift();
  }

  /** px per second over the last ~100ms of movement. */
  velocity(): number {
    const now = performance.now();
    const recent = this.samples.filter((s) => now - s.t < 120);
    if (recent.length < 2) return 0;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = (last.t - first.t) / 1000;
    return dt > 0 ? (last.v - first.v) / dt : 0;
  }

  reset() {
    this.samples = [];
  }
}

/** Motion is off — do the state change, skip the travel. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
