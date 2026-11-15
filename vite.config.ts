import { defineConfig } from "vite-plus";
import { execFileSync } from "node:child_process";

/** last commit as `<hash> <YYYY-MM-DD>`, empty without a git checkout */
function gitVersion(): string {
  try {
    return execFileSync("git", ["log", "-1", "--format=%h %cs"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}
const [commitHash = "", commitDate = ""] = gitVersion().split(" ");
// exposed as import.meta.env.VITE_*, unless already set in the environment
process.env.VITE_COMMIT_HASH ??= commitHash;
process.env.VITE_COMMIT_DATE ??= commitDate;

// https://viteplus.dev/config/
export default defineConfig({
  // relative paths: served from GitHub Pages (/dinopano/) and Toolforge (/)
  base: "./",
  // three.js alone is ~500 kB, splitting would not make the first load faster
  build: { chunkSizeWarningLimit: 800 },
  fmt: {
    printWidth: 80,
  },
  lint: {
    ignorePatterns: ["dist/**"],
    options: {
      typeAware: true,
      typeCheck: false,
    },
  },
  test: {
    // DOMParser for htmlToText
    environment: "happy-dom",
  },
  staged: {
    "*": "vp check --fix",
  },
});
