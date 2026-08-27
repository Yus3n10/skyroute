/** Airport explorer.
 *
 * Two graph shapes side by side: the direct neighbours of one airport, and the
 * countries that open up within one or two hops. The reach query is the one worth
 * looking at - it asks the shortest number of legs to each country, which is a
 * minimum over paths rather than a count over rows.
 *
 * The destination list is set as a departure board, because that is what it is.
 */
import { useState } from "react";
import { api, formatKm, type Airport } from "../api";
import {
  AllianceChip,
  Async,
  Caption,
  EmptyState,
  Field,
  Panel,
  selectClass,
  useAsync,
} from "../ui";
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
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-5">
        <Panel title="Explore an airport">
          <div className="border-b-2 border-rule-soft p-4 lg:max-w-sm">
            <AirportPicker label="Airport" value={airport} onChange={setAirport} />
          </div>

          {!selected ? (
            <EmptyState
              title="Start somewhere"
              body="Pick an airport to see everywhere it flies directly, and how much of the world opens up in one or two hops."
            />
          ) : (
            <>
              <Async
                state={detail}
                skeletonRows={1}
                empty={<p className="p-4 text-sm text-ink-dim">No detail available.</p>}
              >
                {(d) => (
                  <div className="flex flex-wrap items-end gap-x-8 gap-y-3 border-b-2 border-rule-soft bg-paper-2 px-4 py-3">
                    <div>
                      <Caption>Code</Caption>
                      <p className="font-mono text-4xl leading-none font-bold text-ink">
                        {d.airport.iata}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <Caption>Airport</Caption>
                      <p className="truncate text-sm text-ink">{d.airport.name}</p>
                      <p className="truncate text-xs text-ink-dim">{d.airport.country}</p>
                    </div>
                    <dl className="ml-auto flex gap-6">
                      <div>
                        <Caption>Destinations</Caption>
                        <dd className="font-mono text-2xl leading-none font-bold text-air-red tnum">
                          {d.destinationCount}
                        </dd>
                      </div>
                      <div>
                        <Caption>Airlines</Caption>
                        <dd className="font-mono text-2xl leading-none font-bold text-ink tnum">
                          {d.airlineCount}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </Async>

              <Async
                state={destinations}
                skeletonRows={6}
                isEmpty={(d) => d.length === 0}
                empty={
                  <EmptyState
                    title="Nothing departs"
                    body="No flights were observed leaving this airport during the sampling window. Smaller airports often fall outside ADS-B coverage."
                  />
                }
              >
                {(rows) => (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <caption className="sr-only">Direct destinations from {selected}</caption>
                      <thead>
                        <tr className="border-b-2 border-rule bg-paper-2 text-left">
                          <th scope="col" className="px-4 py-2">
                            <Caption>Destination</Caption>
                          </th>
                          <th scope="col" className="px-4 py-2">
                            <Caption>Country</Caption>
                          </th>
                          <th scope="col" className="px-4 py-2 text-right">
                            <Caption>Distance</Caption>
                          </th>
                          <th scope="col" className="px-4 py-2">
                            <Caption>Flown by</Caption>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr
                            key={row.iata}
                            className="border-b border-rule-soft last:border-b-0 hover:bg-paper-2"
                          >
                            <td className="px-4 py-2">
                              <span className="font-mono text-base font-bold text-ink">
                                {row.iata}
                              </span>
                              <span className="ml-2 text-ink-dim">{row.city || row.name}</span>
                            </td>
                            <td className="px-4 py-2 text-ink-dim">{row.country}</td>
                            <td className="px-4 py-2 text-right font-mono text-ink-dim tnum">
                              {formatKm(row.distanceKm)}
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                {row.airlines.slice(0, 2).map((a) => (
                                  <span key={a.code} className="text-xs text-ink" title={a.code}>
                                    {a.name}
                                  </span>
                                ))}
                                {row.airlines.length > 2 && (
                                  <span className="text-xs text-ink-faint">
                                    +{row.airlines.length - 2}
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

      <div className="space-y-5">
        <Panel
          title="Reach"
          subtitle={
            selected ? `Countries within ${legs} ${legs === 1 ? "leg" : "legs"} of ${selected}` : undefined
          }
        >
          {!selected ? (
            <p className="px-4 py-8 text-center text-sm text-ink-dim">
              Pick an airport to see its reach.
            </p>
          ) : (
            <>
              <div className="border-b-2 border-rule-soft p-4">
                <Field label="Maximum legs">
                  <select
                    className={selectClass}
                    value={legs}
                    onChange={(e) => setLegs(Number(e.target.value))}
                  >
                    <option value={1}>1 leg, direct only</option>
                    <option value={2}>2 legs, one connection</option>
                    <option value={3}>3 legs, two connections</option>
                  </select>
                </Field>
              </div>
              <Async
                state={reach}
                skeletonRows={5}
                isEmpty={(d) => d.length === 0}
                empty={
                  <p className="px-4 py-8 text-center text-sm text-ink-dim">
                    Nothing reachable from here in the observed network.
                  </p>
                }
              >
                {(rows) => (
                  <ul className="max-h-[26rem] overflow-y-auto">
                    {rows.map((row) => (
                      <li
                        key={row.countryCode}
                        className="flex items-center gap-3 border-b border-rule-soft px-4 py-1.5 text-sm last:border-b-0"
                      >
                        <span
                          className="w-5 shrink-0 text-center font-mono text-xs font-bold text-air-red tnum"
                          title={`Fewest legs to reach ${row.country}`}
                        >
                          {row.fewestLegs}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink">{row.country}</span>
                        <span className="font-mono text-[11px] text-ink-faint tnum">
                          {row.airports}
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
              <p className="px-4 py-8 text-center text-sm text-ink-dim">No routes loaded yet.</p>
            }
          >
            {(rows) => (
              <ol className="max-h-96 overflow-y-auto">
                {rows.map((hub, i) => (
                  <li key={hub.iata} className="border-b border-rule-soft last:border-b-0">
                    <button
                      type="button"
                      onClick={() =>
                        setAirport({
                          iata: hub.iata, icao: "", name: hub.name, city: hub.city,
                          country: hub.country, countryCode: "", continent: "",
                          lat: 0, lon: 0, destinations: hub.destinations,
                        })
                      }
                      className="flex w-full cursor-pointer items-center gap-3 px-4 py-1.5 text-left text-sm hover:bg-paper-2"
                    >
                      <span className="w-4 shrink-0 font-mono text-[11px] text-ink-faint tnum">
                        {i + 1}
                      </span>
                      <span className="w-10 shrink-0 font-mono font-bold text-ink">{hub.iata}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-dim">
                        {hub.city || hub.name}
                      </span>
                      <span className="font-mono text-xs font-bold text-ink tnum">
                        {hub.destinations}
                      </span>
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
