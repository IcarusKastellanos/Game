/** Shared in-game hour (0–23) and weekday (0 Sunday–6). Both follow real time. */
let worldHour = new Date().getHours();
let worldWeekday = new Date().getDay();

export function getWorldHour(): number {
  return worldHour;
}

export function getWorldWeekday(): number {
  return worldWeekday;
}

export function tickWorldClock(): void {
  const now = new Date();
  worldHour = now.getHours();
  worldWeekday = now.getDay();
}

export function formatWorldHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${suffix}`;
}
