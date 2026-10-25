#!/usr/bin/env node
/**
 * Regression check: the preview server must be restartable.
 *
 * Reproduces the ERR_CONNECTION_REFUSED bug: after the preview server
 * auto-exits (tab closed / never opened), a later `md_preview` call must boot a
 * fresh server. The stale singleton once returned the dead instance, so the
 * tool handed out the closed port and the browser refused the connection.
 *
 *   node scripts/restart-check.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, ".demo", "build");
const serverJs = join(buildDir, "server.js");

// Compile the host-independent modules the same way scripts/demo.mjs does.
if (!existsSync(serverJs)) {
	execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.demo.json"], {
		cwd: root,
		stdio: "inherit",
	});
}
// Mark the compiled output as CommonJS (root package.json is type: module).
writeFileSync(join(buildDir, "package.json"), '{"type":"commonjs"}\n', "utf8");

const require = createRequire(import.meta.url);
const { createPreviewServerManager } = require(serverJs);
const servers = createPreviewServerManager();

const report = join(root, ".demo", "restart-check.md");
if (!existsSync(report)) writeFileSync(report, "# restart-check\n\n生命周期回归测试用文档。\n", "utf8");

const failures = [];

/* 1. First preview round (like the first md_preview call). */
const s1 = await servers.ensure();
const h1 = await s1.openDocument(report, { cwd: root });
const r1 = await fetch(h1.url);
if (!r1.ok) failures.push(`第一轮 GET ${h1.url} -> ${r1.status}`);

/* 2. The server auto-exits after the tab goes away (all viewers closed, 8s). */
await s1.shutdown("restart-check: 模拟标签页关闭后自动退出");

/* 3. Second preview round (like a later md_preview call in the same session). */
const s2 = await servers.ensure();
if (s2 === s1) failures.push("shutdown 后 ensure() 返回了同一个已关闭实例");
const h2 = await s2.openDocument(report, { cwd: root });
try {
	const r2 = await fetch(h2.url);
	if (!r2.ok) failures.push(`第二轮 GET ${h2.url} -> ${r2.status}`);
} catch (err) {
	failures.push(`第二轮 GET ${h2.url} 连接失败（浏览器会报 ERR_CONNECTION_REFUSED）：${String(err)}`);
}
if (servers.current() !== s2) failures.push("current() 未指向新实例");

/* 4. Two managers (two factories: e.g. OMP parent and child sessions) stay isolated. */
const parent = createPreviewServerManager();
const child = createPreviewServerManager();
const ps = await parent.ensure();
const cs = await child.ensure();
if (ps === cs) failures.push("不同 manager.ensure() 返回了同一个服务器实例");
const ph = await ps.openDocument(report, { cwd: root });
const ch = await cs.openDocument(report, { cwd: root });
if (new URL(ph.url).port === new URL(ch.url).port) failures.push("父/子 manager 使用了同一个端口");
if (new URL(ph.url).searchParams.get("token") === new URL(ch.url).searchParams.get("token")) {
	failures.push("父/子 manager 使用了同一个 token");
}
await ps.shutdown("restart-check: 模拟父会话关闭");
try {
	const cr = await fetch(ch.url);
	if (!cr.ok) failures.push(`父服务器关闭后子预览 GET ${ch.url} -> ${cr.status}`);
} catch (err) {
	failures.push(`父服务器关闭后子预览连接失败：${String(err)}`);
}
if (child.current() !== cs || !cs.isOpen) failures.push("父会话 shutdown 影响了子 manager 的服务器");
await cs.shutdown("restart-check: 子会话关闭");

await s2.shutdown("restart-check 完成");

if (failures.length) {
	console.error("restart-check 失败：");
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
console.log("restart-check 通过：服务退出后可重新拉起新实例并正常响应。");
