import { accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const snapshotRelativePath = 'src/data/usage.json';
export const snapshotPath = resolve(repositoryRoot, snapshotRelativePath);

export function resolveTimeZone(value = process.env.USAGE_TIME_ZONE || Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (typeof value !== 'string' || !value.trim() || /^[+-]/.test(value)) {
    throw new Error('Provide an IANA timezone with --timezone or USAGE_TIME_ZONE.');
  }

  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`Invalid IANA timezone: ${value}`);
  }
}

export function findExecutable(command) {
  const candidates = isAbsolute(command) || command.includes('/')
    ? [resolve(repositoryRoot, command)]
    : (process.env.PATH || '').split(delimiter).filter(Boolean).map((directory) => resolve(directory, command));

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Try the next PATH entry, without invoking a shell.
    }
  }

  throw new Error(`Executable not found: ${command}. Set CCUSAGE_BIN or NPM_BIN to an absolute executable path if needed.`);
}

export function executablePathEnvironment(...executables) {
  return [...new Set([...executables.map(dirname), ...(process.env.PATH || '').split(delimiter).filter(Boolean)])].join(delimiter);
}
