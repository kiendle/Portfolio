import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { publishUsage } from './publish-usage.mjs';
import { findExecutable } from './usage-common.mjs';

const gitExecutable = findExecutable('git');
const publicationModule = new URL('./publish-usage.mjs', import.meta.url).href;
const fixtureEnvironment = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
};

function git(repository, args, input) {
  const result = spawnSync(gitExecutable, args, {
    cwd: repository,
    env: fixtureEnvironment,
    shell: false,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    input,
  });
  assert.ok(!result.error && result.status === 0, `Fixture git ${args[0]} failed (${result.error?.code || result.signal || result.status}).`);
  return result.stdout.trim();
}

function snapshot(inputTokens = 20) {
  return {
    updatedAt: '2026-10-31T13:00:00.000Z',
    timeZone: 'America/New_York',
    days: [{
      date: '2026-10-31',
      inputTokens,
      outputTokens: 3,
      cacheCreationTokens: 4,
      cacheReadTokens: 5,
      totalTokens: inputTokens + 12,
    }],
  };
}

async function configure(repository, hooks) {
  await mkdir(hooks, { recursive: true });
  for (const [key, value] of [
    ['user.name', 'Usage Fixture'],
    ['user.email', 'usage-fixture@example.test'],
    ['core.hooksPath', hooks],
    ['core.fsmonitor', 'false'],
    ['commit.gpgSign', 'false'],
    ['tag.gpgSign', 'false'],
    ['push.gpgSign', 'false'],
    ['protocol.allow', 'never'],
    ['protocol.file.allow', 'always'],
    ['credential.helper', ''],
  ]) {
    git(repository, ['config', '--local', key, value]);
  }
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'portfolio-usage-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.git');
  const working = join(root, 'working');
  const hooks = join(root, 'working-hooks');
  const originHooks = join(root, 'origin-hooks');
  git(root, ['init', '--bare', '--initial-branch=main', origin]);
  await configure(origin, originHooks);
  git(root, ['init', '--initial-branch=main', working]);
  await configure(working, hooks);
  git(working, ['remote', 'add', 'origin', origin]);
  await mkdir(join(working, 'src/data'), { recursive: true });
  await writeFile(join(working, 'src/data/usage.json'), `${JSON.stringify(snapshot(1), null, 2)}\n`);
  await writeFile(join(working, 'application.txt'), 'Original public application\n');
  git(working, ['add', 'application.txt', 'src/data/usage.json']);
  git(working, ['commit', '-m', 'Initial public state']);
  git(working, ['branch', 'release']);
  git(working, ['push', 'origin', 'refs/heads/main:refs/heads/main', 'refs/heads/release:refs/heads/release']);
  const initial = git(working, ['rev-parse', 'HEAD']);
  git(working, ['checkout', '-b', 'feature/private-work']);

  await writeFile(join(working, 'private-notes.txt'), 'PRIVATE_STAGED_NOTES\n');
  git(working, ['add', 'private-notes.txt']);
  await writeFile(join(working, 'private-notes.txt'), 'PRIVATE_STAGED_NOTES\nPRIVATE_UNSTAGED_NOTES\n');
  await writeFile(join(working, '.env.private'), 'PRIVATE_ENVIRONMENT_VALUE\n');
  await writeFile(join(working, 'application.txt'), 'Uncommitted private application work\n');
  await writeFile(join(working, 'src/data/usage.json'), '{"privatePrompt":"PRIVATE_LOCAL_USAGE_SOURCE"}\n');
  const fetchHead = resolve(working, git(working, ['rev-parse', '--git-path', 'FETCH_HEAD']));
  await writeFile(fetchHead, 'Unrelated user fetch state\n');
  return { root, origin, working, hooks, originHooks, initial, fetchHead };
}

async function otherCheckout(value, name) {
  const checkout = join(value.root, name);
  git(value.root, ['-c', `core.hooksPath=${value.hooks}`, 'clone', '--no-hardlinks', value.origin, checkout]);
  await configure(checkout, join(value.root, `${name}-hooks`));
  return checkout;
}

