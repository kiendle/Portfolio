import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findExecutable, snapshotRelativePath } from './usage-common.mjs';

const tokenFields = ['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens'];

function invalidSnapshot(field) {
  return new Error(`Usage snapshot contains invalid ${field}; only approved daily aggregates can be published.`);
}

function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidSnapshot(`${field} counts`);
  }
  return value;
}

function serializeSnapshot(snapshot) {
  const updatedAt = snapshot?.updatedAt;
  const timestamp = typeof updatedAt === 'string' ? new Date(updatedAt) : null;
  if (!timestamp || Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== updatedAt) {
    throw invalidSnapshot('updatedAt metadata');
  }
  const timeZone = snapshot.timeZone;
  if (typeof timeZone !== 'string' || !timeZone.trim() || /^[+-]/.test(timeZone)) {
    throw invalidSnapshot('timeZone metadata');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw invalidSnapshot('timeZone metadata');
  }
  if (!Array.isArray(snapshot.days) || snapshot.days.length === 0) {
    throw invalidSnapshot('daily records');
  }

  const days = snapshot.days.map((row) => {
    const date = row?.date;
    const value = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    if (!value || Number.isNaN(value.valueOf()) || value.toISOString().slice(0, 10) !== date) {
      throw invalidSnapshot('daily dates');
    }
    const counters = Object.fromEntries(tokenFields.map((field) => [field, count(row[field], field)]));
    const totalTokens = count(row.totalTokens, 'totalTokens');
    if (count(tokenFields.reduce((sum, field) => sum + counters[field], 0), 'totalTokens') !== totalTokens) {
      throw invalidSnapshot('daily token totals');
    }
    return { date, ...counters, totalTokens };
  });

  return `${JSON.stringify({ updatedAt, timeZone, days }, null, 2)}\n`;
}

export async function publishUsage(snapshot, { repository } = {}) {
  if (typeof repository !== 'string' || !repository.trim()) {
    throw new Error('Usage publication requires an explicit repository directory.');
  }
  const serialized = serializeSnapshot(snapshot);
  let executable;
  try {
    executable = findExecutable('git');
  } catch {
    throw new Error('Usage publication requires Git on the scheduled job PATH.');
  }

  let temporaryDirectory;
  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'portfolio-usage-publish-'));
  } catch {
    throw new Error('Usage publication could not create its private temporary index directory.');
  }
  const privateRef = `refs/usage-publication/${randomUUID()}`;
  const environment = {
    ...process.env,
    GIT_INDEX_FILE: join(temporaryDirectory, 'index'),
    GIT_TERMINAL_PROMPT: '0',
  };
  // An inherited Git context must not redirect this explicit repository or its objects.
  for (const variable of [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_NAMESPACE',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_SHALLOW_FILE', 'GIT_QUARANTINE_PATH',
  ]) {
    delete environment[variable];
  }

  function git(operation, args, { input, hint = '' } = {}) {
    const result = spawnSync(executable, args, {
      cwd: repository,
      env: environment,
      shell: false,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
      input,
    });
    if (result.error || result.status !== 0) {
      const reason = result.error?.code || (result.signal ? `signal ${result.signal}` : `exit ${result.status}`);
      throw new Error(`Usage publication could not ${operation} (${reason}). ${hint ? `${hint} ` : ''}Git output was withheld.`);
    }
    return result.stdout.trim();
  }

  let publicationError;
  try {
    git('fetch origin/main', [
      'fetch', '--no-write-fetch-head', '--no-tags', '--no-prune', '--recurse-submodules=no', '--refmap=',
      'origin', `refs/heads/main:${privateRef}`,
    ], { hint: 'Check origin access and Git authentication for the scheduled job.' });
    const parent = git('resolve the fetched origin/main commit', ['rev-parse', `${privateRef}^{commit}`]);
    const previousTree = git('resolve the remote main tree', ['rev-parse', `${parent}^{tree}`]);
    git('read the remote main tree into the private index', ['read-tree', parent]);
    const blob = git('store the sanitized usage snapshot', ['hash-object', '-w', '--stdin'], { input: serialized });
    git('stage the usage snapshot in the private index', ['update-index', '--add', '--cacheinfo', '100644', blob, snapshotRelativePath]);
    const tree = git('write the usage publication tree', ['write-tree']);
    if (tree === previousTree) {
      return { published: false };
    }
    const commit = git('create the usage commit', ['commit-tree', tree, '-p', parent], {
      input: 'chore: refresh daily token usage\n',
      hint: 'Check the repository Git author and committer identity if commit creation fails.',
    });
    git('push the usage commit to origin/main', [
      '-c', 'remote.origin.mirror=false', 'push', '--no-force', '--no-follow-tags', '--recurse-submodules=no',
      'origin', `${commit}:refs/heads/main`,
    ], { hint: 'origin/main may have advanced, or authentication/branch permissions may reject the push. No force-push or automatic retry was attempted.' });
    return { published: true, commit };
  } catch (error) {
    publicationError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    try {
      git('remove the private fetch reference', ['update-ref', '-d', privateRef]);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await rm(temporaryDirectory, { recursive: true, force: true });
    } catch {
      cleanupErrors.push(new Error('Usage publication could not remove its private temporary index directory.'));
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        publicationError ? [publicationError, ...cleanupErrors] : cleanupErrors,
        `${publicationError ? `${publicationError.message} ` : ''}Usage publication could not clean up its private temporary artifacts.`,
      );
    }
  }
}
