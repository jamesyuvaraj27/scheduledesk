/**
 * Cross-platform clean reinstall.
 *
 * Native binaries (esbuild, rollup) are platform-specific, so a node_modules
 * tree or lockfile copied from another machine or OS will fail with errors
 * like "Cannot find native binding". This wipes every install artifact and
 * reinstalls from the repo root, where npm workspaces expects to run.
 *
 *   npm run setup
 */
import { rmSync, existsSync, copyFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

const targets = [
  "node_modules",
  "package-lock.json",
  join("client", "node_modules"),
  join("client", "package-lock.json"),
  join("server", "node_modules"),
  join("server", "package-lock.json"),
]

console.log("Cleaning install artifacts…")
for (const target of targets) {
  const path = join(root, target)
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true })
    console.log("  removed " + target)
  }
}

console.log("\nInstalling dependencies (this takes a minute)…")
execSync("npm install", { cwd: root, stdio: "inherit" })

// Create .env from the example ONLY if it doesn't exist. Never overwrite —
// it holds the database password.
const envPath = join(root, "server", ".env")
const envCreated = !existsSync(envPath)
if (envCreated) {
  copyFileSync(join(root, "server", ".env.example"), envPath)
  console.log("\nCreated server/.env from the example.")
}

console.log("\nGenerating Prisma client…")
execSync("npm run db:generate", { cwd: root, stdio: "inherit" })

console.log("\nDone. Next:")
if (envCreated) {
  console.log("  1. Put your real DATABASE_URL in server/.env")
} else {
  console.log("  1. server/.env left untouched (your DATABASE_URL is safe)")
}
console.log("  2. npm run db:migrate    (first time only)")
console.log("  3. npm run dev           (run this from the repo root)")
