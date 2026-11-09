#!/usr/bin/env node
// Builds the static site into dist/:
//
//   dist/snap/          the Snap! release SNAP_VERSION, unchanged, plus the
//                       Calliope mini library in snap/libraries/ (calliope.js,
//                       calliope_module.xml, calliope/template.xml) and its
//                       entry in snap/libraries/LIBRARIES.json
//   dist/campus.html    Snap! for Calliope Campus (pages/campus.html)
//   dist/render.html    preview pictures (pages/render.html)
//   dist/bridge/        the scripts of both pages
//   dist/index.html     forwards to campus.html
//
// The release is downloaded once from GitHub into .cache/. Files larger than
// Cloudflare Pages accepts (25 MiB, the Snap! manual) are left out.
//
//   node scripts/build.mjs           (or: npm run build)
//   SNAP_VERSION=12.3.10 node scripts/build.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const SNAP_VERSION = process.env.SNAP_VERSION || pkg.snapVersion;
const CACHE = path.join(ROOT, '.cache');
const DIST = path.join(ROOT, 'dist');
const SNAP = path.join(DIST, 'snap');
const MAX_FILE = 25 * 1024 * 1024;

async function download(url, target) {
	console.log(`downloading ${url}`);
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	const tmp = `${target}.part`;
	fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
	fs.renameSync(tmp, target);
}

async function snapRelease() {
	const dir = path.join(CACHE, `Snap-${SNAP_VERSION}`);
	if (fs.existsSync(path.join(dir, 'snap.html'))) return dir;
	fs.mkdirSync(CACHE, { recursive: true });
	const archive = path.join(CACHE, `Snap-${SNAP_VERSION}.tar.gz`);
	if (!fs.existsSync(archive)) {
		await download(
			`https://github.com/jmoenig/Snap/archive/refs/tags/v${SNAP_VERSION}.tar.gz`,
			archive
		);
	}
	console.log(`unpacking ${path.basename(archive)}`);
	// the archive holds one folder, Snap-<version>/; relative paths keep
	// Windows' tar from reading "D:" as a remote host
	execFileSync('tar', ['-xzf', path.basename(archive)], { cwd: CACHE, stdio: 'inherit' });
	if (!fs.existsSync(path.join(dir, 'snap.html'))) {
		throw new Error(`unexpected archive layout, ${dir}/snap.html missing`);
	}
	return dir;
}

function copyTree(from, to, skipped) {
	fs.mkdirSync(to, { recursive: true });
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		const src = path.join(from, entry.name);
		const dst = path.join(to, entry.name);
		if (entry.isDirectory()) {
			copyTree(src, dst, skipped);
		} else if (fs.statSync(src).size > MAX_FILE) {
			skipped.push(src);
		} else {
			fs.copyFileSync(src, dst);
		}
	}
}

// The <script src="src/..."> tags of snap.html, in order: Snap!'s own code.
// Its inline scripts (startup, service worker, tracking) are not taken.
function snapScripts(snapHtml) {
	const tags = snapHtml.match(/^\s*<script src="src\/[^"]+"><\/script>\s*$/gm);
	if (!tags || tags.length < 10) {
		throw new Error('snap.html: Snap! scripts not found');
	}
	return tags.map((t) => t.replace(/\s+$/, '')).join('\n');
}

function page(name, scripts) {
	const html = fs.readFileSync(path.join(ROOT, 'pages', name), 'utf8');
	if (!html.includes('<!-- SNAP_SCRIPTS -->')) {
		throw new Error(`pages/${name}: <!-- SNAP_SCRIPTS --> missing`);
	}
	fs.writeFileSync(path.join(DIST, name), html.replace('<!-- SNAP_SCRIPTS -->', scripts));
}

function registerLibrary() {
	const file = path.join(SNAP, 'libraries', 'LIBRARIES.json');
	const libs = JSON.parse(fs.readFileSync(file, 'utf8')).filter(
		(l) => l.fileName !== 'calliope_module.xml'
	);
	libs.push({
		fileName: 'calliope_module.xml',
		name: 'Calliope mini',
		description:
			'Control a Calliope mini in Calliope Campus, connected there over ' +
			'Bluetooth or USB. Needs the Blocks program on the Calliope mini.',
		categories: ['Calliope mini'],
		translations: {
			de: {
				name: 'Calliope mini',
				description:
					'Steuere einen Calliope mini in Calliope Campus, dort über ' +
					'Bluetooth oder USB verbunden. Auf dem Calliope mini muss das ' +
					'Blocks-Programm laufen.'
			}
		}
	});
	fs.writeFileSync(file, JSON.stringify(libs, null, 2) + '\n');
}

async function main() {
	if (!SNAP_VERSION) throw new Error('package.json: snapVersion missing');
	const release = await snapRelease();

	fs.rmSync(DIST, { recursive: true, force: true });
	const skipped = [];
	copyTree(release, SNAP, skipped);
	for (const file of skipped) {
		console.log(`left out (over 25 MiB): ${path.relative(release, file)}`);
	}

	// the library, where Snap! trusts extensions without asking
	const lib = path.join(SNAP, 'libraries');
	fs.mkdirSync(path.join(lib, 'calliope'), { recursive: true });
	fs.copyFileSync(path.join(ROOT, 'calliope', 'calliope.js'), path.join(lib, 'calliope', 'calliope.js'));
	fs.copyFileSync(path.join(ROOT, 'calliope', 'template.xml'), path.join(lib, 'calliope', 'template.xml'));
	fs.copyFileSync(path.join(ROOT, 'calliope', 'calliope_module.xml'), path.join(lib, 'calliope_module.xml'));
	registerLibrary();

	const scripts = snapScripts(fs.readFileSync(path.join(release, 'snap.html'), 'utf8'));
	page('campus.html', scripts);
	page('render.html', scripts);
	copyTree(path.join(ROOT, 'bridge'), path.join(DIST, 'bridge'), []);
	fs.copyFileSync(path.join(ROOT, 'pages', 'index.html'), path.join(DIST, 'index.html'));
	fs.writeFileSync(
		path.join(DIST, 'version.json'),
		JSON.stringify({ snap: SNAP_VERSION, build: new Date().toISOString() }, null, 2) + '\n'
	);
	console.log(`built Snap! ${SNAP_VERSION} with the Calliope mini library into dist/`);
}

main().catch((err) => {
	console.error(err.message || err);
	process.exit(1);
});
