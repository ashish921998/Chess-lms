"use client";

import { useState, useTransition } from "react";

const COMMON_ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const ALL_ZONES = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
  .supportedValuesOf?.("timeZone") ?? COMMON_ZONES;

/**
 * Inline timezone selector. Submits to PATCH /api/student/timezone on change.
 * Curated common zones first, then an optgroup of all IANA zones the runtime
 * knows about.
 */
export function TimezoneSelect({
  current,
  allZones = ALL_ZONES,
  commonZones = COMMON_ZONES,
}: {
  current: string;
  allZones?: string[];
  commonZones?: string[];
}) {
  const [value, setValue] = useState(current);
  const [saved, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const others = allZones.filter((z) => !commonZones.includes(z));

  function save(tz: string) {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/student/timezone", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: tz }),
      });
      if (res.ok) {
        setValue(tz);
      } else {
        setError("Couldn't save timezone — try again.");
      }
    });
  }

  return (
    <div>
      <label
        htmlFor="tz-select"
        className="block text-[10px] uppercase tracking-[0.1em] text-muted"
      >
        Timezone
      </label>
      <select
        id="tz-select"
        value={value}
        onChange={(e) => save(e.target.value)}
        className="mt-1 w-full border border-line bg-paper px-3 py-2 text-[13px] text-ink focus:outline-none focus:border-ink"
      >
        <optgroup label="Common">
          {commonZones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </optgroup>
        <optgroup label="All">
          {others.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </optgroup>
      </select>
      {saved && !error && (
        <p className="mt-1 text-[10px] uppercase tracking-[0.06em] text-success">Saved</p>
      )}
      {error && <p className="mt-1 text-[10px] uppercase tracking-[0.06em] text-error">{error}</p>}
    </div>
  );
}
