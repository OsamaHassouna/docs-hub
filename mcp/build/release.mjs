#!/usr/bin/env node
// One-command release prep for email-playbook-mcp.
//
//   npm run release -- patch        # 0.6.2 -> 0.6.3
//   npm run release -- minor        # 0.6.2 -> 0.7.0
//   npm run release -- major        # 0.6.2 -> 1.0.0
//   npm run release -- 0.7.1        # explicit version
//   npm run release -- patch --dry  # preview, write nothing
//
// What it does, in order:
//   1. Computes the next version from mcp/package.json.
//   2. Writes it into mcp/package.json.
//   3. Rewrites CHANGELOG.md: the "## [Unreleased]" section becomes
//      "## [x.y.z] — YYYY-MM-DD", a fresh empty [Unreleased] is inserted
//      above it, and the compare-link footer is updated.
//   4. Regenerates server.json (via gen-meta) so the manifest version matches.
//   5. Stages those files (git add) — but does NOT commit or tag.
//
// What it does NOT do (deliberately, these are explicit human/owner steps):
//   - git commit, git tag, git push, npm publish, mcp-publisher publish.
// It prints the exact follow-up commands at the end so nothing irreversible
// happens without an explicit keystroke.
//
// NOTE: this bumps the PACKAGE release version only. The content-schema
// version (SPEC_VERSION in mcp/build/extract.mjs, currently 1.0.0) is a
// separate axis and is intentionally left untouched.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const PKG = root('../package.json');
const CHANGELOG = root('../../CHANGELOG.md');

const args = process.argv.slice(2);
const dry = args.includes('--dry') || args.includes('--dry-run');
const bumpArg = args.find((a) => !a.startsWith('--'));

if (!bumpArg) {
	console.error('Usage: npm run release -- <patch|minor|major|x.y.z> [--dry]');
	process.exit(2);
}

function nextVersion(current, bump) {
	if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
	const [maj, min, pat] = current.split('.').map(Number);
	if (bump === 'major') return `${maj + 1}.0.0`;
	if (bump === 'minor') return `${maj}.${min + 1}.0`;
	if (bump === 'patch') return `${maj}.${min}.${pat + 1}`;
	console.error(`Unknown bump "${bump}". Use patch | minor | major | x.y.z.`);
	process.exit(2);
}

const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const current = pkg.version;
const next = nextVersion(current, bumpArg);
const today = new Date().toISOString().slice(0, 10);
const repo = (pkg.repository && pkg.repository.url ? pkg.repository.url : '')
	.replace(/^git\+/, '').replace(/\.git$/, '');

console.log(`Release: ${current} -> ${next}${dry ? '  (dry run)' : ''}`);

// --- 1/2. package.json version ---
pkg.version = next;
const pkgOut = JSON.stringify(pkg, null, 2) + '\n';

// --- 3. CHANGELOG ---
const changelog = readFileSync(CHANGELOG, 'utf8');
if (!changelog.includes('## [Unreleased]')) {
	console.error('CHANGELOG.md has no "## [Unreleased]" section — aborting.');
	process.exit(1);
}
const freshUnreleased = '## [Unreleased]\n\n';
const newChangelog = changelog
	.replace('## [Unreleased]\n', `${freshUnreleased}## [${next}] — ${today}\n`)
	// Update / insert the compare links at the bottom.
	.replace(
		/\[Unreleased\]: .*$/m,
		`[Unreleased]: ${repo}/compare/v${next}...HEAD\n[${next}]: ${repo}/compare/v${current}...v${next}`,
	);

if (dry) {
	console.log('\n--- package.json (version) ---');
	console.log(`  "version": "${next}"`);
	console.log('\n--- CHANGELOG.md (top) ---');
	console.log(newChangelog.split('\n').slice(0, 12).join('\n'));
	console.log('\nDry run — nothing written, no tag created.');
	process.exit(0);
}

writeFileSync(PKG, pkgOut);
writeFileSync(CHANGELOG, newChangelog);
console.log('  package.json + CHANGELOG.md updated.');

// --- 4. regenerate server.json from the bumped version ---
execSync('node mcp/build/gen-meta.mjs', { cwd: root('../..'), stdio: 'inherit' });

// --- 5. stage + annotated tag ---
const toStage = ['mcp/package.json', 'CHANGELOG.md', 'server.json'];
execSync(`git add ${toStage.join(' ')}`, { cwd: root('../..'), stdio: 'inherit' });
console.log(`  staged: ${toStage.join(', ')}`);

console.log(`\nNext steps (run when ready — none are automatic):`);
console.log(`  git commit -m "Release v${next}"`);
console.log(`  git tag -a v${next} -m "v${next}"`);
console.log(`  git push && git push --tags`);
console.log(`  cd mcp && npm publish        # publishes to npm`);
console.log(`  mcp-publisher publish        # updates the MCP Registry (from repo root)`);
