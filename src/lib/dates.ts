export function zonedParts(at: Date | string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(at));
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}
export function wallTime(at: Date | string, timeZone: string) {
  const p = zonedParts(at, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function zonedTimeToIso(wall: string, timeZone: string) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(wall))
    throw new Error("Choose a date and time.");
  let guess = Date.parse(wall + "Z");
  if (!Number.isFinite(guess)) throw new Error("Invalid date/time.");
  for (let i = 0; i < 4; i++) {
    const actual = Date.parse(wallTime(new Date(guess), timeZone) + "Z");
    guess += Date.parse(wall + "Z") - actual;
  }
  if (wallTime(new Date(guess), timeZone) !== wall)
    throw new Error(
      "This local time does not exist in the selected timezone (daylight saving).",
    );
  // During a repeated hour, choose the first matching instant.
  for (const offset of [7200000, 3600000])
    if (wallTime(new Date(guess - offset), timeZone) === wall) guess -= offset;
  return new Date(guess).toISOString();
}