async function workingState(value) {
  const paths = ['application.txt', 'src/data/usage.json', 'private-notes.txt', '.env.private'];
  const index = resolve(value.working, git(value.working, ['rev-parse', '--git-path', 'index']));
  return {
    branch: git(value.working, ['symbolic-ref', '--short', 'HEAD']),
    head: git(value.working, ['rev-parse', 'HEAD']),
    status: git(value.working, ['status', '--porcelain=v1', '--untracked-files=all']),
    index: await readFile(index),
    fetchHead: await readFile(value.fetchHead),
    files: await Promise.all(paths.map((path) => readFile(join(value.working, path)))),
  };
}

function assertPrivateRefsRemoved(value) {
  assert.equal(git(value.working, ['for-each-ref', '--format=%(refname)', 'refs/usage-publication/']), '');
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function hook(path, source) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/bin/sh\n${source}\n`);
  await chmod(path, 0o700);
}

test('publishes only sanitized usage onto latest main without touching private working state', async (t) => {
  const value = await fixture(t);
  const upstream = await otherCheckout(value, 'upstream');
  await writeFile(join(upstream, 'application.txt'), 'New upstream public application\n');
  await writeFile(join(upstream, 'upstream-code.txt'), 'Additional upstream code\n');
  git(upstream, ['add', 'application.txt', 'upstream-code.txt']);
  git(upstream, ['commit', '-m', 'New upstream code']);
  git(upstream, ['push', 'origin', 'main']);
  const upstreamCommit = git(upstream, ['rev-parse', 'HEAD']);

  git(value.working, ['tag', '-a', 'local-private-tag', '-m', 'PRIVATE_LOCAL_TAG_METADATA']);
  git(value.working, ['config', '--local', 'push.followTags', 'true']);
  const before = await workingState(value);
  const approved = snapshot();
  const supplied = {
    ...approved,
    sessions: [{ prompt: 'PRIVATE_SESSION_PROMPT', model: 'PRIVATE_MODEL_NAME' }],
    project: { path: '/private/project' },
    days: approved.days.map((day) => ({ ...day, sessionId: 'PRIVATE_SESSION_ID', privateMetadata: { key: 'PRIVATE_DAY_KEY' } })),
  };

  const result = await publishUsage(supplied, { repository: value.working });
  assert.equal(result.published, true);
  assert.match(result.commit, /^[a-f0-9]{40,64}$/);
  assert.equal(git(value.origin, ['rev-parse', 'refs/heads/main']), result.commit);
  assert.equal(git(value.origin, ['rev-parse', `${result.commit}^`]), upstreamCommit);
  assert.equal(git(value.origin, ['diff-tree', '--no-commit-id', '--name-only', '-r', result.commit]), 'src/data/usage.json');
  assert.equal(git(value.origin, ['show', `${result.commit}:application.txt`]), 'New upstream public application');
  assert.equal(git(value.origin, ['show', `${result.commit}:upstream-code.txt`]), 'Additional upstream code');
  const publicJson = git(value.origin, ['show', `${result.commit}:src/data/usage.json`]);
  assert.equal(`${publicJson}\n`, `${JSON.stringify(approved, null, 2)}\n`);
  const expectedBlob = git(value.origin, ['hash-object', '--stdin'], `${JSON.stringify(approved, null, 2)}\n`);
  assert.equal(git(value.origin, ['rev-parse', `${result.commit}:src/data/usage.json`]), expectedBlob);
  assert.ok(!publicJson.includes('PRIVATE_'));
  assert.equal(git(value.origin, ['rev-parse', 'refs/heads/release']), value.initial);
  assert.equal(git(value.origin, ['for-each-ref', '--format=%(refname)', 'refs/heads/']), 'refs/heads/main\nrefs/heads/release');
  assert.equal(git(value.origin, ['for-each-ref', '--format=%(refname)', 'refs/tags/']), '');
  assert.deepEqual(await workingState(value), before);
  assertPrivateRefsRemoved(value);

  const repeated = await publishUsage({ ...supplied, privateMetadata: { prompt: 'ANOTHER_PRIVATE_PROMPT' } }, { repository: value.working });
  assert.deepEqual(repeated, { published: false });
  assert.equal(git(value.origin, ['rev-parse', 'refs/heads/main']), result.commit);
  assert.deepEqual(await workingState(value), before);
  assertPrivateRefsRemoved(value);
});

test('rejects private objects in approved fields and invalid counters before publication', async (t) => {
  const value = await fixture(t);
  const before = await workingState(value);
  const approved = snapshot();
  const invalid = [
    { ...approved, updatedAt: { prompt: 'PRIVATE_INVALID_METADATA' } },
    { ...approved, timeZone: { prompt: 'PRIVATE_INVALID_METADATA' } },
    { ...approved, days: [{ ...approved.days[0], date: { prompt: 'PRIVATE_INVALID_METADATA' } }] },
    { ...approved, days: [{ ...approved.days[0], inputTokens: { prompt: 'PRIVATE_INVALID_METADATA' } }] },
    { ...approved, days: [{ ...approved.days[0], outputTokens: -1 }] },
    { ...approved, days: [{ ...approved.days[0], cacheCreationTokens: 1.5 }] },
    { ...approved, days: [{ ...approved.days[0], cacheReadTokens: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...approved, days: [{ ...approved.days[0], totalTokens: Number.NaN }] },
  ];
  for (const candidate of invalid) {
    await assert.rejects(publishUsage(candidate, { repository: value.working }), (error) => {
      assert.match(error.message, /invalid|aggregate/i);
      assert.ok(!error.message.includes('PRIVATE_INVALID_METADATA'));
      return true;
    });
  }
  assert.equal(git(value.origin, ['rev-parse', 'refs/heads/main']), value.initial);
  assert.deepEqual(await workingState(value), before);
  assertPrivateRefsRemoved(value);
});

test('requires an explicit repository instead of publishing from the caller checkout', async () => {
  await assert.rejects(publishUsage(snapshot()), /repository/i);
  await assert.rejects(publishUsage(snapshot(), {}), /repository/i);
});

test('a rejected push fails without changing remote or working state or exposing Git output', async (t) => {
  const value = await fixture(t);
  const before = await workingState(value);
  await hook(join(value.originHooks, 'pre-receive'), "printf '%s\\n' 'PRIVATE_SERVER_CREDENTIAL_OUTPUT' >&2\nexit 1");
  const invocation = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    `import { publishUsage } from ${JSON.stringify(publicationModule)};\ntry {\n  await publishUsage(JSON.parse(process.argv[1]), { repository: process.argv[2] });\n} catch (error) {\n  console.error(error.message);\n  process.exitCode = 1;\n}`,
    JSON.stringify(snapshot()),
    value.working,
  ], {
    cwd: value.root,
    env: fixtureEnvironment,
    shell: false,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(invocation.error, undefined);
  assert.equal(invocation.status, 1);
  assert.equal(invocation.stdout, '');
  assert.match(invocation.stderr, /push.*origin\/main/i);
  assert.ok(!invocation.stderr.includes('PRIVATE_SERVER_CREDENTIAL_OUTPUT'));
  assert.equal(git(value.origin, ['rev-parse', 'refs/heads/main']), value.initial);
  assert.deepEqual(await workingState(value), before);
  assertPrivateRefsRemoved(value);
});

test('a real concurrent upstream push wins without force or automatic retry', async (t) => {
  const value = await fixture(t);
  const competitor = await otherCheckout(value, 'competitor');
  await writeFile(join(competitor, 'application.txt'), 'Concurrent upstream application\n');
  git(competitor, ['add', 'application.txt']);
  git(competitor, ['commit', '-m', 'Concurrent upstream change']);
  const winner = git(competitor, ['rev-parse', 'HEAD']);
  const before = await workingState(value);
  await hook(join(value.hooks, 'pre-push'), [
    'unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_PREFIX',
    `exec ${shellQuote(gitExecutable)} -C ${shellQuote(competitor)} push origin refs/heads/main:refs/heads/main`,
  ].join('\n'));

  await assert.rejects(publishUsage(snapshot(), { repository: value.working }), /push.*origin\/main/i);
  assert.equal(git(value.origin, ['rev-parse', 'refs/heads/main']), winner);
  assert.equal(git(value.origin, ['show', 'refs/heads/main:application.txt']), 'Concurrent upstream application');
  assert.equal(git(value.origin, ['show', 'refs/heads/main:src/data/usage.json']), JSON.stringify(snapshot(1), null, 2));
  assert.equal(git(value.origin, ['rev-parse', 'refs/heads/release']), value.initial);
  assert.deepEqual(await workingState(value), before);
  assertPrivateRefsRemoved(value);
});
