/** Shared primitives and the one async-state hook every view uses.
 *
 * Loading, empty and error are not afterthoughts here - `useAsync` plus `Async`
 * make it impossible to render a data slot without having decided what all four
 * states look like.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, DatabaseZap, RotateCw, SearchX } from "lucide-react";
import { ALLIANCE_CLASS, ALLIANCE_LABELS, ApiError, type AllianceId } from "./api";

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
    <section className={`rounded-xl border border-line bg-surface/80 ${className}`}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="font-display text-base font-semibold tracking-wide text-ink uppercase">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink-dim">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

// --- states ------------------------------------------------------------------

/** Skeletons rather than a spinner: the shape of the answer arrives before it does. */
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-lg bg-surface-2"
          style={{ opacity: 1 - i * 0.12 }}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  icon: Icon = SearchX,
}: {
  title: string;
  body: string;
  icon?: typeof SearchX;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <Icon className="h-8 w-8 text-ink-faint" aria-hidden="true" />
      <p className="font-display text-base font-semibold tracking-wide text-ink uppercase">
        {title}
      </p>
      <p className="max-w-sm text-sm leading-relaxed text-ink-dim">{body}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  // A 503 from this API means one specific thing, and saying so beats "something
  // went wrong" - the person reading it can actually fix a stopped instance.
  const dbDown = error.status === 503 || error.status === 0;
  const Icon = dbDown ? DatabaseZap : AlertTriangle;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <Icon className="h-8 w-8 text-star" aria-hidden="true" />
      <p className="font-display text-base font-semibold tracking-wide text-star uppercase">
        {dbDown ? "Graph unreachable" : "Something broke"}
      </p>
      <p className="max-w-md text-sm leading-relaxed text-ink-dim">{error.message}</p>
      {error.hint && <p className="max-w-md text-xs text-ink-faint">{error.hint}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line-bright bg-surface-2 px-4 py-2 text-sm font-medium text-ink transition-colors duration-200 hover:border-brand hover:text-brand-bright"
        >
          <RotateCw className="h-4 w-4" aria-hidden="true" />
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

/** Alliance, coloured by identity and always carrying its name as text. */
export function AllianceChip({ alliance, size = "sm" }: { alliance: AllianceId; size?: "sm" | "xs" }) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 font-medium tracking-wide whitespace-nowrap ${
        size === "xs" ? "text-[10px]" : "text-xs"
      } ${ALLIANCE_CLASS[alliance]}`}
    >
      {ALLIANCE_LABELS[alliance]}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-dim uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

export const selectClass =
  "w-full cursor-pointer rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink transition-colors duration-200 hover:border-line-bright focus:border-brand";

export const inputClass =
  "w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 font-mono text-sm text-ink transition-colors duration-200 placeholder:text-ink-faint hover:border-line-bright focus:border-brand";
