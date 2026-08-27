/** Alliance comparison.
 *
 * The query behind this is the clearest "a relational database would find this
 * awkward" example in the project: an itinerary only counts for an alliance if
 * EVERY leg belongs to it, which is a predicate over a path of unknown length, and
 * the result keeps just the best path per alliance.
 */
import { useEffect, useState } from "react";
import { ArrowRight, Users } from "lucide-react";
import {
  ALLIANCE_CLASS,
  ALLIANCE_LABELS,
  api,
  formatKm,
  type Airline,
  type Airport,
  type AllianceId,
} from "../api";
import { Async, EmptyState, Panel, useAsync, useHashParams } from "../ui";
import AirportPicker from "../AirportPicker";

function stopsLabel(legCount: number): string {
  if (legCount === 1) return "Direct";
  return legCount === 2 ? "1 stop" : `${legCount - 1} stops`;
}

export default function Alliances({ airlines }: { airlines: Map<string, Airline> }) {
  const [params, setParams] = useHashParams();
  const [origin, setOrigin] = useState<Airport | null>(null);
  const [destination, setDestination] = useState<Airport | null>(null);

  // Same deal as the itinerary view: the city pair lives in the URL so a
  // comparison can be linked to directly.
  useEffect(() => {
    const from = params.get("from");
    const to = params.get("to");
    if (from) api.airport(from).then((d) => setOrigin(d.airport)).catch(() => {});
    if (to) api.airport(to).then((d) => setDestination(d.airport)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (which: "from" | "to") => (airport: Airport | null) => {
    if (which === "from") setOrigin(airport);
    else setDestination(airport);
    setParams({ [which]: airport?.iata ?? null });
  };

  const ready = Boolean(origin && destination && origin.iata !== destination.iata);
  const comparison = useAsync(
    () => api.compareAlliances(origin!.iata, destination!.iata, 3),
    [origin?.iata, destination?.iata],
    ready,
  );
  const overview = useAsync(() => api.alliances(), []);

  return (
    <div className="space-y-4">
      <Panel title="Which alliance flies this route best?">
        <div className="grid gap-4 border-b border-line p-4 sm:grid-cols-2 lg:max-w-2xl">
          <AirportPicker label="From" value={origin} onChange={choose("from")} />
          <AirportPicker label="To" value={destination} onChange={choose("to")} />
        </div>

        {!ready ? (
          <EmptyState
            icon={Users}
            title="Pick a city pair"
            body="The graph will find the best itinerary each alliance can offer, where every leg stays inside that alliance."
          />
        ) : (
          <Async
            state={comparison}
            skeletonRows={3}
            isEmpty={(d) => d.length === 0}
            empty={
              <EmptyState
                icon={Users}
                title="No alliance covers this pair"
                body="No single alliance connects these airports within two stops. A mixed-airline itinerary may still exist - try the Itineraries tab with any airline."
              />
            }
          >
            {(options) => (
              <ul className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                {options.map(({ alliance, best }, i) => (
                  <li
                    key={alliance}
                    className={`animate-rise rounded-lg border bg-surface-2/40 p-3 ${
                      ALLIANCE_CLASS[alliance as AllianceId].split(" ")[0]
                    }`}
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <h3
                        className={`font-display text-base font-semibold tracking-wide uppercase ${
                          ALLIANCE_CLASS[alliance as AllianceId].split(" ")[2]
                        }`}
                      >
                        {ALLIANCE_LABELS[alliance as AllianceId]}
                      </h3>
                      <span className="font-mono text-xs text-ink-dim tnum">
                        {formatKm(best.distanceKm)}
                      </span>
                    </div>

                    <p className="mb-2 text-sm text-ink">{stopsLabel(best.legCount)}</p>

                    <ol className="space-y-1">
                      {best.stops.map((stop, index) => (
                        <li key={`${stop.iata}-${index}`}>
                          <div className="flex items-baseline gap-2">
                            <span className="w-10 shrink-0 font-mono text-sm font-bold text-ink">
                              {stop.iata}
                            </span>
                            <span className="min-w-0 truncate text-xs text-ink-dim">
                              {stop.city || stop.name}
                            </span>
                          </div>
                          {index < best.legs.length && (
                            <div className="flex items-center gap-2 py-0.5 pl-1 text-[11px] text-ink-faint">
                              <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate">
                                {airlines.get(best.legs[index].airline)?.name ??
                                  best.legs[index].airline}
                              </span>
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            )}
          </Async>
        )}
      </Panel>

      <Panel
        title="The alliances"
        subtitle="Counts are of routes actually observed in this dataset, not published network size"
      >
        <Async
          state={overview}
          skeletonRows={3}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState title="No alliances loaded" body="Run the seed script to populate the graph." />}
        >
          {(rows) => (
            <ul className="grid gap-3 p-3 sm:grid-cols-3">
              {rows.map((alliance) => (
                <li
                  key={alliance.id}
                  className={`rounded-lg border bg-surface-2/40 p-4 ${
                    ALLIANCE_CLASS[alliance.id].split(" ")[0]
                  }`}
                >
                  <h3
                    className={`font-display text-lg font-semibold tracking-wide uppercase ${
                      ALLIANCE_CLASS[alliance.id].split(" ")[2]
                    }`}
                  >
                    {alliance.name}
                  </h3>
                  <p className="mt-1 text-xs text-ink-faint">Founded {alliance.founded}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-ink-faint">Airlines seen</dt>
                      <dd className="font-mono font-bold text-ink tnum">
                        {alliance.airlineCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-faint">Routes</dt>
                      <dd className="font-mono font-bold text-ink tnum">
                        {alliance.routeCount.toLocaleString()}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Panel>
    </div>
  );
}
