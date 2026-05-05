#!/usr/bin/env node
// Synchronize @gaunt-sloth/* package versions across the monorepo.
//
// `npm run release:bump`              — apply release.json to all synced packages
// `npm run release:bump -- 0.0.7`     — set release.json AND apply
//
// SYNCED packages (core, tools, api, review) all carry the same version and
// pin each other exactly. The user-facing assistant CLI keeps its own version
// — only its dep pins on the synced set are rewritten.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SCOPE = '@gaunt-sloth';
const SYNCED = ['tools', 'core', 'api', 'review'];

const release = JSON.parse(readFileSync(join(ROOT, 'release.json'), 'utf8'));
const cliVersion = process.argv[2];
if (cliVersion) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(cliVersion)) {
    console.error(`Bad version: ${cliVersion}. Expected MAJOR.MINOR.PATCH[-prerelease].`);
    process.exit(1);
  }
  release.version = cliVersion;
  writeFileSync(join(ROOT, 'release.json'), JSON.stringify(release, null, 2) + '\n');
}
const target = release.version;
console.log(`Syncing ${SCOPE}/* to ${target}`);

function readPkg(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}
function writePkg(rel, obj) {
  writeFileSync(join(ROOT, rel), JSON.stringify(obj, null, 2) + '\n');
}
function rewriteSyncedDeps(deps) {
  if (!deps) return false;
  let changed = false;
  for (const k of Object.keys(deps)) {
    if (!k.startsWith(`${SCOPE}/`)) continue;
    const internal = k.slice(SCOPE.length + 1);
    if (SYNCED.includes(internal) && deps[k] !== target) {
      deps[k] = target;
      changed = true;
    }
  }
  return changed;
}

for (const name of SYNCED) {
  const path = `packages/${name}/package.json`;
  const pkg = readPkg(path);
  const before = pkg.version;
  pkg.version = target;
  rewriteSyncedDeps(pkg.dependencies);
  rewriteSyncedDeps(pkg.peerDependencies);
  writePkg(path, pkg);
  console.log(`  ${name.padEnd(8)} ${before} → ${target}`);
}

const assistantPath = 'packages/assistant/package.json';
const assistant = readPkg(assistantPath);
const assistantChanged = rewriteSyncedDeps(assistant.dependencies);
if (assistantChanged) {
  writePkg(assistantPath, assistant);
  console.log(`  assistant deps → ${target} (own version ${assistant.version} unchanged)`);
} else {
  console.log(`  assistant deps already at ${target}`);
}
