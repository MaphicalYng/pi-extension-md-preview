/** Opens a URL in the user's default browser without keeping a handle alive. */
import { spawn } from "node:child_process";

export function openBrowser(url: string): boolean {
	const [cmd, args] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["cmd", ["/c", "start", "", url]]
				: ["xdg-open", [url]];
	try {
		const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
		child.on("error", () => {
			/* browser launch failures are non-fatal: the URL still works */
		});
		child.unref();
		return true;
	} catch {
		return false;
	}
}
