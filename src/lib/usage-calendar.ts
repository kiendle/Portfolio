export interface UsageDay {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export interface UsageData {
  updatedAt: string | null;
  timeZone: string;
  days: UsageDay[];
}

export interface CalendarDay {
  date: string;
  tokens: number;
  level: number;
  week: number;
  weekday: number;
  index: number;
}

export interface UsageCalendar {
  year: number;
  weeks: number;
  totalTokens: number;
  days: CalendarDay[];
  rows: (CalendarDay | null)[][];
  months: { label: string; week: number }[];
}

const DAY = 86_400_000;
const numberFormatter = new Intl.NumberFormat('en-US');
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'full',
  timeZone: 'UTC',
});
const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  timeZone: 'UTC',
});

function dateTime(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

/** Only this conversion uses a timezone. Calendar arithmetic stays date-only UTC. */
export function todayInTimeZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)!.value;

  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function usageYears(days: UsageDay[], today: string): number[] {
  const years = new Set<number>();

  for (const day of days) {
    if (day.date <= today) years.add(Number(day.date.slice(0, 4)));
  }

  return years.size > 0
    ? [...years].sort((a, b) => b - a)
    : [Number(today.slice(0, 4))];
}

export function buildUsageCalendar(
  usage: UsageDay[],
  year: number,
  today: string,
): UsageCalendar {
  const start = dateTime(`${year}-01-01`);
  const end = dateTime(`${year + 1}-01-01`) - DAY;
  const lastVisibleDate = Math.min(end, dateTime(today));
  const offset = new Date(start).getUTCDay();
  const weeks = Math.ceil(((lastVisibleDate - start) / DAY + 1 + offset) / 7);
  const totals = new Map<string, number>();
  let totalTokens = 0;
  let maximum = 0;

  for (const day of usage) {
    if (Number(day.date.slice(0, 4)) !== year || day.date > today) continue;
    totals.set(day.date, day.totalTokens);
    totalTokens += day.totalTokens;
    maximum = Math.max(maximum, day.totalTokens);
  }

  const days: CalendarDay[] = [];
  const rows: (CalendarDay | null)[][] = Array.from({ length: 7 }, () =>
    Array<CalendarDay | null>(weeks).fill(null),
  );

  for (let time = start, index = 0; time <= lastVisibleDate; time += DAY, index++) {
    const date = new Date(time).toISOString().slice(0, 10);
    const tokens = totals.get(date) ?? 0;
    const week = Math.floor((index + offset) / 7);
    const weekday = (index + offset) % 7;
    const day: CalendarDay = {
      date,
      tokens,
      level: tokens > 0 ? Math.ceil(Math.sqrt(tokens / maximum) * 4) : 0,
      week,
      weekday,
      index,
    };

    days.push(day);
    rows[weekday][week] = day;
  }

  const months: UsageCalendar['months'] = [];

  for (let month = 1; month <= 12; month++) {
    const time = dateTime(`${year}-${String(month).padStart(2, '0')}-01`);
    if (time > lastVisibleDate) break;
    months.push({
      label: monthFormatter.format(time),
      week: Math.floor(((time - start) / DAY + offset) / 7),
    });
  }

  return { year, weeks, totalTokens, days, rows, months };
}

export function formatTokens(tokens: number): string {
  return `${numberFormatter.format(tokens)} ${tokens === 1 ? 'token' : 'tokens'}`;
}

export function formatUsageDate(date: string): string {
  return dateFormatter.format(dateTime(date));
}

export function dayDescription(day: CalendarDay): string {
  return `${formatTokens(day.tokens)} on ${formatUsageDate(day.date)}`;
}

export function formatUpdatedAt(updatedAt: string | null, timeZone: string): string {
  if (updatedAt === null) return 'Not collected yet';

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(updatedAt));
}
