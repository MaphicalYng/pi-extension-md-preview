#!/usr/bin/env node
/**
 * Type-check helper.
 *
 * Host-provided packages (@earendil-works/*, typebox) are declared as
 * peerDependencies and never installed into node_modules. To type-check against
 * the real Pi API, this script links the host Pi installation into types/host/
 * and then runs `tsc --noEmit`. The link directory is only consulted by
 * TypeScript (see tsconfig.json `paths`); the runtime uses Pi's own module
 * mapping, so no duplicate module instances can occur.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readlinkSync, rmSync, symlinkSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostDir = join(root, "types", "host");

function findPiRoot() {
	// 1. Explicit override
	if (process.env.PI_INSTALL_ROOT && existsSync(process.env.PI_INSTALL_ROOT)) {
		return process.env.PI_INSTALL_ROOT;
	}
	// 2. Resolve through the `pi` binary on PATH
	try {
		const bin = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
		if (bin) {
			let target = bin;
			try {
				target = readlinkSync(bin);
			} catch {
				/* not a symlink */
			}
			if (!target.startsWith("/")) target = join(dirname(bin), target);
			// .../bin/pi -> .../lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
			const candidate = resolve(dirname(target), "..", "..", "..", "..");
			if (existsSync(join(candidate, "package.json"))) return candidate;
		}
	} catch {
		/* fall through */
	}
	// 3. npm global root
	try {
		const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
		const candidate = join(globalRoot, "@earendil-works", "pi-coding-agent");
		if (existsSync(join(candidate, "package.json"))) return candidate;
	} catch {
		/* fall through */
	}
	return null;
}

const piRoot = findPiRoot();
if (!piRoot) {
	console.error("check: could not locate a Pi installation. Set PI_INSTALL_ROOT to the pi-coding-agent package directory.");
	process.exit(1);
}

mkdirSync(hostDir, { recursive: true });

const links = [
	["pi-coding-agent", piRoot],
	["typebox", join(piRoot, "node_modules", "typebox")],
	["pi-ai", join(piRoot, "node_modules", "@earendil-works", "pi-ai")],
];

for (const [name, target] of links) {
	if (!existsSync(join(target, "package.json"))) continue;
	const linkPath = join(hostDir, name);
	try {
		if (statSync(linkPath).isDirectory() || statSync(linkPath).isSymbolicLink()) {
			if (readlinkSync(linkPath) === target) continue;
			rmSync(linkPath, { recursive: true, force: true });
		}
	} catch {
		/* does not exist yet */
	}
	symlinkSync(target, linkPath, "dir");
}

console.log(`check: host types linked from ${piRoot}`);
const result = spawnSync(join(root, "node_modules", ".bin", "tsc"), ["--noEmit"], {
	cwd: root,
	stdio: "inherit",
});
process.exit(result.status ?? 1);
