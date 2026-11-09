#!/usr/bin/env node
/**
 * Runs this workspace's own Snap! for Calliope Campus on a free port, beside
 * other workspaces.
 *
 *   node .obeya/app.mjs start [port]   build dist/, serve it in the background on
 *                                      the first free port from 8620 (or [port]),
 *                                      print the URLs
 *   node .obeya/app.mjs stop           stop the server `start` started here
 *   node .obeya/app.mjs status         port, PID, URL and whether it still runs
 *
 * State goes to `.obeya/run/` (gitignored): app.json (url, campus, host, port,
 * pid) and serve.log. The server is detached, so it outlives the shell that started it;
 * `stop` ends it by PID and nothing else. Port 8610, where Campus' local editor
 * preset looks, is left to the main checkout unless asked for.
 *
 * The build downloads the Snap! release (~130 MB) into `.cache/` once. A fresh
 * worktree lacks it, so `start` first copies `.cache/` from the main checkout
 * when that has it.
 */
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const runDir = resolve(root, '.obeya', 'run');
const stateFile = resolve(runDir, 'app.json');
const win = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readState() {
	try {
		return JSON.parse(readFileSync(stateFile, 'utf8'));
	} catch {
		return null;
	}
}

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code === 'EPERM';
	}
}

function portFree(port) {
	return new Promise((done) => {
		const server = net.createServer();
		server.once('error', () => done(false));
		server.listen(port, () => server.close(() => done(true)));
	});
}

async function freePort(from) {
	for (let port = from; port < from + 100; port++) if (await portFree(port)) return port;
	throw new Error(`no free port from ${from}`);
}

function answers(url) {
	return new Promise((done) => {
		http.get(url, (res) => {
			res.resume();
			done(res.statusCode === 200);
		}).on('error', () => done(false));
	});
}

// the main checkout of a worktree: the parent of the shared .git directory
function mainCheckout() {
	try {
		const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
			cwd: root,
			encoding: 'utf8'
		}).trim();
		const dir = resolve(common, '..');
		return dir === root ? null : dir;
	} catch {
		return null;
	}
}

function copyCache() {
	if (existsSync(resolve(root, '.cache'))) return;
	const main = mainCheckout();
	if (!main || !existsSync(resolve(main, '.cache'))) return;
	console.log(`copying .cache/ from ${main}`);
	cpSync(resolve(main, '.cache'), resolve(root, '.cache'), { recursive: true });
}

async function start(wanted) {
	const state = readState();
	if (state && alive(state.pid)) {
		console.log(`already running: ${state.url} (pid ${state.pid})`);
		return;
	}
	copyCache();
	execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' });
	const port = wanted ? Number(wanted) : await freePort(8620);
	if (wanted && !(await portFree(port))) throw new Error(`port ${port} is taken`);
	mkdirSync(runDir, { recursive: true });
	const log = openSync(resolve(runDir, 'serve.log'), 'w');
	const child = spawn(process.execPath, ['scripts/serve.mjs', String(port)], {
		cwd: root,
		detached: true,
		windowsHide: true,
		stdio: ['ignore', log, log]
	});
	child.unref();
	const url = `http://localhost:${port}/`;
	const next = { url, campus: `${url}campus.html`, host: `${url}dev/host.html`, port, pid: child.pid };
	// scripts/serve.mjs writes its own app.json ({ url, pid }) once it listens:
	// write ours before, so `stop` finds the PID, and again after
	const save = () => writeFileSync(stateFile, JSON.stringify(next, null, '\t') + '\n');
	save();
	for (let i = 0; i < 50; i++) {
		if (await answers(next.campus)) {
			save();
			console.log(`Snap! for Campus: ${next.campus}\ntest host:        ${next.host}\npid ${child.pid}, log .obeya/run/serve.log`);
			return;
		}
		if (!alive(child.pid)) break;
		await sleep(200);
	}
	throw new Error('the server did not answer, see .obeya/run/serve.log');
}

function stop() {
	const state = readState();
	if (!state) return;
	if (alive(state.pid)) {
		try {
			if (win) execFileSync('taskkill', ['/PID', String(state.pid), '/T', '/F'], { stdio: 'ignore' });
			else process.kill(state.pid, 'SIGTERM');
			console.log(`stopped the server (${state.pid})`);
		} catch {}
	}
	rmSync(stateFile, { force: true });
}

function status() {
	const state = readState();
	if (!state) return console.log('not running');
	console.log(`${alive(state.pid) ? 'running' : 'not running'}: ${state.url} (pid ${state.pid}, port ${state.port})`);
}

const [command, arg] = process.argv.slice(2);
try {
	if (command === 'start') await start(arg);
	else if (command === 'stop') stop();
	else if (command === 'status') status();
	else {
		console.error('usage: node .obeya/app.mjs start [port] | stop | status');
		process.exit(2);
	}
} catch (e) {
	console.error(e.message);
	process.exit(1);
}
