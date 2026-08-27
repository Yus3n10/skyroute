/** Itinerary search - the view the graph exists for.
 *
 * Pick two airports and the server walks up to three FLIES_TO hops between them,
 * optionally requiring every leg to belong to the same alliance, and ranks what it
 * finds by stops then total great-circle distance.
 */
import { useState } from "react";
import { ArrowRight, Route, Search } from "lucide-react";
import {
  ALLIANCE_LABELS,
  api,
  formatKm,
  type Airline,
  type Airport,
  type Itinerary,
} from "../api";
import { AllianceChip, Async, Field, Panel, selectClass, useAsync } from "../ui";
import AirportPicker from "../AirportPicker";

const LEG_OPTIONS = [
  { value: 1, label: "Direct only" },
  { value: 2, label: "Up to 1 stop" },
  { value: 3, label: "Up to 2 stops" },
];

const ALLIANCE_OPTIONS = [
  { value: "", label: "Any airline" },
  { value: "star-alliance", label: "Star Alliance only" },
  { value: "oneworld", label: "oneworld only" },
  { value: "skyteam", label: "SkyTeam only" },
];

function stopsLabel(legCount: number): string {
  if (legCount === 1) return "Direct";
  return legCount === 2 ? "1 stop" : `${legCount - 1} stops`;
}

function Chain({
  itinerary,
  index,
  airlines,
}: {
  itinerary: Itinerary;
  index: number;
  airlines: Map<string, Airline>;
}) {
  return (
    <li
      className="animate-rise rounded-lg border border-line bg-surface-2/50 p-3"
      style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-lg font-semibold tracking-wide text-brand-bright">
          {stopsLabel(itinerary.legCount)}
        </span>
        <span className="font-mono text-sm text-ink-dim tnum">
          {formatKm(itinerary.distanceKm)}
        </span>
      </div>

      {/* Long itineraries scroll inside their own row rather than the page. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex min-w-max items-stretch">
          {itinerary.stops.map((stop, i) => (
            <div key={`${stop.iata}-${i}`} className="flex items-stretch">
              <div className="w-28 shrink-0 rounded-md border border-line bg-surface px-2.5 py-2">
                <p className="font-mono text-base font-bold text-ink">{stop.iata}</p>
                <p className="truncate text-xs text-ink-dim" title={stop.name}>
                  {stop.city || stop.name}
                </p>
                <p className="truncate text-[10px] text-ink-faint">{stop.country}</p>
              </div>

              {i < itinerary.legs.length && (
                <div className="flex w-28 shrink-0 flex-col items-center justify-center gap-1 px-1">
                  <ArrowRight className="h-4 w-4 text-ink-faint" aria-hidden="true" />
                  <span className="text-center text-[11px] leading-tight text-ink">
                    {airlines.get(itinerary.legs[i].airline)?.name ?? itinerary.legs[i].airline}
                  </span>
                  <AllianceChip alliance={itinerary.legs[i].alliance} size="xs" />
                  <span className="font-mono text-[10px] text-ink-faint tnum">
                    {formatKm(itinerary.legs[i].distanceKm)}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </li>
  );
}

export default function Itineraries({ airlines }: { airlines: Map<string, Airline> }) {
  const [origin, setOrigin] = useState<Airport | null>(null);
  const [destination, setDestination] = useState<Airport | null>(null);
  const [maxLegs, setMaxLegs] = useState(2);
  const [alliance, setAlliance] = useState("");

  const ready = Boolean(origin && destination && origin.iata !== destination.iata);

  const results = useAsync(
    () => api.itineraries(origin!.iata, destination!.iata, maxLegs, alliance || null),
    [origin?.iata, destination?.iata, maxLegs, alliance],
    ready,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <Panel title="Plan a trip" className="h-fit">
        <div className="space-y-4 p-4">
          <AirportPicker label="From" value={origin} onChange={setOrigin} />
          <AirportPicker label="To" value={destination} onChange={setDestination} />

          <Field label="Stops">
            <select
              className={selectClass}
              value={maxLegs}
              onChange={(e) => setMaxLegs(Number(e.target.value))}
            >
              {LEG_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Alliance">
            <select
              className={selectClass}
              value={alliance}
              onChange={(e) => setAlliance(e.target.value)}
            >
              {ALLIANCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          {origin && destination && origin.iata === destination.iata && (
            <p role="alert" className="text-xs text-star">
              Origin and destination are the same airport.
            </p>
          )}

          <p className="border-t border-line pt-3 text-xs leading-relaxed text-ink-faint">
            Each stop is one FLIES_TO hop in the graph. Choosing an alliance makes
            every leg of the itinerary satisfy the same constraint, which is a rule
            about the whole path rather than any single flight.
          </p>
        </div>
      </Panel>

      <Panel
        title="Itineraries"
        subtitle={
          results.data
            ? `${results.data.itineraries.length} found from ${results.data.origin.iata} to ${results.data.destination.iata}`
            : undefined
        }
      >
        {!ready ? (
          <div className="px-6 py-16 text-center">
            <Search className="mx-auto h-8 w-8 text-ink-faint" aria-hidden="true" />
            <p className="mt-3 font-display text-base font-semibold tracking-wide text-ink uppercase">
              Choose two airports
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-dim">
              Pick where you are flying from and to, and the graph will find every
              way to connect them.
            </p>
          </div>
        ) : (
          <Async
            state={results}
            skeletonRows={4}
            isEmpty={(d) => d.itineraries.length === 0}
            empty={
              <div className="px-6 py-16 text-center">
                <Route className="mx-auto h-8 w-8 text-ink-faint" aria-hidden="true" />
                <p className="mt-3 font-display text-base font-semibold tracking-wide text-ink uppercase">
                  No route found
                </p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-dim">
                  {alliance
                    ? `Nothing connects these airports on ${ALLIANCE_LABELS[alliance as keyof typeof ALLIANCE_LABELS]} within this many stops. Try allowing any airline, or one more stop.`
                    : "Nothing connects these airports within this many stops. Try allowing one more stop."}
                </p>
              </div>
            }
          >
            {(data) => (
              <ul className="space-y-2 p-3">
                {data.itineraries.map((itinerary, i) => (
                  <Chain key={i} itinerary={itinerary} index={i} airlines={airlines} />
                ))}
              </ul>
            )}
          </Async>
        )}
      </Panel>
    </div>
  );
}
