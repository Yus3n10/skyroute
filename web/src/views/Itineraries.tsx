/** Itinerary search - the view the graph exists for.
 *
 * Pick two airports and the server walks up to three FLIES_TO hops between them,
 * optionally requiring every leg to belong to the same alliance, and ranks what it
 * finds by stops then total great-circle distance.
 *
 * Each result is drawn as a boarding pass: a torn-off stub carrying the headline
 * numbers, then the route itself. It is the format this information already has in
 * the real world, which beats inventing a card for it.
 */
import { useEffect, useState } from "react";
import {
  ALLIANCE_LABELS,
  api,
  formatKm,
  type Airline,
  type Airport,
  type Itinerary,
} from "../api";
import {
  AllianceChip,
  Async,
  Caption,
  EmptyState,
  Field,
  HelpNote,
  Panel,
  selectClass,
  useAsync,
  useHashParams,
} from "../ui";
import AirportPicker from "../AirportPicker";

const LEG_OPTIONS = [
  { value: 1, label: "Direct flights only" },
  { value: 2, label: "Up to 1 stop" },
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

/** A single leg drawn as a dashed flight path with the aircraft on it. */
function Leg({
  airline,
  alliance,
  distanceKm,
}: {
  airline: string;
  alliance: Itinerary["legs"][number]["alliance"];
  distanceKm: number;
}) {
  return (
    <div className="flex min-w-[8.5rem] flex-1 flex-col items-center justify-center px-2">
      <span
        className="max-w-full truncate text-center text-[11px] font-medium text-ink"
        title={airline}
      >
        {airline}
      </span>
      <svg
        viewBox="0 0 120 12"
        className="my-1 h-3 w-full"
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          y1="6"
          x2="120"
          y2="6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          className="text-ink-faint"
        />
        {/* A small aircraft riding the line, pointing the direction of travel. */}
        <path d="M56 1 L66 6 L56 11 L58.5 6 Z" fill="currentColor" className="text-air-red" />
      </svg>
      <div className="flex items-center gap-1.5">
        <AllianceChip alliance={alliance} size="xs" />
        <span className="font-mono text-[10px] text-ink-faint tnum">
          {Math.round(distanceKm).toLocaleString()} km
        </span>
      </div>
    </div>
  );
}

function Stop({ stop, terminal }: { stop: Itinerary["stops"][number]; terminal?: boolean }) {
  return (
    <div className="w-24 shrink-0">
      <p
        className={`font-mono leading-none font-bold tracking-tight ${
          terminal ? "text-2xl text-ink" : "text-xl text-ink-dim"
        }`}
      >
        {stop.iata}
      </p>
      <p className="mt-1 truncate text-xs text-ink-dim" title={stop.name}>
        {stop.city || stop.name}
      </p>
      <p className="truncate text-[10px] text-ink-faint">{stop.country}</p>
    </div>
  );
}

function BoardingPass({
  itinerary,
  airlines,
}: {
  itinerary: Itinerary;
  airlines: Map<string, Airline>;
}) {
  return (
    <li className="card flex">
      {/* The stub: what you would actually read at a glance. */}
      <div className="w-28 shrink-0 bg-paper-2 px-3 py-3">
        <Caption>{itinerary.legCount === 1 ? "Nonstop" : "Connecting"}</Caption>
        <p className="mt-1 font-display text-xl leading-none text-ink">
          {stopsLabel(itinerary.legCount)}
        </p>
        <p className="mt-2 font-mono text-sm font-bold text-air-red tnum">
          {formatKm(itinerary.distanceKm)}
        </p>
      </div>

      <div className="perforation min-w-0 flex-1">
        <div className="overflow-x-auto px-4 py-3">
          <div className="flex min-w-max items-center">
            {itinerary.stops.map((stop, i) => (
              <div key={`${stop.iata}-${i}`} className="flex items-center">
                <Stop stop={stop} terminal={i === 0 || i === itinerary.stops.length - 1} />
                {i < itinerary.legs.length && (
                  <Leg
                    airline={
                      airlines.get(itinerary.legs[i].airline)?.name ?? itinerary.legs[i].airline
                    }
                    alliance={itinerary.legs[i].alliance}
                    distanceKm={itinerary.legs[i].distanceKm}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}

export default function Itineraries({ airlines }: { airlines: Map<string, Airline> }) {
  const [params, setParams] = useHashParams();
  const [origin, setOrigin] = useState<Airport | null>(null);
  const [destination, setDestination] = useState<Airport | null>(null);
  const [maxLegs, setMaxLegs] = useState(() => Number(params.get("legs")) || 2);
  const [alliance, setAlliance] = useState(() => params.get("alliance") ?? "");

  // Rehydrate the pickers from the URL on first load, so a shared link opens on
  // the search it names. Only codes travel in the URL; the airport records are
  // fetched once here rather than being serialised into the link.
  useEffect(() => {
    const from = params.get("from");
    const to = params.get("to");
    if (from) api.airport(from).then((d) => setOrigin(d.airport)).catch(() => {});
    if (to) api.airport(to).then((d) => setDestination(d.airport)).catch(() => {});
    // Intentionally first-load only: after this the pickers own the state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (which: "from" | "to") => (airport: Airport | null) => {
    if (which === "from") setOrigin(airport);
    else setDestination(airport);
    setParams({ [which]: airport?.iata ?? null });
  };

  const ready = Boolean(origin && destination && origin.iata !== destination.iata);

  const results = useAsync(
    () => api.itineraries(origin!.iata, destination!.iata, maxLegs, alliance || null),
    [origin?.iata, destination?.iata, maxLegs, alliance],
    ready,
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[19rem_1fr]">
      <Panel title="Find a route" className="h-fit">
        <div className="space-y-4 p-4">
          <AirportPicker label="From" value={origin} onChange={choose("from")} />
          <AirportPicker label="To" value={destination} onChange={choose("to")} />

          <Field label="Stops">
            <select
              className={selectClass}
              value={maxLegs}
              onChange={(e) => {
                setMaxLegs(Number(e.target.value));
                setParams({ legs: e.target.value });
              }}
            >
              {LEG_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Airline partnership">
            <select
              className={selectClass}
              value={alliance}
              onChange={(e) => {
                setAlliance(e.target.value);
                setParams({ alliance: e.target.value || null });
              }}
            >
              {ALLIANCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          {origin && destination && origin.iata === destination.iata && (
            <p role="alert" className="text-xs font-medium text-air-red">
              Origin and destination are the same airport.
            </p>
          )}

          <HelpNote label="How this works">
            <p>
              A direct flight is one plane. Each extra stop means changing planes at
              another airport along the way.
            </p>
            <p>
              Airlines group themselves into three big partnerships: Star Alliance,
              oneworld and SkyTeam. Sticking to one of them is how frequent flyers earn
              and keep their status. Picking one here only shows trips where{" "}
              <em>every</em> flight is with that partnership.
            </p>
          </HelpNote>
        </div>
      </Panel>

      <Panel
        className="min-w-0"
        title="Itineraries"
        subtitle={
          results.data
            ? `${results.data.itineraries.length} found, ${results.data.origin.iata} to ${results.data.destination.iata}`
            : undefined
        }
      >
        {!ready ? (
          <EmptyState
            title="Where to?"
            body="Choose where you are flying from and to. You will get every way to make the trip, direct or with a stop along the way."
          />
        ) : (
          <Async
            state={results}
            skeletonRows={4}
            isEmpty={(d) => d.itineraries.length === 0}
            empty={
              <EmptyState
                title="Nothing connects"
                body={
                  alliance
                    ? `Nothing links these two airports on ${ALLIANCE_LABELS[alliance as keyof typeof ALLIANCE_LABELS]} within this many stops. Try Any airline, or allow one more stop.`
                    : "Nothing links these two airports within this many stops. Try allowing one more stop."
                }
              />
            }
          >
            {(data) => (
              <ul className="space-y-4 p-4">
                {data.itineraries.map((itinerary, i) => (
                  <BoardingPass key={i} itinerary={itinerary} airlines={airlines} />
                ))}
              </ul>
            )}
          </Async>
        )}
      </Panel>
    </div>
  );
}
