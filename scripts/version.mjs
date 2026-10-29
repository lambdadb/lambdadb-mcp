import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const core = String.raw`(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)`;
/** Versions that may be committed: the dev placeholder between releases, or an RC/stable release. */
export const COMMITTED_VERSION = new RegExp(`^${core}(?:-dev\\.0|-rc\\.([1-9]\\d*))?$`);
/** Versions that may be published: automatic dev builds, RCs and stable releases. */
export const PUBLISHED_VERSION = new RegExp(`^${core}(?:-(dev|rc)\\.([1-9]\\d*))?$`);
const STABLE_TAG = new RegExp(`^v${core}$`);

const read = (root, path) => readFileSync(join(root, path), 'utf8');

/** Read package.json and both root package-lock.json versions; throws unless all agree. */
export function readVersion(root) {
  const pkg = JSON.parse(read(root, 'package.json'));
  const lock = JSON.parse(read(root, 'package-lock.json'));
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    throw new Error('Version sources must agree: package.json and both root package-lock.json entries.');
  }
  return pkg.version;
}

// Replace one exact `"version": "<old>"` occurrence after `anchor`, keeping the file's formatting.
function replaceVersionField(text, old, version, anchor = '') {
  const start = anchor ? text.indexOf(anchor) : 0;
  const needle = `"version": "${old}"`;
  const index = start < 0 ? -1 : text.indexOf(needle, start);
  if (index < 0) throw new Error(`Cannot find ${needle}${anchor ? ` after ${anchor}` : ''}.`);
  return text.slice(0, index) + `"version": "${version}"` + text.slice(index + needle.length);
}

/** Set every version source to `version`, preserving formatting, and verify the result. */
export function setVersion(root, version, { allowed = COMMITTED_VERSION } = {}) {
  if (!allowed.test(version)) throw new Error(`Unsupported version ${version}.`);
  const old = readVersion(root);
  let lock = replaceVersionField(read(root, 'package-lock.json'), old, version);
  lock = replaceVersionField(lock, old, version, '"packages": {');
  const pkg = replaceVersionField(read(root, 'package.json'), old, version);
  writeFileSync(join(root, 'package.json'), pkg);
  writeFileSync(join(root, 'package-lock.json'), lock);
  if (readVersion(root) !== version) throw new Error('Version update did not reach every source.');
  return version;
}

export function parseVersion(version) {
  const match = PUBLISHED_VERSION.exec(version) ?? COMMITTED_VERSION.exec(version);
  if (!match) throw new Error(`Unsupported version ${version}.`);
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], text: `${match[1]}.${match[2]}.${match[3]}` };
}

export function compareCores(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** The newest stable release tag (`vX.Y.Z`) among `tags`, or undefined. */
export function latestStableTag(tags) {
  return tags.filter(tag => STABLE_TAG.test(tag))
    .sort((a, b) => compareCores(parseVersion(a.slice(1)).core, parseVersion(b.slice(1)).core)).at(-1);
}

/** The committed dev placeholder that follows a published RC (same version) or stable release (next patch). */
export function nextDevVersion(released) {
  if (/^\d+\.\d+\.\d+-rc\.[1-9]\d*$/.test(released)) return `${parseVersion(released).text}-dev.0`;
  if (!/^\d+\.\d+\.\d+$/.test(released)) throw new Error(`Expected an RC or stable version, got ${released}.`);
  const [major, minor, patch] = parseVersion(released).core;
  return `${major}.${minor}.${patch + 1}-dev.0`;
}

/**
 * Publish workflow run mode. A main push with the X.Y.Z-dev.0 placeholder publishes a dev build;
 * a main push with an RC/stable version (a release pull request merge) is verified without
 * publication; a GitHub Release publishes its RC/stable version.
 */
export function runMode({ event, ref, version }) {
  if (event === 'release') return 'release';
  if (event !== 'push' || ref !== 'refs/heads/main') throw new Error('Publication runs only for main pushes and GitHub Releases.');
  if (/-dev\.0$/.test(version) && COMMITTED_VERSION.test(version)) return 'dev';
  if (/-dev\./.test(version)) throw new Error(`Committed version ${version} must use the -dev.0 placeholder.`);
  if (!COMMITTED_VERSION.test(version)) throw new Error(`Unsupported committed version ${version}.`);
  return 'verify';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, value, ...rest] = process.argv.slice(2);
    if (command === 'get' && value === undefined) {
      console.log(readVersion(process.cwd()));
    } else if (command === 'set' && value && !rest.length) {
      console.log(setVersion(process.cwd(), value));
    } else if (command === 'next-dev' && value && !rest.length) {
      console.log(nextDevVersion(value));
    } else if (command === 'mode' && value === undefined) {
      const version = readVersion(process.cwd());
      const mode = runMode({ event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, version });
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
      console.log(`Committed version ${version}; run mode ${mode}`);
    } else {
      throw new Error('Usage: node scripts/version.mjs get | set <version> | next-dev <released-version> | mode');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
