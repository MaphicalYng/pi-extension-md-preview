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

/** Reading background: white = pure white (default), dim = dimmed white, wood = wood tone, cyan = cyan tint. */
export type BgPref = "white" | "dim" | "wood" | "cyan";

/** UI language of the preview page. */
export type UiLang = "en" | "zh";

export interface UserPrefs {
	/** null = not set (falls back to the env hint / following the OS theme). */
	theme: ThemePref | null;
	/** null = not set (falls back to pure white). */
	bg: BgPref | null;
	/** null = not set (falls back to 100%). */
	scale: number | null;
	/** null = not set (falls back to 1.75). */
	lineHeight: number | null;
}

/** Kept in sync with the front-end setScale clamp range. */
export const SCALE_MIN = 0.7;
export const SCALE_MAX = 1.6;

/** Kept in sync with the front-end setLineHeight clamp range. */
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

/** Accepts "en"/"zh" (case-insensitive; "zh-CN"-style tags collapse to "zh"); null = not set. */
export function normalizeUiLang(value: unknown): UiLang | null {
	if (typeof value !== "string") return null;
	const v = value.trim().toLowerCase();
	if (v === "en" || v.startsWith("en-") || v.startsWith("en_")) return "en";
	if (v === "zh" || v.startsWith("zh-") || v.startsWith("zh_")) return "zh";
	return null;
}

/**
 * Language priority: explicit tool argument > MD_PREVIEW_LANG env hint > "en".
 * Evaluated at call time (not module load) so tests can inject the env var.
 */
export function resolveUiLang(explicit?: UiLang | null): UiLang {
	return normalizeUiLang(explicit) ?? normalizeUiLang(process.env.MD_PREVIEW_LANG) ?? "en";
}

/** Evaluated at call time rather than module load, so tests can inject XDG_CONFIG_HOME. */
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
	// Only keys the caller explicitly provided are overwritten; an explicit null resets to the default.
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
			/* cleanup failure is harmless */
		}
	}
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPatch: Partial<UserPrefs> | null = null;
let pendingFile: string | null = null;
let exitHookRegistered = false;

/**
 * Debounced save: rapid font-size / line-height clicks or theme toggles are
 * merged into a single disk write; a pending merge is flushed synchronously on
 * process exit so nothing is lost. Returns the merged prefs view right away (for
 * the HTTP response) without waiting for the write.
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

/** Same validation semantics as savePrefs: explicit null resets, invalid values are ignored. */
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
