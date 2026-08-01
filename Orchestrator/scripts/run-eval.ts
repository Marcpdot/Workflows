/**
 * Eval suite CLI.
 *
 *   npx tsx scripts/run-eval.ts
 *   npx tsx scripts/run-eval.ts --case memory-name-recall
 *   npx tsx scripts/run-eval.ts --json
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runEvalSuite, resolveEvalPaths } from "../../packages/eval/src/index.js";

function loadDotEnv(filePath = resolve(process.cwd(), ".env")): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]): {
  caseId?: string;
  printJson: boolean;
  help: boolean;
} {
  let caseId: string | undefined;
  let printJson = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--json") {
      printJson = true;
    } else if (arg === "--case") {
      const next = argv[++i];
      if (!next) {
        console.error("--case requires an id");
        process.exit(1);
      }
      caseId = next;
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  return { caseId, printJson, help };
}

function printHelp(): void {
  console.log(`
Eval suite runner

Usage:
  npx tsx scripts/run-eval.ts
  npx tsx scripts/run-eval.ts --case memory-name-recall
  npx tsx scripts/run-eval.ts --json

Options:
  --case <id>   Run a single case
  --json        Also print full report JSON to stdout
  --help, -h    Show help
`);
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const paths = resolveEvalPaths(process.cwd());
  if (!existsSync(paths.casesPath)) {
    console.error(`Cases file not found: ${paths.casesPath}`);
    process.exit(1);
  }

  console.log(`Running eval suite from ${paths.casesPath}\n`);

  const report = await runEvalSuite({
    casesPath: paths.casesPath,
    resultsDir: paths.resultsDir,
    caseId: args.caseId,
    printJson: args.printJson,
  });

  if (args.printJson) {
    console.log(JSON.stringify(report, null, 2));
  }

  process.exit(report.summary.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
