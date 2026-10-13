/**
 * User-level preferences for the markdown preview (theme + font scale).
 *
 * Stored as JSON at $XDG_CONFIG_HOME/md-preview/settings.json (falling back
 * to ~/.config). Browser localStorage alone cannot do this job: it is keyed
 * by origin (127.0.0.1:port) and the preview server picks a fresh random port
 * on every session, so per-origin storage forgets the choice each time.
 *
 * Priority when a page loads: localStorage (per-origin, newest local action)
 * > this file (user level) > MD_PREVIEW_THEME env hint > built-in defaults.
 *
 * Writes are atomic (temp file + rename) and debounced so a burst of font-size
 * clicks does not hammer the disk.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ThemePref = "system" | "light" | "dark";

export interface UserPrefs {
	/** null = 未设置（回退到环境变量提示 / 跟随系统）。 */
	theme: ThemePref | null;
	/** null = 未设置（回退到 100%）。 */
	scale: number | null;
}

/** 与前端 setScale 的钳制范围保持一致。 */
export const SCALE_MIN = 0.7;
export const SCALE_MAX = 1.6;

export function normalizeTheme(value: unknown): ThemePref | null {
	return value === "system" || value === "light" || value === "dark" ? value : null;
}

export function clampScale(value: unknown): number | null {
	if (typeof value !== "number" || !isFinite(value)) return null;
	return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(value * 100) / 100));
}

/** 读取时机而非模块加载时求值，方便测试注入 XDG_CONFIG_HOME。 */
export function prefsFilePath(): string {
	const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
	return path.join(base, "md-preview", "settings.json");
}

export function loadPrefs(file: string = prefsFilePath()): UserPrefs {
	try {
		const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
		const obj = (raw ?? {}) as Record<string, unknown>;
		return { theme: normalizeTheme(obj.theme), scale: clampScale(obj.scale) };
	} catch {
		return { theme: null, scale: null };
	}
}

export function savePrefs(patch: Partial<UserPrefs>, file: string = prefsFilePath()): UserPrefs {
	const merged = loadPrefs(file);
	// 仅覆盖调用方显式给出的键；显式传 null 表示重置回默认值。
	if (patch.theme !== undefined) merged.theme = normalizeTheme(patch.theme);
	if (patch.scale !== undefined) merged.scale = clampScale(patch.scale);
	writePrefsAtomic(merged, file);
	return merged;
}

function writePrefsAtomic(prefs: UserPrefs, file: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${process.pid}`;
	try {
		fs.writeFileSync(tmp, JSON.stringify(prefs, null, 2) + "\n", "utf8");
		fs.renameSync(tmp, file);
	} finally {
		try {
			fs.rmSync(tmp, { force: true });
		} catch {
			/* 清理失败无碍 */
		}
	}
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPatch: Partial<UserPrefs> | null = null;
let pendingFile: string | null = null;
let exitHookRegistered = false;

/**
 * 防抖保存：字号连点 / 主题快速切换时合并成一次磁盘写入；
 * 进程退出前把尚未落盘的合并补丁同步写掉，避免丢失。
 * 同步返回合并后的偏好视图（供 HTTP 响应立即使用，不等落盘）。
 */
export function savePrefsDebounced(patch: Partial<UserPrefs>, file: string = prefsFilePath()): UserPrefs {
	pendingPatch = { ...pendingPatch, ...patch };
	pendingFile = file;
	if (!exitHookRegistered) {
		exitHookRegistered = true;
		process.once("exit", () => {
			if (pendingPatch && pendingFile) savePrefs(pendingPatch, pendingFile);
		});
	}
	if (!saveTimer) {
		saveTimer = setTimeout(() => {
			saveTimer = null;
			const flush = pendingPatch;
			const target = pendingFile ?? file;
			pendingPatch = null;
			pendingFile = null;
			if (flush) savePrefs(flush, target);
		}, 200);
		saveTimer.unref?.();
	}
	return { ...loadPrefs(file), ...resolvePatch(pendingPatch) };
}

/** 与 savePrefs 相同的校验语义：显式 null 重置，非法值忽略。 */
function resolvePatch(patch: Partial<UserPrefs> | null): { theme: ThemePref | null; scale: number | null } {
	const out = { theme: undefined as ThemePref | null | undefined, scale: undefined as number | null | undefined };
	if (patch) {
		if (patch.theme !== undefined) out.theme = normalizeTheme(patch.theme);
		if (patch.scale !== undefined) out.scale = clampScale(patch.scale);
	}
	const base = loadPrefs();
	return {
		theme: out.theme !== undefined ? out.theme : base.theme,
		scale: out.scale !== undefined ? out.scale : base.scale,
	};
}
