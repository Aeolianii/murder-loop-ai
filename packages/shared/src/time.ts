export const START_MINUTE = 23 * 60;
export const DEADLINE_MINUTE = 23 * 60 + 47;

export function minuteLabel(minute: number) {
  const hour = Math.floor(minute / 60).toString().padStart(2, '0');
  const min = (minute % 60).toString().padStart(2, '0');
  return `${hour}:${min}`;
}

export function minutesUntilDeadline(minute: number) {
  return Math.max(0, DEADLINE_MINUTE - minute);
}
