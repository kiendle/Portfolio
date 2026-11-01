import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { collectUsage } from './collect-usage.mjs';
import { publishUsage } from './publish-usage.mjs';
import { findExecutable, repositoryRoot } from './usage-common.mjs';

try {
  const { values } = parseArgs({ options: { timezone: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: node scripts/refresh-usage.mjs [--timezone IANA]\nCollects local usage, rebuilds dist/, then publishes only the sanitized usage snapshot to origin/main for Vercel deployment.');
  } else {
    const npm = findExecutable(process.env.NPM_BIN || 'npm');
    const snapshot = await collectUsage({ timeZone: values.timezone });
    const build = spawnSync(npm, ['run', 'build'], {
      cwd: repositoryRoot,
      shell: false,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (build.error || build.status !== 0) {
      const reason = build.error?.message || (build.signal ? `signal ${build.signal}` : `exit ${build.status}`);
      throw new Error(`The local site build failed (${reason}). The successfully collected source snapshot was kept.`);
    }
    console.log('Local dist/ refreshed. Checking origin/main for sanitized usage publication.');
    const publication = await publishUsage(snapshot, { repository: repositoryRoot });
    if (publication.published) {
      console.log('Published sanitized src/data/usage.json to origin/main. Vercel handles production deployment.');
    } else {
      console.log('origin/main already has this sanitized usage snapshot. No commit, push, or new deployment was triggered.');
    }
  }
} catch (error) {
  console.error(`Usage refresh failed: ${error.message}`);
  process.exitCode = 1;
}
