#!/usr/bin/env node
// The build's version as BUILD.json holds it (docs/build-info.md), in the
// format calliope-mini-python-editor defines (its bin/build-info.js).
//
// The calliope-build workflow sets BUILD_CHANNEL, BUILD_VERSION, BUILD_COMMIT
// and BUILD_AT; scripts/build.mjs writes the object as dist/BUILD.json and as
// the constant window.SNAP_CALLIOPE_BUILD (dist/build-info.js), which the
// version line in the Snap! logo menu shows. Without those variables (a local
// `npm run build`) the channel is "local" and version and commit come from git.
//
//   node scripts/build-info.mjs        prints the object

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANNELS = ['live', 'dev', 'local'];

function git(...args) {
	try {
		return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return '';
	}
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} snapVersion the bundled Snap! release (package.json snapVersion)
 */
export function buildInfo(env = process.env, snapVersion = readSnapVersion()) {
	const channel = env.BUILD_CHANNEL || 'local';
	if (!CHANNELS.includes(channel)) {
		throw new Error(`BUILD_CHANNEL must be one of ${CHANNELS.join(', ')}, not "${channel}"`);
	}
	return {
		channel,
		// live: the tag (calliope-vX.Y.Z); dev: the branch (calliope-main).
		version: env.BUILD_VERSION || git('rev-parse', '--abbrev-ref', 'HEAD') || 'local',
		commit: env.BUILD_COMMIT || git('rev-parse', 'HEAD'),
		builtAt: env.BUILD_AT || new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
		// Snap! carries neither calliope-ui nor the connection widget.
		ui: null,
		widget: null,
		// The bundled Snap! release, as its tag in jmoenig/Snap.
		libs: snapVersion ? { snap: `v${snapVersion}` } : {}
	};
}

function readSnapVersion() {
	if (process.env.SNAP_VERSION) return process.env.SNAP_VERSION;
	const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
	return pkg.snapVersion;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.stdout.write(JSON.stringify(buildInfo(), null, 2) + '\n');
}
