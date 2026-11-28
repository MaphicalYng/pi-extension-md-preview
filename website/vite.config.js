import { execFileSync } from "node:child_process";

function resolveDeployCommit() {
  const fromEnv = process.env.VITE_DEPLOY_COMMIT?.trim();
  if (fromEnv) return fromEnv;

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

export default {
  define: {
    "import.meta.env.VITE_DEPLOY_COMMIT": JSON.stringify(resolveDeployCommit()),
  },
};
