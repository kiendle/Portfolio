import { spawnSync } from 'node:child_process';
import { access, chmod, mkdir, open, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { executablePathEnvironment, findExecutable, repositoryRoot, resolveTimeZone } from './usage-common.mjs';

const label = 'local.kien-portfolio.usage';
const plistPath = resolve(homedir(), 'Library/LaunchAgents', `${label}.plist`);
const logDirectory = resolve(homedir(), 'Library/Logs/PortfolioUsage');
const launchctl = '/bin/launchctl';

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function calendarNumber(value, fallback, maximum, name) {
  const text = value ?? String(fallback);
  if (!/^\d+$/.test(text) || Number(text) > maximum) {
    throw new Error(`${name} must be an integer between 0 and ${maximum}.`);
  }
  return Number(text);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function runLaunchctl(arguments_) {
  const result = spawnSync(launchctl, arguments_, { shell: false, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    throw new Error(`launchctl ${arguments_[0]} failed: ${result.error?.message || result.stderr.trim() || `exit ${result.status}`}`);
  }
  return result;
}

async function install(values) {
  if (await exists(plistPath)) {
    throw new Error(`A scheduler already exists at ${plistPath}. Run --uninstall before changing its configuration.`);
  }

  const hour = calendarNumber(values.hour, 9, 23, '--hour');
  const minute = calendarNumber(values.minute, 0, 59, '--minute');
  const timeZone = resolveTimeZone(values.timezone);
  const checkout = await realpath(repositoryRoot);
  const node = await realpath(process.execPath);
  const ccusage = findExecutable(process.env.CCUSAGE_BIN || 'ccusage');
  const npm = findExecutable(process.env.NPM_BIN || 'npm');
  const git = findExecutable('git');
  if (!(await exists(resolve(checkout, 'node_modules/astro/package.json')))) {
    throw new Error('Install the project dependencies before scheduling the daily build; see README.md.');
  }

  const environment = {
    HOME: homedir(),
    PATH: executablePathEnvironment(node, npm, ccusage, git),
    CCUSAGE_BIN: ccusage,
    NPM_BIN: npm,
    USAGE_TIME_ZONE: timeZone,
    ASTRO_TELEMETRY_DISABLED: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  const environmentXml = Object.entries(environment).map(([key, value]) => `    <key>${xml(key)}</key><string>${xml(value)}</string>`).join('\n');
  const stdoutPath = resolve(logDirectory, 'stdout.log');
  const stderrPath = resolve(logDirectory, 'stderr.log');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(resolve(checkout, 'scripts/refresh-usage.mjs'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(checkout)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key><string>${xml(stderrPath)}</string>
</dict>
</plist>
`;

  await mkdir(resolve(homedir(), 'Library/LaunchAgents'), { recursive: true });
  await mkdir(logDirectory, { recursive: true, mode: 0o700 });
  await chmod(logDirectory, 0o700);
  for (const path of [stdoutPath, stderrPath]) {
    const handle = await open(path, 'a', 0o600);
    await handle.close();
    await chmod(path, 0o600);
  }
  await writeFile(plistPath, plist, { flag: 'wx', mode: 0o600 });
  try {
    runLaunchctl(['bootstrap', `gui/${process.getuid()}`, plistPath]);
  } catch (error) {
    await rm(plistPath, { force: true });
    throw error;
  }

  console.log(`Installed ${label}: daily at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} in the Mac's local wall-clock timezone.`);
  console.log(`Usage date grouping: ${timeZone}. Checkout: ${checkout}`);
  console.log(`Logs: ${logDirectory}`);
  console.log('RunAtLoad is off. This job collects local aggregates, builds dist/, then publishes only the sanitized usage snapshot to origin/main for Vercel deployment.');
}

async function uninstall() {
  const target = `gui/${process.getuid()}/${label}`;
  const service = spawnSync(launchctl, ['print', target], { shell: false, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (service.error) throw service.error;
  if (service.status === 0) {
    runLaunchctl(['bootout', target]);
  } else if (!service.stderr.includes('Could not find service') && !service.stderr.includes('No such process')) {
    throw new Error(`Could not inspect the scheduler: ${service.stderr.trim() || `exit ${service.status}`}`);
  }
  await rm(plistPath, { force: true });
  console.log(`Uninstalled ${label}. Existing private logs were retained at ${logDirectory}.`);
}

try {
  const { values } = parseArgs({ options: {
    install: { type: 'boolean' },
    uninstall: { type: 'boolean' },
    hour: { type: 'string' },
    minute: { type: 'string' },
    timezone: { type: 'string' },
    help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/install-usage-launchd.mjs --install [--hour 9] [--minute 0] [--timezone IANA]\n       node scripts/install-usage-launchd.mjs --uninstall\nExplicit opt-in; defaults to 09:00 daily: collect, build, then publish sanitized usage to origin/main for Vercel deployment.');
  } else {
    if (process.platform !== 'darwin') throw new Error('This scheduler installer requires macOS. Run refresh-usage.mjs manually elsewhere.');
    if (Boolean(values.install) === Boolean(values.uninstall)) throw new Error('Choose exactly one explicit action: --install or --uninstall.');
    if (values.uninstall && (values.hour !== undefined || values.minute !== undefined || values.timezone !== undefined)) {
      throw new Error('Scheduling options apply only to --install.');
    }
    if (values.install) await install(values);
    else await uninstall();
  }
} catch (error) {
  console.error(`Usage scheduler setup failed: ${error.message}`);
  process.exitCode = 1;
}
