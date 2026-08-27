/** Shared primitives and the one async-state hook every view uses.
 *
 * Loading, empty and error are not afterthoughts here - `useAsync` plus `Async`
 * make it impossible to render a data slot without having decided what all four
 * states look like.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, ALLIANCE_CLASS, ALLIANCE_LABELS, type AllianceId } from "./api";

// --- async state -------------------------------------------------------------

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  // Guards against a slow first request overwriting a fast second one.
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const ticket = ++latest.current;
    setLoading(true);
    setError(null);
    fn()
      .then((result) => {
        if (ticket === latest.current) setData(result);
      })
      .catch((err) => {
        if (ticket !== latest.current) return;
        setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
        setData(null);
      })
      .finally(() => {
        if (ticket === latest.current) setLoading(false);
      });
    // fn is recreated each render by design; deps describe when it should re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

/** Read and write the query string carried in the URL hash.
 *
 * The hash already selects the tab, so a search lives beside it as
 * `#itineraries?from=MNL&to=LHR`. That makes a specific search shareable and
 * survivable across a refresh, without pulling in a router for three tabs.
 */
export function useHashParams(): [URLSearchParams, (next: Record<string, string | null>) => void] {
  const parse = () => new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const [params, setParams] = useState(parse);

  useEffect(() => {
    const sync = () => setParams(parse());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const update = useCallback((next: Record<string, string | null>) => {
    const [tab] = window.location.hash.replace(/^#/, "").split("?");
    const merged = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    const query = merged.toString();
    window.location.hash = query ? `${tab}?${query}` : tab;
  }, []);

  return [params, update];
}

/** Debounce a value so typing does not fire a query per keystroke against a
 *  0.5 vCPU instance. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

// --- layout ------------------------------------------------------------------

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card-flat ${className}`}>
      {title && (
        <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-rule bg-paper-2 px-4 py-2.5">
          <div>
            <h2 className="font-display text-xl leading-none text-ink">{title}</h2>
            {subtitle && <p className="mt-1.5 text-xs text-ink-dim">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** A small caps label of the kind printed above a field on a real ticket. */
export function Caption({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`block text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase ${className}`}
    >
      {children}
    </span>
  );
}

// --- states ------------------------------------------------------------------

/** Skeletons rather than a spinner: the shape of the answer arrives first. */
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse border-2 border-rule-soft bg-paper-2"
          style={{ opacity: 1 - i * 0.13 }}
        />
      ))}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="font-display text-2xl text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-dim">{body}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  // A 503 from this API means one specific thing, and saying so beats "something
  // went wrong" - the person reading it can actually fix a stopped instance.
  const dbDown = error.status === 503 || error.status === 0;
  return (
    <div role="alert" className="px-6 py-14 text-center">
      {/* Stamped like a rejected form, because that is what happened. */}
      <p className="stamp mx-auto inline-block px-3 py-1 text-sm text-air-red">
        {dbDown ? "No connection" : "Error"}
      </p>
      <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink">{error.message}</p>
      {error.hint && <p className="mx-auto mt-2 max-w-md text-xs text-ink-faint">{error.hint}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 cursor-pointer border-2 border-rule bg-paper px-4 py-2 text-sm font-semibold text-ink transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_var(--color-rule)]"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** Renders the right state for an async slot so no view forgets one. */
export function Async<T>({
  state,
  empty,
  isEmpty,
  skeletonRows,
  children,
}: {
  state: AsyncState<T>;
  empty: ReactNode;
  isEmpty?: (data: T) => boolean;
  skeletonRows?: number;
  children: (data: T) => ReactNode;
}) {
  if (state.loading) return <Skeleton rows={skeletonRows} />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (!state.data) return <>{empty}</>;
  if (isEmpty?.(state.data)) return <>{empty}</>;
  return <>{children(state.data)}</>;
}

// --- data bits ---------------------------------------------------------------

/** Alliance as a rubber stamp: colour plus the name, never colour alone. */
export function AllianceChip({ alliance, size = "sm" }: { alliance: AllianceId; size?: "sm" | "xs" }) {
  return (
    <span
      className={`stamp inline-block whitespace-nowrap ${ALLIANCE_CLASS[alliance]} ${
        size === "xs" ? "px-1 py-px text-[9px]" : "px-1.5 py-0.5 text-[10px]"
      }`}
    >
      {ALLIANCE_LABELS[alliance]}
    </span>
  );
}

/** A collapsed help note.
 *
 * Built on native <details> so it is keyboard accessible and needs no state. It
 * exists because the explanation it holds used to sit permanently on the page,
 * where it read as filler and leaned on internal vocabulary. Help should be
 * available on demand, not narrated at everyone.
 */
export function HelpNote({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group border-t-2 border-rule-soft pt-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-ink-dim hover:text-ink">
        <span
          aria-hidden="true"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-current text-[10px] leading-none"
        >
          ?
        </span>
        {label}
        <span aria-hidden="true" className="ml-auto text-ink-faint group-open:hidden">
          Show
        </span>
        <span aria-hidden="true" className="ml-auto hidden text-ink-faint group-open:inline">
          Hide
        </span>
      </summary>
      <div className="mt-2 space-y-2 text-xs leading-relaxed text-ink-dim">{children}</div>
    </details>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <Caption className="mb-1">{label}</Caption>
      {children}
    </label>
  );
}

export const selectClass =
  "min-h-11 w-full cursor-pointer appearance-none border-2 border-rule bg-paper px-3 py-2.5 text-sm font-medium text-ink transition-colors duration-150 hover:bg-paper-2 focus:bg-paper-2";

export const inputClass =
  "min-h-11 w-full border-2 border-rule bg-paper px-3 py-2.5 font-mono text-sm text-ink transition-colors duration-150 placeholder:text-ink-faint focus:bg-paper-2";
