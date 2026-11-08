#!/usr/bin/env node
// Serves dist/ for local development: http://localhost:8610/
// Calliope Campus points its "local" editor preset for Snap! here.
// /dev/ comes from the repository's dev/ folder: dev/host.html is a test
// host that embeds campus.html the way Campus does.
//
//   node scripts/serve.mjs [port]      (PORT=... works too)
//   node scripts/serve.mjs stop        ends the server this checkout started
//
// While it runs, .obeya/run/app.json holds its address (url) and pid.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(REPO, 'dist');
const RUN_FILE = path.join(REPO, '.obeya', 'run', 'app.json');

if (process.argv[2] === 'stop') {
	try {
		const { pid } = JSON.parse(fs.readFileSync(RUN_FILE, 'utf8'));
		process.kill(pid);
		console.log(`stopped the server (pid ${pid})`);
	} catch {
		// nothing running from this checkout
	}
	fs.rmSync(RUN_FILE, { force: true });
	process.exit(0);
}

const PORT = Number(process.argv[2] || process.env.PORT || 8610);

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.xml': 'text/xml; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.md': 'text/plain; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.wav': 'audio/wav',
	'.mp3': 'audio/mpeg',
	'.woff2': 'font/woff2'
};

if (!fs.existsSync(path.join(ROOT, 'campus.html'))) {
	console.error('dist/ is not built yet: npm run build');
	process.exit(1);
}

http
	.createServer((req, res) => {
		const url = new URL(req.url, 'http://localhost');
		const base = url.pathname.startsWith('/dev/') ? REPO : ROOT;
		let file = path.join(base, decodeURIComponent(url.pathname));
		if (!file.startsWith(base)) {
			res.writeHead(403).end();
			return;
		}
		if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
			file = path.join(file, 'index.html');
		}
		fs.readFile(file, (err, data) => {
			if (err) {
				res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
				return;
			}
			res.writeHead(200, {
				'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
				'cache-control': 'no-cache'
			});
			res.end(data);
		});
	})
	.listen(PORT, () => {
		const url = `http://localhost:${PORT}/`;
		fs.mkdirSync(path.dirname(RUN_FILE), { recursive: true });
		fs.writeFileSync(RUN_FILE, JSON.stringify({ url, pid: process.pid }, null, 2) + '\n');
		console.log(`Snap! for Calliope Campus: ${url}campus.html (test host: ${url}dev/host.html)`);
	});

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		fs.rmSync(RUN_FILE, { force: true });
		process.exit(0);
	});
}
