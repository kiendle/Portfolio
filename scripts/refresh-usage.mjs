import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { collectUsage } from './collect-usage.mjs';
import { findExecutable, repositoryRoot } from './usage-common.mjs';

try {
  const { values } = parseArgs({ options: { timezone: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: node scripts/refresh-usage.mjs [--timezone IANA]\nCollects local usage and rebuilds dist/. Never commits, pushes, or deploys.');
  } else {
    const npm = findExecutable(process.env.NPM_BIN || 'npm');
    await collectUsage({ timeZone: values.timezone });
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
    console.log('Local dist/ refreshed. No source publication or hosted deployment was performed.');
  }
} catch (error) {
  console.error(`Usage refresh failed: ${error.message}`);
  process.exitCode = 1;
}
