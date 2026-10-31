import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildUsageCalendar,
  formatTokens,
  todayInTimeZone,
  usageYears,
  type UsageDay,
} from './usage-calendar.ts';

function usageDay(date: string, totalTokens: number): UsageDay {
  return {
    date,
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens,
  };
}

test('today follows the collection timezone across the year boundary', () => {
  const instant = new Date('2026-01-01T02:30:00.000Z');
  assert.equal(todayInTimeZone('America/Los_Angeles', instant), '2025-12-31');
  assert.equal(todayInTimeZone('Asia/Ho_Chi_Minh', instant), '2026-01-01');
});

test('leap days and the uncommon 54-column calendar keep their weekday positions', () => {
  const leap = buildUsageCalendar([], 2024, '2024-12-31');
  assert.equal(leap.days.length, 366);
  assert.equal(leap.rows[1][0]?.date, '2024-01-01');
  assert.equal(leap.rows[4][8]?.date, '2024-02-29');
  assert.equal(leap.rows[0][0], null);
  assert.equal(leap.months.find((month) => month.label === 'Mar')?.week, 8);

  const saturdayLeapYear = buildUsageCalendar([], 2028, '2028-12-31');
  assert.equal(saturdayLeapYear.weeks, 54);
  assert.equal(saturdayLeapYear.rows[0][53]?.date, '2028-12-31');
});

test('only dates through today contribute cells and exact selected-year totals', () => {
  const calendar = buildUsageCalendar([
    usageDay('2025-12-31', 9),
    usageDay('2026-02-28', 1_234_567),
    usageDay('2026-03-01', 7_654_321),
    usageDay('2026-03-02', 8_000),
  ], 2026, '2026-03-01');

  assert.equal(calendar.days.length, 60);
  assert.equal(calendar.days.at(-1)?.date, '2026-03-01');
  assert.equal(calendar.rows.flat().filter(Boolean).length, 60);
  assert.equal(calendar.days.some((day) => day.date === '2026-03-02'), false);
  assert.equal(calendar.totalTokens, 8_888_888);
  assert.equal(formatTokens(calendar.totalTokens), '8,888,888 tokens');
  assert.equal(calendar.months.at(-1)?.label, 'Mar');
});

test('the current year ends at the latest visible week without blank future columns', () => {
  const calendar = buildUsageCalendar([], 2026, '2026-10-31');
  assert.equal(calendar.weeks, 44);
  assert.equal(calendar.rows[6].at(-1)?.date, '2026-10-31');
  assert.ok(calendar.rows.every((row) => row.length === calendar.weeks));

  const newYear = buildUsageCalendar([], 2026, '2026-01-01');
  assert.equal(newYear.weeks, 1);
  assert.equal(newYear.rows[4][0]?.date, '2026-01-01');
});

test('all recorded years remain selectable and empty history defaults to this year', () => {
  assert.deepEqual(usageYears([
    usageDay('2017-01-01', 1),
    usageDay('2024-02-29', 2),
    usageDay('2026-10-31', 3),
    usageDay('2027-01-01', 4),
  ], '2026-10-31'), [2026, 2024, 2017]);
  assert.deepEqual(usageYears([], '2026-10-31'), [2026]);
});
