/**
 * User-level preferences for the markdown preview (theme + font scale + line height).
 *
 * Stored as JSON at $XDG_CONFIG_HOME/md-preview/settings.json (falling back
 * to ~/.config). Browser localStorage alone cannot do this job: it is keyed
 * by origin (127.0.0.1:port) and the preview server picks a fresh random port
 * on every session, so per-origin storage forgets the choice each time.
 *
 * Priority when a page loads: localStorage (per-origin, newest local action)
 * > this file (user level) > MD_PREVIEW_THEME env hint > built-in defaults.
 *
 * Writes are atomic (temp file + rename) and debounced so a burst of font-size /
 * line-height clicks does not hammer the disk.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ThemePref = "system" | "light" | "dark";

/** 阅读背景：white=纯白（默认）、dim=暗白、wood=木色、cyan=青色。 */
export type BgPref = "white" | "dim" | "wood" | "cyan";

export interface UserPrefs {
	/** null = 未设置（回退到环境变量提示 / 跟随系统）。 */
	theme: ThemePref | null;
	/** null = 未设置（回退到纯白）。 */
	bg: BgPref | null;
	/** null = 未设置（回退到 100%）。 */
	scale: number | null;
	/** null = 未设置（回退到 1.75）。 */
	lineHeight: number | null;
}

/** 与前端 setScale 的钳制范围保持一致。 */
export const SCALE_MIN = 0.7;
export const SCALE_MAX = 1.6;

/** 与前端 setLineHeight 的钳制范围保持一致。 */
export const LINEHEIGHT_MIN = 1.4;
export const LINEHEIGHT_MAX = 2.2;

export function normalizeTheme(value: unknown): ThemePref | null {
	return value === "system" || value === "light" || value === "dark" ? value : null;
}

export function normalizeBg(value: unknown): BgPref | null {
	return value === "white" || value === "dim" || value === "wood" || value === "cyan" ? value : null;
}

export function clampScale(value: unknown): number | null {
	if (typeof value !== "number" || !isFinite(value)) return null;
	return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(value * 100) / 100));
}

export function clampLineHeight(value: unknown): number | null {
	if (typeof value !== "number" || !isFinite(value)) return null;
	return Math.min(LINEHEIGHT_MAX, Math.max(LINEHEIGHT_MIN, Math.round(value * 100) / 100));
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
		return {
			theme: normalizeTheme(obj.theme),
			bg: normalizeBg(obj.bg),
			scale: clampScale(obj.scale),
			lineHeight: clampLineHeight(obj.lineHeight),
		};
	} catch {
		return { theme: null, bg: null, scale: null, lineHeight: null };
	}
}

export function savePrefs(patch: Partial<UserPrefs>, file: string = prefsFilePath()): UserPrefs {
	const merged = loadPrefs(file);
	// 仅覆盖调用方显式给出的键；显式传 null 表示重置回默认值。
	if (patch.theme !== undefined) merged.theme = normalizeTheme(patch.theme);
	if (patch.bg !== undefined) merged.bg = normalizeBg(patch.bg);
	if (patch.scale !== undefined) merged.scale = clampScale(patch.scale);
	if (patch.lineHeight !== undefined) merged.lineHeight = clampLineHeight(patch.lineHeight);
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
 * 防抖保存：字号/行距连点 / 主题快速切换时合并成一次磁盘写入；
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
function resolvePatch(patch: Partial<UserPrefs> | null): { theme: ThemePref | null; bg: BgPref | null; scale: number | null; lineHeight: number | null } {
	const out = {
		theme: undefined as ThemePref | null | undefined,
		bg: undefined as BgPref | null | undefined,
		scale: undefined as number | null | undefined,
		lineHeight: undefined as number | null | undefined,
	};
	if (patch) {
		if (patch.theme !== undefined) out.theme = normalizeTheme(patch.theme);
		if (patch.bg !== undefined) out.bg = normalizeBg(patch.bg);
		if (patch.scale !== undefined) out.scale = clampScale(patch.scale);
		if (patch.lineHeight !== undefined) out.lineHeight = clampLineHeight(patch.lineHeight);
	}
	const base = loadPrefs();
	return {
		theme: out.theme !== undefined ? out.theme : base.theme,
		bg: out.bg !== undefined ? out.bg : base.bg,
		scale: out.scale !== undefined ? out.scale : base.scale,
		lineHeight: out.lineHeight !== undefined ? out.lineHeight : base.lineHeight,
	};
}
