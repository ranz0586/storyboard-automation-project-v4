// Reuse one formatter while scanning at most eight days. This handles DST gaps
// and repeated wall-clock times without assuming a fixed UTC offset.
export function nextWeeklyDate(schedule, now, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const start = Math.floor(now.getTime() / 60000) * 60000;
  for (let minute = 1; minute <= 8 * 24 * 60; minute++) {
    const date = new Date(start + minute * 60000),
      parts = formatter.formatToParts(date);
    const get = (kind) => parts.find((part) => part.type === kind)?.value;
    if (
      days.indexOf(get('weekday')) === schedule.dayOfWeek &&
      get('hour') + ':' + get('minute') === schedule.time
    )
      return date;
  }
  throw new Error('Could not resolve next weekly occurrence');
}
