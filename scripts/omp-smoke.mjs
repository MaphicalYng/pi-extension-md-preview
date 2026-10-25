#!/usr/bin/env node
/**
 * Real-host smoke test for OMP: starts OMP in RPC mode with this extension, runs
 * `/md-preview`, checks the page and static assets, verifies the three tools are
 * registered as top-level (essential) tools, posts one page question to prove an
 * idle ask starts the agent, and confirms shutdown closes the port.
 *
 * No model answer is required: the question only has to start the turn, then the
 * run is aborted. `open` is shadowed so no real browser tab is launched, and
 * XDG_CONFIG_HOME is isolated so the developer's settings are untouched.
 *
 *   node scripts/omp-smoke.mjs
 *
 * Exits 0 (with a skip note) when OMP is not installed.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = spawnSync("omp", ["--version"], { stdio: "ignore" });
if (version.error?.code === "ENOENT") {
	console.log("omp-smoke skipped: `omp` is not installed.");
	process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "md-preview-omp-"));
const binDir = join(tmp, "bin");
const cfgDir = join(tmp, "config");
const openedFile = join(tmp, "opened.txt");
const failures = [];
const events = [];
let child = null;
let url = null;

/** Resolve on the first event matching `predicate`, or reject after `ms`. */
function waitFor(predicate, ms, label) {
	const found = events.find(predicate);
	if (found) return Promise.resolve(found);
	return new Promise((resolvePromise, reject) => {
		const started = Date.now();
		const timer = setInterval(() => {
			const hit = events.find(predicate);
			if (hit) {
				clearInterval(timer);
				resolvePromise(hit);
			} else if (Date.now() - started > ms) {
				clearInterval(timer);
				reject(new Error(`timed out waiting for ${label}`));
			}
		}, 50);
	});
}

try {
	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(binDir, "open"), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${openedFile}"\n`);
	chmodSync(join(binDir, "open"), 0o755);

	child = spawn(
		"omp",
		["--mode", "rpc", "--no-session", "--no-extensions", "--no-ui", "--auto-approve", "-e", "./extensions/md-preview/index.ts"],
		{
			cwd: root,
			env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, XDG_CONFIG_HOME: cfgDir },
			stdio: ["pipe", "pipe", "inherit"],
		},
	);
	const exited = new Promise((resolveExit) => child.on("exit", (code, signal) => resolveExit({ code, signal })));
	const send = (event) => child.stdin.write(JSON.stringify(event) + "\n");
	createInterface({ input: child.stdout }).on("line", (line) => {
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		events.push(event);
		if (event.type === "extension_error") failures.push(`extension_error: ${JSON.stringify(event).slice(0, 400)}`);
		if (event.type === "message_start" && typeof event.message?.content === "string" && !url) {
			url = event.message.content.match(/https?:\/\/[^\s>]+/)?.[0] ?? null;
		}
	});

	await waitFor((e) => e.type === "ready", 10_000, "OMP ready");
	send({ type: "get_state" });
	send({ type: "prompt", message: "/md-preview examples/feature-showcase.md" });

	// Commands.
	const commands = await waitFor((e) => e.type === "available_commands_update", 5_000, "available commands");
	const names = commands.commands.map((command) => command.name);
	if (!names.includes("md-preview")) failures.push("/md-preview is not registered");
	if (!names.includes("md-preview-host")) failures.push("/md-preview-host is not registered");

	// Tool exposure: top-level means OMP treats them as essential (not xd:// only).
	const state = await waitFor((e) => e.type === "response" && e.command === "get_state" && e.success, 5_000, "get_state");
	const toolNames = (state.data?.dumpTools ?? []).map((tool) => tool.name);
	for (const name of ["md_preview", "md_preview_reply", "md_preview_revision_done"]) {
		if (!toolNames.includes(name)) failures.push(`${name} is not a top-level OMP tool`);
	}

	// Preview page, assets and document route.
	await waitFor(() => url !== null, 15_000, "preview URL");
	if (!url) throw new Error("no preview URL was emitted");
	const pageUrl = new URL(url);
	const token = pageUrl.searchParams.get("token");
	const checks = [
		["page", url],
		["mermaid", new URL(`/mermaid.mjs?token=${token}`, pageUrl).toString()],
		["prefs", new URL(`/prefs?token=${token}`, pageUrl).toString()],
		["document", new URL(`/doc/d1?token=${token}`, pageUrl).toString()],
	];
	for (const [label, target] of checks) {
		const response = await fetch(target);
		const body = await response.text();
		if (response.status !== 200 || body.length === 0) failures.push(`${label} route: HTTP ${response.status}, ${body.length} bytes`);
	}

	// A page question must wake an idle session (the OMP bug this adaptation fixes).
	const ask = await fetch(new URL(`/doc/d1/ask?token=${token}`, pageUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ quote: "smoke", question: "Does an idle page question start the agent?" }),
	});
	if (ask.status !== 200) failures.push(`ask route: HTTP ${ask.status} ${await ask.text()}`);
	await waitFor((e) => e.type === "agent_start", 8_000, "agent_start after idle ask");
	send({ type: "abort" });

	// Shutdown closes the preview port.
	child.stdin.end();
	const exit = await Promise.race([exited, new Promise((r) => setTimeout(() => r(null), 10_000))]);
	if (exit === null) failures.push("OMP did not exit after stdin closed");
	else if (exit.code !== 0) failures.push(`OMP exited with code ${exit.code} signal ${exit.signal}`);
	let closed = false;
	try {
		await fetch(url);
	} catch {
		closed = true;
	}
	if (!closed) failures.push("preview port is still open after OMP exited");
} catch (error) {
	failures.push(error instanceof Error ? error.message : String(error));
} finally {
	if (child && child.exitCode === null) child.kill("SIGKILL");
	rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) {
	console.error("omp-smoke failed:");
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log("omp-smoke passed: commands, essential tools, page/assets, idle ask delivery and shutdown.");
console.log(`  preview: ${url}`);
