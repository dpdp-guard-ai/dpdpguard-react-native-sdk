#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regenerates src/generated/api-types.ts from the installed
 * @dpdpguard/contract's openapi/v1.yaml. Run after every install/update of
 * @dpdpguard/contract, or via `npm run codegen`.
 *
 * Uses `npx openapi-typescript` rather than a devDependency, matching
 * dpdpguard-server-sdk's approach — keeps this repo's own TypeScript
 * version free of a forced peer-dependency resolution.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = join(repoRoot, "node_modules", "@dpdpguard", "contract", "openapi", "v1.yaml");
const outPath = join(repoRoot, "src", "generated", "api-types.ts");

if (!existsSync(specPath)) {
	console.error(`codegen: ${specPath} not found — is @dpdpguard/contract installed? Run npm install first.`);
	process.exit(1);
}

const result = spawnSync(
	"npx",
	["--yes", "openapi-typescript@7", specPath, "-o", outPath],
	{ stdio: "inherit", shell: process.platform === "win32" },
);

process.exit(result.status ?? 1);
