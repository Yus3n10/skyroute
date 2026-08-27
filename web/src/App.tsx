/** App shell: masthead, tab navigation, and the one place the whole app can fail.
 *
 * The airline lookup loads once here and is passed down, so the itinerary query
 * never has to join out to an Airline node on every leg of a path.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { Caption, ErrorState, Skeleton, useAsync } from "./ui";
import Itineraries from "./views/Itineraries";
import Alliances from "./views/Alliances";
import Explorer from "./views/Explorer";

const TABS = [
  {
    id: "itineraries",
    label: "Itineraries",
    blurb: "Every way the observed network connects two airports.",
  },
  {
    id: "alliances",
    label: "Alliances",
    blurb: "What each alliance can offer on the same city pair.",
  },
  {
    id: "explorer",
    label: "Airports",
    blurb: "Direct destinations, country reach, and the busiest hubs.",
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTab = (value: string): value is TabId => TABS.some((t) => t.id === value);

/** Tab state lives in the URL hash so every view is linkable and the back button
 *  works. Cheaper than a router for three tabs, and it survives a refresh. */
function useHashTab() {
  const read = (): TabId => {
    // The hash may carry a query string too (`#itineraries?from=MNL`), so the tab
    // is only the part before the `?`.
    const raw = window.location.hash.replace(/^#/, "").split("?")[0];
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
      {/* The par-avion stripe, the way it runs along the edge of an airmail
          envelope. Decorative only, so it is hidden from assistive tech. */}
      <div className="airmail-stripe h-2" aria-hidden="true" />

      <header className="border-b-2 border-rule bg-paper">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-5 pb-3">
            <div>
              <h1 className="font-display text-4xl leading-none text-ink sm:text-5xl">
                SkyRoute
              </h1>
              <p className="mt-1.5 max-w-md text-sm text-ink-dim">
                The world&rsquo;s airline network, as it was actually flying.
              </p>
            </div>

            {stats.data && (
              <dl className="flex gap-6 text-right">
                <div>
                  <Caption>Airports</Caption>
                  <dd className="font-mono text-lg font-bold text-ink tnum">
                    {(stats.data.nodes.Airport ?? 0).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <Caption>Airlines</Caption>
                  <dd className="font-mono text-lg font-bold text-ink tnum">
                    {(stats.data.nodes.Airline ?? 0).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <Caption>Routes</Caption>
                  <dd className="font-mono text-lg font-bold text-air-red tnum">
                    {(stats.data.relationships.FLIES_TO ?? 0).toLocaleString()}
                  </dd>
                </div>
              </dl>
            )}
          </div>

          {/* Tabs sit on the rule like index tabs on a folder: the active one is
              filled and loses its bottom edge, so it joins the page below. */}
          <nav aria-label="Main">
            {/* On a very narrow screen the three tabs are wider than the viewport.
                Scroll the tab strip rather than the whole page body. */}
            <ul className="-mb-0.5 flex gap-1 overflow-x-auto">
              {TABS.map(({ id, label }) => {
                const current = tab === id;
                return (
                  <li key={id}>
                    {/* A real anchor, so these are linkable, middle-clickable and
                        keyboard-reachable without any extra handling. */}
                    <a
                      href={`#${id}`}
                      onClick={() => setTab(id)}
                      aria-current={current ? "page" : undefined}
                      className={`flex min-h-11 cursor-pointer items-center border-2 border-b-0 px-4 text-sm font-semibold tracking-wide transition-colors duration-150 ${
                        current
                          ? "border-rule bg-ink text-paper"
                          : "border-rule-soft bg-paper-2 text-ink-dim hover:border-rule hover:text-ink"
                      }`}
                    >
                      {label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* A lede, set in the display serif, rather than a coloured side rule. */}
        <p className="mb-6 max-w-2xl font-display text-lg leading-snug text-ink-dim">
          {active.blurb}
        </p>

        {airlines.loading && <Skeleton rows={5} />}
        {airlines.error && (
          <div className="card-flat">
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
          <div className="card-flat px-6 py-16 text-center">
            <p className="font-display text-2xl text-ink">Nothing on the board</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-dim">
              The database is reachable but has nothing in it. Collect a snapshot and
              load it:
            </p>
            <code className="mt-4 inline-block border-2 border-rule bg-paper-2 px-3 py-1.5 font-mono text-xs text-ink">
              python -m seed.collect &amp;&amp; python -m seed.load
            </code>
          </div>
        )}
      </main>

      <footer className="mt-8 border-t-2 border-rule bg-paper-2">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <Caption>About this data</Caption>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-ink-dim">
            Routes are observed via ADS-B rather than taken from a published schedule,
            so coverage follows receiver density, this is not a complete picture of any
            airline&rsquo;s network, and cargo and charter operators appear alongside
            passenger airlines. Airports from OurAirports; alliance membership from the
            alliances&rsquo; own published member lists.
          </p>
        </div>
      </footer>
    </div>
  );
}
