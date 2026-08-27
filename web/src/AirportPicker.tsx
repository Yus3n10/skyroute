/** Typeahead for choosing an airport.
 *
 * Two views need it, so it lives on its own. Built as a combobox rather than a
 * <select> because the graph holds thousands of airports and nobody scrolls that.
 * Keyboard support is deliberate: arrows move, Enter picks, Escape closes, and the
 * listbox is wired up with aria-activedescendant so it is announced properly.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Plane, X } from "lucide-react";
import { api, type Airport } from "./api";
import { inputClass, useAsync, useDebounced } from "./ui";

export default function AirportPicker({
  label,
  value,
  onChange,
  placeholder = "City, airport or IATA code",
}: {
  label: string;
  value: Airport | null;
  onChange: (airport: Airport | null) => void;
  placeholder?: string;
}) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(term.trim(), 250);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const results = useAsync(
    () => api.searchAirports(debounced),
    [debounced],
    open && debounced.length > 0,
  );
  const options = results.data ?? [];

  useEffect(() => setActive(0), [debounced]);

  // Clicking anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (airport: Airport) => {
    onChange(airport);
    setTerm("");
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") return setOpen(false);
    if (!options.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(options[active]);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-dim uppercase">
          {label}
        </span>

        {value ? (
          <div className="flex items-center gap-2 rounded-lg border border-brand/50 bg-surface-2 px-3 py-2">
            <span className="font-mono text-sm font-bold text-brand-bright">{value.iata}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink" title={value.name}>
              {value.city || value.name}
            </span>
            <span className="hidden text-xs text-ink-faint sm:inline">{value.country}</span>
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={`Clear ${label}`}
              className="cursor-pointer rounded p-0.5 text-ink-faint transition-colors duration-200 hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <input
            type="text"
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && options.length ? `${listId}-${active}` : undefined
            }
            value={term}
            placeholder={placeholder}
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={inputClass}
          />
        )}
      </label>

      {open && !value && debounced.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line-bright bg-surface shadow-xl">
          {results.loading && <p className="px-3 py-3 text-sm text-ink-dim">Searching...</p>}

          {results.error && (
            <p className="px-3 py-3 text-sm text-star">
              {results.error.status === 503
                ? "The graph is unreachable."
                : "Search failed."}
            </p>
          )}

          {!results.loading && !results.error && options.length === 0 && (
            <p className="px-3 py-3 text-sm text-ink-dim">
              No airport matches "{debounced}".
            </p>
          )}

          <ul id={listId} role="listbox" aria-label={label}>
            {options.map((airport, index) => (
              <li key={airport.iata} id={`${listId}-${index}`} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(airport)}
                  className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors duration-150 ${
                    index === active ? "bg-surface-2" : ""
                  }`}
                >
                  <span className="w-10 shrink-0 font-mono text-sm font-bold text-brand-bright">
                    {airport.iata}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {airport.city || airport.name}
                    </span>
                    <span className="block truncate text-xs text-ink-faint">{airport.name}</span>
                  </span>
                  <span className="hidden shrink-0 text-right text-xs text-ink-faint sm:block">
                    {airport.country}
                    <span className="block font-mono tnum">
                      {airport.destinations} dest
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!value && debounced.length === 0 && open && (
        <div className="absolute z-30 mt-1 flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-3">
          <Plane className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
          <p className="text-xs text-ink-dim">
            Start typing. Try MNL, Tokyo, or Iceland.
          </p>
        </div>
      )}
    </div>
  );
}
