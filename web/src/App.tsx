/** App shell: header, tab navigation, and the one place the whole app can fail.
 *
 * The airline lookup loads once here and is passed down, so the itinerary query
 * never has to join out to an Airline node on every leg of a path.
 */
import { useEffect, useMemo, useState } from "react";
import { Globe2, Route, Users } from "lucide-react";
import { api } from "./api";
import { ErrorState, Skeleton, useAsync } from "./ui";
import Itineraries from "./views/Itineraries";
import Alliances from "./views/Alliances";
import Explorer from "./views/Explorer";

const TABS = [
  {
    id: "itineraries",
    label: "Itineraries",
    icon: Route,
    blurb: "Find every way the network connects two airports.",
  },
  {
    id: "alliances",
    label: "Alliances",
    icon: Users,
    blurb: "Compare what each alliance can offer on the same city pair.",
  },
  {
    id: "explorer",
    label: "Airports",
    icon: Globe2,
    blurb: "Direct destinations, country reach, and the busiest hubs.",
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTab = (value: string): value is TabId => TABS.some((t) => t.id === value);

/** Tab state lives in the URL hash so every view is linkable and the back button
 *  works. Cheaper than a router for three tabs, and it survives a refresh. */
function useHashTab() {
  const read = (): TabId => {
    const raw = window.location.hash.replace(/^#/, "");
    return isTab(raw) ? raw : "itineraries";
  };
  const [tab, setTab] = useState<TabId>(read);

  useEffect(() => {
    const sync = () => setTab(read());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return [tab, (next: TabId) => { window.location.hash = next; }] as const;
}

export default function App() {
  const [tab, setTab] = useHashTab();
  const airlines = useAsync(() => api.airlines(), []);
  const stats = useAsync(() => api.stats(), []);

  const airlineMap = useMemo(
    () => new Map((airlines.data ?? []).map((a) => [a.icao, a])),
    [airlines.data],
  );

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <div>
            <h1 className="font-display text-xl font-bold tracking-wide text-ink">
              SKY<span className="text-brand-bright">ROUTE</span>
            </h1>
            <p className="text-[11px] text-ink-faint">The live route network as a graph</p>
          </div>

          <nav aria-label="Main" className="order-3 w-full sm:order-none sm:w-auto">
            <ul className="flex gap-1 overflow-x-auto">
              {TABS.map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  {/* A real anchor, so these are linkable, middle-clickable and
                      reachable by keyboard without any extra handling. */}
                  <a
                    href={`#${id}`}
                    onClick={() => setTab(id)}
                    aria-current={tab === id ? "page" : undefined}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-200 ${
                      tab === id
                        ? "bg-brand/15 text-brand-bright"
                        : "text-ink-dim hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {stats.data && (
            <p className="ml-auto hidden font-mono text-[11px] text-ink-faint tnum md:block">
              {stats.data.nodeTotal.toLocaleString()} nodes &middot;{" "}
              {stats.data.relationshipTotal.toLocaleString()} relationships
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        <p className="mb-4 text-sm text-ink-dim">{active.blurb}</p>

        {airlines.loading && <Skeleton rows={6} />}
        {airlines.error && (
          <div className="rounded-xl border border-line bg-surface/80">
            <ErrorState error={airlines.error} onRetry={airlines.reload} />
          </div>
        )}
        {airlines.data && airlines.data.length > 0 && (
          <>
            {tab === "itineraries" && <Itineraries airlines={airlineMap} />}
            {tab === "alliances" && <Alliances airlines={airlineMap} />}
            {tab === "explorer" && <Explorer />}
          </>
        )}
        {airlines.data && airlines.data.length === 0 && (
          <div className="rounded-xl border border-line bg-surface/80 px-6 py-16 text-center">
            <p className="font-display text-base font-semibold tracking-wide text-ink uppercase">
              The graph is empty
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-dim">
              The database is reachable but has nothing in it. Collect a route
              snapshot and load it:
            </p>
            <code className="mt-3 inline-block rounded bg-surface-2 px-3 py-1.5 font-mono text-xs text-brand-bright">
              python -m seed.collect &amp;&amp; python -m seed.load
            </code>
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-7xl px-4 py-8 text-xs leading-relaxed text-ink-faint sm:px-6">
        Routes are observed via ADS-B rather than taken from a published schedule,
        so coverage follows receiver density and this is not a complete picture of
        any airline&rsquo;s network. Airports from OurAirports; alliance membership
        from the alliances&rsquo; own published member lists.
      </footer>
    </div>
  );
}
