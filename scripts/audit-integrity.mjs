import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const runtimeRoots = ["apps/api/src", "apps/web/src", "packages/core/src", "packages/mcp/src", "contracts/src"];
const sourceExtensions = new Set([".ts", ".tsx", ".sol", ".js", ".mjs"]);
const findings = [];

async function sourceFiles(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "test" && entry.name !== "tests") files.push(...await sourceFiles(path));
    } else if (sourceExtensions.has(extname(entry.name)) && !/\.test\./.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const files = (await Promise.all(runtimeRoots.map(sourceFiles))).flat();
for (const file of files) {
  const contents = await readFile(join(root, file), "utf8");
  const label = relative(root, join(root, file));
  const checks = [
    [/\b(?:mock|fake|stub|dummy)\b/i, "test-double term in a production path"],
    [/\bTODO\b/i, "TODO in a production path"],
    [/catch\s*\{\s*\}/, "empty catch block"],
    [/(?:USER|WALLET|OWNER|TRADER)_PRIVATE_KEY/i, "user private-key name in a production path"],
    [/process\.env\.(?!SLICE_API_URL\b)/, "direct environment access outside the MCP API URL boundary"],
    [/from\s+["'][^"']*(?:\/test|\.test)[^"']*["']/i, "production import from a test path"],
  ];
  for (const [pattern, description] of checks) {
    if (pattern.test(contents)) findings.push(`${label}: ${description}`);
  }

  if (!label.endsWith("config.ts") && /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/.test(contents)) {
    findings.push(`${label}: literal address outside the central network configuration`);
  }
  const bytes32Literals = contents.split("\n").filter((line) => !line.includes("SECP256K1_HALF_ORDER"));
  if (bytes32Literals.some((line) => /0x[0-9a-fA-F]{64}/.test(line))) {
    findings.push(`${label}: literal bytes32 market or venue identifier in a production path`);
  }
  for (const [lineNumber, line] of contents.split("\n").entries()) {
    if (line.includes("<button") && !line.includes("onClick=")) findings.push(`${label}:${lineNumber + 1}: button has no click handler`);
  }
}

if (findings.length > 0) {
  console.error("INTEGRITY FAIL");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`INTEGRITY PASS: scanned ${files.length} reachable production source files`);
  console.log("- no test-double terms, TODOs, empty catches, test imports, user-key names, literal market IDs, or unhandled buttons found");
}
