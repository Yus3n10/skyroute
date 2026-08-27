/** Typeahead for choosing an airport.
 *
 * Two views need it, so it lives on its own. Built as a combobox rather than a
 * <select> because the graph holds thousands of airports and nobody scrolls that.
 * Keyboard support is deliberate: arrows move, Enter picks, Escape closes, and the
 * listbox is wired up with aria-activedescendant so it is announced properly.
 */
import { useEffect, useId, useRef, useState } from "react";
import { api, type Airport } from "./api";
import { Caption, inputClass, useAsync, useDebounced } from "./ui";

export default function AirportPicker({
  label,
  value,
  onChange,
  placeholder = "City, airport or code",
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
        <Caption className="mb-1">{label}</Caption>

        {value ? (
          /* A chosen airport reads like a filled field on a ticket: the code set
             large in mono, the city beneath it. */
          <div className="flex min-h-11 items-center gap-2 border-2 border-rule bg-paper-2 pl-3">
            <span className="font-mono text-xl leading-none font-bold text-ink">{value.iata}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-ink-dim" title={value.name}>
              {value.city || value.name}
            </span>
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={`Clear ${label}`}
              /* 44x44 to clear the WCAG 2.5.5 target-size floor, even though the glyph is small. */
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center text-xl leading-none text-ink-dim transition-colors duration-150 hover:text-air-red"
            >
              &times;
            </button>
          </div>
        ) : (
          <input
            type="text"
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && options.length ? `${listId}-${active}` : undefined}
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
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto border-2 border-rule bg-paper shadow-[4px_4px_0_var(--color-rule)]">
          {results.loading && <p className="px-3 py-3 text-sm text-ink-dim">Searching&hellip;</p>}

          {results.error && (
            <p className="px-3 py-3 text-sm text-air-red">
              {results.error.status === 503 ? "The graph is unreachable." : "Search failed."}
            </p>
          )}

          {!results.loading && !results.error && options.length === 0 && (
            <p className="px-3 py-3 text-sm text-ink-dim">
              No airport matches &ldquo;{debounced}&rdquo;.
            </p>
          )}

          <ul id={listId} role="listbox" aria-label={label}>
            {options.map((airport, index) => (
              <li
                key={airport.iata}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
              >
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(airport)}
                  className={`flex w-full cursor-pointer items-center gap-3 border-b border-rule-soft px-3 py-2 text-left last:border-b-0 ${
                    index === active ? "bg-ink text-paper" : ""
                  }`}
                >
                  <span className="w-10 shrink-0 font-mono text-sm font-bold">{airport.iata}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{airport.city || airport.name}</span>
                    <span
                      className={`block truncate text-[11px] ${
                        index === active ? "text-paper-3" : "text-ink-faint"
                      }`}
                    >
                      {airport.name}
                    </span>
                  </span>
                  <span
                    className={`hidden shrink-0 text-right font-mono text-[10px] tnum sm:block ${
                      index === active ? "text-paper-3" : "text-ink-faint"
                    }`}
                  >
                    {airport.destinations}
                    <span className="block">dest</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!value && debounced.length === 0 && open && (
        <div className="absolute z-30 mt-1 w-full border-2 border-rule bg-paper px-3 py-2.5 shadow-[4px_4px_0_var(--color-rule)]">
          <p className="text-xs text-ink-dim">
            Start typing. Try <span className="font-mono font-bold">MNL</span>, Tokyo, or Iceland.
          </p>
        </div>
      )}
    </div>
  );
}
