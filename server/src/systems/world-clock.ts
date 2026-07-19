/** Shared in-game hour (0–23), advances with real time. */
let worldHour = new Date().getHours();

export function getWorldHour(): number {
  return worldHour;
}

export function tickWorldClock(): void {
  worldHour = new Date().getHours();
}

export function formatWorldHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${suffix}`;
}
