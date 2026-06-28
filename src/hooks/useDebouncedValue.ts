import { useState, useEffect } from "react";

/**
 * Returns a value that lags behind `value` by `delay` ms. Each new `value`
 * resets the timer, so during continuous typing the returned value is stable
 * and only commits to the latest input once the user pauses. Used to keep the
 * heavy markdown preview off the typing critical path without leaving the
 * preview "stuck" the way useDeferredValue can under starvation.
 *
 * Implementation notes:
 *  - All deps the effect reads are listed (`value`, `delay`). No stale-closure
 *    surprises and no eslint-disable, so React's strict-mode dev checks don't
 *    flag this as a "Maximum update depth exceeded" candidate.
 *  - When `value` is already equal to `debounced`, scheduling a setTimeout
 *    that calls setDebounced with the same value is harmless: React bails out
 *    of the re-render via Object.is on the new state. So we skip the explicit
 *    early-return; it isn't worth the extra dep.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
