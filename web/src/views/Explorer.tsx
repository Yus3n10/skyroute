/** Airport explorer.
 *
 * Two graph shapes side by side: the direct neighbours of one airport, and the
 * countries that open up within one or two hops. The reach query is the one worth
 * looking at - it asks the shortest number of legs to each country, which is a
 * minimum over paths rather than a count over rows.
 */
import { useState } from "react";
import { Globe2, Plane, TrendingUp } from "lucide-react";
import { api, formatKm, type Airport } from "../api";
import { AllianceChip, Async, Field, Panel, selectClass, useAsync } from "../ui";
import AirportPicker from "../AirportPicker";

export default function Explorer() {
  const [airport, setAirport] = useState<Airport | null>(null);
  const [legs, setLegs] = useState(2);

  const selected = airport?.iata ?? "";
  const detail = useAsync(() => api.airport(selected), [selected], Boolean(selected));
  const destinations = useAsync(() => api.destinations(selected), [selected], Boolean(selected));
  const reach = useAsync(() => api.reach(selected, legs), [selected, legs], Boolean(selected));
  const hubs = useAsync(() => api.hubs(20), []);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <Panel title="Explore an airport">
          <div className="border-b border-line p-4 lg:max-w-md">
            <AirportPicker label="Airport" value={airport} onChange={setAirport} />
          </div>

          {!selected ? (
            <div className="px-6 py-14 text-center">
              <Plane className="mx-auto h-8 w-8 text-ink-faint" aria-hidden="true" />
              <p className="mt-3 font-display text-base font-semibold tracking-wide text-ink uppercase">
                Pick an airport
              </p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-dim">
                See everywhere it flies directly, and how much of the world it opens
                up in one or two hops.
              </p>
            </div>
          ) : (
            <>
              <Async
                state={detail}
                skeletonRows={1}
                empty={<p className="p-4 text-sm text-ink-dim">No detail available.</p>}
              >
                {(d) => (
                  <dl className="grid grid-cols-2 gap-3 border-b border-line p-4 sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-ink-faint">Code</dt>
                      <dd className="font-mono text-lg font-bold text-brand-bright">
                        {d.airport.iata}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-faint">Country</dt>
                      <dd className="truncate text-sm text-ink">{d.airport.country}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-faint">Direct destinations</dt>
                      <dd className="font-mono text-lg font-bold text-ink tnum">
                        {d.destinationCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-faint">Airlines</dt>
                      <dd className="font-mono text-lg font-bold text-ink tnum">
                        {d.airlineCount}
                      </dd>
                    </div>
                  </dl>
                )}
              </Async>

              <Async
                state={destinations}
                skeletonRows={6}
                isEmpty={(d) => d.length === 0}
                empty={
                  <div className="px-6 py-12 text-center">
                    <p className="font-display text-base font-semibold tracking-wide text-ink uppercase">
                      No outbound routes
                    </p>
                    <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-dim">
                      Nothing was observed departing this airport during the sampling
                      window. Smaller airports often fall outside ADS-B coverage.
                    </p>
                  </div>
                }
              >
                {(rows) => (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <caption className="sr-only">Direct destinations from {selected}</caption>
                      <thead>
                        <tr className="border-b border-line text-left text-xs tracking-wide text-ink-dim uppercase">
                          <th scope="col" className="px-4 py-2.5 font-medium">Destination</th>
                          <th scope="col" className="px-4 py-2.5 font-medium">Country</th>
                          <th scope="col" className="px-4 py-2.5 text-right font-medium">Distance</th>
                          <th scope="col" className="px-4 py-2.5 font-medium">Flown by</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr
                            key={row.iata}
                            className="border-b border-line/50 transition-colors duration-200 last:border-0 hover:bg-surface-2/60"
                          >
                            <td className="px-4 py-2.5">
                              <span className="font-mono font-bold text-brand-bright">
                                {row.iata}
                              </span>
                              <span className="ml-2 text-ink-dim">{row.city || row.name}</span>
                            </td>
                            <td className="px-4 py-2.5 text-ink-dim">{row.country}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-ink-dim tnum">
                              {formatKm(row.distanceKm)}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-wrap items-center gap-1">
                                {row.airlines.slice(0, 3).map((a) => (
                                  <span
                                    key={a.code}
                                    className="text-xs text-ink-dim"
                                    title={`${a.name} (${a.code})`}
                                  >
                                    {a.name}
                                  </span>
                                ))}
                                {row.airlines.length > 3 && (
                                  <span className="text-xs text-ink-faint">
                                    +{row.airlines.length - 3}
                                  </span>
                                )}
                                {row.airlines[0] && row.airlines[0].alliance !== "none" && (
                                  <AllianceChip alliance={row.airlines[0].alliance} size="xs" />
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Async>
            </>
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel
          title="Reach"
          subtitle={selected ? `Countries within ${legs} ${legs === 1 ? "leg" : "legs"} of ${selected}` : undefined}
        >
          {!selected ? (
            <div className="px-4 py-10 text-center">
              <Globe2 className="mx-auto h-7 w-7 text-ink-faint" aria-hidden="true" />
              <p className="mt-2 text-sm text-ink-dim">Pick an airport to see its reach.</p>
            </div>
          ) : (
            <>
              <div className="border-b border-line p-4">
                <Field label="Maximum legs">
                  <select
                    className={selectClass}
                    value={legs}
                    onChange={(e) => setLegs(Number(e.target.value))}
                  >
                    <option value={1}>1 leg - direct only</option>
                    <option value={2}>2 legs - one connection</option>
                    <option value={3}>3 legs - two connections</option>
                  </select>
                </Field>
              </div>
              <Async
                state={reach}
                skeletonRows={5}
                isEmpty={(d) => d.length === 0}
                empty={
                  <div className="px-4 py-10 text-center">
                    <p className="text-sm text-ink-dim">
                      Nothing reachable from here in the observed network.
                    </p>
                  </div>
                }
              >
                {(rows) => (
                  <ul className="max-h-[26rem] divide-y divide-line/50 overflow-y-auto">
                    {rows.map((row) => (
                      <li
                        key={row.countryCode}
                        className="flex items-center gap-3 px-4 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate text-ink">{row.country}</span>
                        <span className="font-mono text-xs text-ink-faint tnum">
                          {row.airports} {row.airports === 1 ? "airport" : "airports"}
                        </span>
                        <span
                          className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-brand-bright tnum"
                          title="Fewest legs needed to reach this country"
                        >
                          {row.fewestLegs}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Async>
            </>
          )}
        </Panel>

        <Panel title="Busiest hubs" subtitle="By distinct destinations in this dataset">
          <Async
            state={hubs}
            skeletonRows={5}
            isEmpty={(d) => d.length === 0}
            empty={
              <div className="px-4 py-10 text-center">
                <TrendingUp className="mx-auto h-7 w-7 text-ink-faint" aria-hidden="true" />
                <p className="mt-2 text-sm text-ink-dim">No routes loaded yet.</p>
              </div>
            }
          >
            {(rows) => (
              <ol className="max-h-96 divide-y divide-line/50 overflow-y-auto">
                {rows.map((hub, i) => (
                  <li key={hub.iata}>
                    <button
                      type="button"
                      onClick={() =>
                        setAirport({
                          iata: hub.iata, icao: "", name: hub.name, city: hub.city,
                          country: hub.country, countryCode: "", continent: "",
                          lat: 0, lon: 0, destinations: hub.destinations,
                        })
                      }
                      className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm transition-colors duration-200 hover:bg-surface-2/60"
                    >
                      <span className="w-4 shrink-0 font-mono text-xs text-ink-faint tnum">
                        {i + 1}
                      </span>
                      <span className="w-10 shrink-0 font-mono font-bold text-brand-bright">
                        {hub.iata}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink-dim">
                        {hub.city || hub.name}
                      </span>
                      <span className="font-mono text-xs text-ink tnum">{hub.destinations}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Async>
        </Panel>
      </div>
    </div>
  );
}
