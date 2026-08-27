/** Alliance comparison.
 *
 * The query behind this is the clearest "a relational database would find this
 * awkward" example in the project: an itinerary only counts for an alliance if
 * EVERY leg belongs to it, which is a predicate over a path of unknown length, and
 * the result keeps just the best path per alliance.
 */
import { useEffect, useState } from "react";
import {
  ALLIANCE_CLASS,
  ALLIANCE_LABELS,
  api,
  formatKm,
  type Airline,
  type Airport,
  type AllianceId,
} from "../api";
import { Async, Caption, EmptyState, HelpNote, Panel, useAsync, useHashParams } from "../ui";
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
    () => api.compareAlliances(origin!.iata, destination!.iata, 2),
    [origin?.iata, destination?.iata],
    ready,
  );
  const overview = useAsync(() => api.alliances(), []);

  return (
    <div className="space-y-5">
      <Panel className="min-w-0" title="Which airline partnership flies this best?">
        <div className="border-b-2 border-rule-soft p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:max-w-xl">
            <AirportPicker label="From" value={origin} onChange={choose("from")} />
            <AirportPicker label="To" value={destination} onChange={choose("to")} />
          </div>
          <div className="mt-4 lg:max-w-xl">
            <HelpNote label="What is an airline alliance?">
              <p>
                Most large airlines belong to one of three global partnerships: Star
                Alliance, oneworld or SkyTeam. Member airlines sell each other&rsquo;s
                seats, share lounges, and let you earn and spend points across the whole
                group.
              </p>
              <p>
                That is why it matters which one a trip uses. A journey that stays inside
                a single partnership keeps your points and status the whole way, even
                when you change planes onto a different airline.
              </p>
            </HelpNote>
          </div>
        </div>

        {!ready ? (
          <EmptyState
            title="Pick a city pair"
            body="Pick where you are flying from and to. You will get the best trip each of the three partnerships can offer, using only their own member airlines the whole way."
          />
        ) : (
          <Async
            state={comparison}
            skeletonRows={3}
            isEmpty={(d) => d.length === 0}
            empty={
              <EmptyState
                title="No alliance covers this"
                body="No single partnership connects these two airports within two stops. There may still be a route that mixes airlines, so try the Itineraries tab with Any airline."
              />
            }
          >
            {(options) => (
              <ul className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
                {options.map(({ alliance, best }) => {
                  const tone = ALLIANCE_CLASS[alliance as AllianceId];
                  return (
                    <li key={alliance} className="card-flat">
                      <div className="flex items-baseline justify-between gap-2 border-b-2 border-rule px-3 py-2">
                        <h3 className={`stamp px-1.5 py-0.5 text-[11px] ${tone}`}>
                          {ALLIANCE_LABELS[alliance as AllianceId]}
                        </h3>
                        <span className="font-mono text-xs font-bold text-ink tnum">
                          {formatKm(best.distanceKm)}
                        </span>
                      </div>

                      <div className="px-3 py-3">
                        <p className="font-display text-lg leading-none text-ink">
                          {stopsLabel(best.legCount)}
                        </p>

                        {/* The route read top to bottom, the way an itinerary is
                            printed on a ticket rather than laid out as a row. */}
                        <ol className="mt-3 space-y-0">
                          {best.stops.map((stop, index) => (
                            <li key={`${stop.iata}-${index}`}>
                              <div className="flex items-baseline gap-2">
                                <span className="w-11 shrink-0 font-mono text-base font-bold text-ink">
                                  {stop.iata}
                                </span>
                                <span className="min-w-0 truncate text-xs text-ink-dim">
                                  {stop.city || stop.name}
                                </span>
                              </div>
                              {index < best.legs.length && (
                                <div className="flex items-center gap-2 py-1 pl-4">
                                  <span
                                    className="block h-4 w-px bg-ink-faint"
                                    aria-hidden="true"
                                  />
                                  <span className="truncate text-[11px] text-ink-faint">
                                    {airlines.get(best.legs[index].airline)?.name ??
                                      best.legs[index].airline}
                                  </span>
                                </div>
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Async>
        )}
      </Panel>

      <Panel
        title="The three partnerships"
        subtitle="Counted from flights seen in this dataset, not published network size"
      >
        <Async
          state={overview}
          skeletonRows={3}
          isEmpty={(d) => d.length === 0}
          empty={
            <EmptyState title="No alliances loaded" body="Run the seed script to populate the graph." />
          }
        >
          {(rows) => (
            <ul className="grid gap-4 p-4 sm:grid-cols-3">
              {rows.map((alliance) => (
                <li key={alliance.id} className="card-flat p-4">
                  <h3
                    className={`stamp inline-block px-2 py-1 text-xs ${
                      ALLIANCE_CLASS[alliance.id]
                    }`}
                  >
                    {alliance.name}
                  </h3>
                  <p className="mt-3 text-xs text-ink-faint">Founded {alliance.founded}</p>
                  <dl className="mt-3 flex gap-6">
                    <div>
                      <Caption>Airlines seen</Caption>
                      <dd className="font-mono text-2xl leading-none font-bold text-ink tnum">
                        {alliance.airlineCount}
                      </dd>
                    </div>
                    <div>
                      <Caption>Routes</Caption>
                      <dd className="font-mono text-2xl leading-none font-bold text-ink tnum">
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
