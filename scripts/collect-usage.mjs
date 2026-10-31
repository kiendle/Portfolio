import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { repositoryRoot, resolveTimeZone, snapshotPath } from './usage-common.mjs';

const tokenFields = ['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens'];

function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`ccusage returned an invalid ${field} count; the previous snapshot was kept.`);
  }
  return value;
}

function aggregateDaily(report) {
  if (!Array.isArray(report?.daily) || report.daily.length === 0) {
    throw new Error('ccusage returned no daily records; the previous snapshot was kept, not replaced with zero usage.');
  }

  const days = new Map();
  for (const row of report.daily) {
    const date = row?.period;
    const dateValue = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    if (!dateValue || Number.isNaN(dateValue.valueOf()) || dateValue.toISOString().slice(0, 10) !== date) {
      throw new Error('ccusage returned an invalid daily period; the previous snapshot was kept.');
    }
    if (row.agent !== 'all') {
      throw new Error('Expected unified all-agent daily rows from ccusage; the previous snapshot was kept.');
    }

    const counters = Object.fromEntries(tokenFields.map((field) => [field, count(row[field], field)]));
    const total = count(tokenFields.reduce((sum, field) => sum + counters[field], 0), 'totalTokens');
    if (count(row.totalTokens, 'totalTokens') !== total) {
      throw new Error('ccusage totalTokens no longer matches the four token counters; the previous snapshot was kept.');
    }

    const day = days.get(date) || { date, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0 };
    for (const field of tokenFields) {
      day[field] = count(day[field] + counters[field], field);
    }
    day.totalTokens = count(day.totalTokens + total, 'totalTokens');
    days.set(date, day);
  }

  return [...days.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export async function collectUsage({ timeZone, ccusageCommand = process.env.CCUSAGE_BIN || 'ccusage' } = {}) {
  const groupingTimeZone = resolveTimeZone(timeZone);
  const result = spawnSync(ccusageCommand, ['daily', '--json', '--no-cost', '--offline', '--timezone', groupingTimeZone], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message || (result.signal ? `signal ${result.signal}` : `exit ${result.status}`);
    throw new Error(`ccusage failed (${reason}); the previous snapshot was kept. Raw report output was not saved.`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error('ccusage did not return valid JSON; the previous snapshot was kept. Raw report output was not saved.');
  }
  const days = aggregateDaily(report);

  let previous;
  try {
    previous = JSON.parse(await readFile(snapshotPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error('The existing usage snapshot could not be read as JSON; it was not overwritten.');
    }
  }
  if (previous?.timeZone === groupingTimeZone && JSON.stringify(previous.days) === JSON.stringify(days)) {
    console.log(`Usage snapshot unchanged: ${days.length} recorded days (${groupingTimeZone}).`);
    return previous;
  }

  const snapshot = { updatedAt: new Date().toISOString(), timeZone: groupingTimeZone, days };
  await mkdir(dirname(snapshotPath), { recursive: true });
  const temporaryPath = resolve(dirname(snapshotPath), `.usage-${process.pid}-${randomUUID()}.json`);
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, snapshotPath);
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }

  console.log(`Updated usage snapshot: ${days.length} recorded days (${groupingTimeZone}).`);
  return snapshot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { timezone: { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) {
      console.log('Usage: node scripts/collect-usage.mjs [--timezone IANA]\nUses CCUSAGE_BIN, USAGE_TIME_ZONE, or the current system timezone.');
    } else {
      await collectUsage({ timeZone: values.timezone });
    }
  } catch (error) {
    console.error(`Usage collection failed: ${error.message}`);
    process.exitCode = 1;
  }
}
