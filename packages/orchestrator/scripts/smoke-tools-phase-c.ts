/**
 * Offline smoke for Milestone 2 phase C tools.
 *
 * 1. write_file + read_file roundtrip under workspace temp
 * 2. search_files finds known string
 * 3. run_script on a scripts/*.ts smoke (or skip)
 * 4. web_search disabled → ok:false
 * 5. write outside root → fail
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createBuiltinRegistry,
  createRegistryFromConfig,
  loadExtraTools,
} from "@workflows/tools";

async function main(): Promise<void> {
  const workspaceRoot = resolve(process.cwd());
  const registry = createBuiltinRegistry();
  const ctx = { workspaceRoot };

  const names = new Set(registry.list().map((t) => t.name));
  for (const required of [
    "read_file",
    "list_dir",
    "run_command",
    "write_file",
    "search_files",
    "web_search",
    "run_script",
  ]) {
    if (!names.has(required)) {
      throw new Error(`Missing built-in: ${required}`);
    }
  }
  console.log(`OK: registry has ${[...names].sort().join(", ")}`);

  // temp dir under workspace
  const tmpDir = join(workspaceRoot, "data", "_tool_c_smoke");
  mkdirSync(tmpDir, { recursive: true });
  const relFile = "data/_tool_c_smoke/roundtrip.txt";

  try {
    // 1. write + read roundtrip
    const written = await registry.execute(
      "write_file",
      { path: relFile, content: "phase-c-hello\n" },
      ctx
    );
    if (!written.ok) throw new Error(`write_file failed: ${written.error}`);

    const read = await registry.execute("read_file", { path: relFile }, ctx);
    if (!read.ok) throw new Error(`read_file failed: ${read.error}`);
    if (!read.output.includes("phase-c-hello")) {
      throw new Error("roundtrip content mismatch");
    }

    const noOver = await registry.execute(
      "write_file",
      { path: relFile, content: "x", overwrite: false },
      ctx
    );
    if (noOver.ok) throw new Error("overwrite=false should fail on existing");
    console.log("OK: write_file + read_file roundtrip");

    // 2. search_files
    const search = await registry.execute(
      "search_files",
      { query: "orchestrator", path: ".", maxResults: 10 },
      ctx
    );
    if (!search.ok) throw new Error(`search_files failed: ${search.error}`);
    if (!search.output.toLowerCase().includes("package.json")) {
      // may match other files; ensure we got something
      if (!search.output || search.output.startsWith("No matches")) {
        throw new Error("search_files expected hits for orchestrator");
      }
    }
    console.log("OK: search_files");

    // 3. run_script
    const scriptRel = "scripts/smoke-tools.ts";
    if (existsSync(join(workspaceRoot, scriptRel))) {
      // Use a tiny inline script instead to avoid long smoke-tools run
      const tiny = "data/_tool_c_smoke/tiny.js";
      writeFileSync(
        join(workspaceRoot, tiny),
        'console.log("tiny-script-ok");\n',
        "utf8"
      );
      // tiny.js is under data/, not scripts/ — should fail roots check
      const blocked = await registry.execute(
        "run_script",
        { script: tiny },
        ctx
      );
      if (blocked.ok) {
        throw new Error("run_script should block scripts outside TOOL_SCRIPT_ROOTS");
      }
      console.log("OK: run_script blocks non-scripts path");

      // Put a tiny script under scripts/
      const allowedScript = "scripts/_phase_c_tiny.js";
      writeFileSync(
        join(workspaceRoot, allowedScript),
        'console.log("tiny-script-ok");\n',
        "utf8"
      );
      try {
        const ran = await registry.execute(
          "run_script",
          { script: allowedScript },
          ctx
        );
        if (!ran.ok) throw new Error(`run_script failed: ${ran.error}`);
        if (!ran.output.includes("tiny-script-ok")) {
          throw new Error("run_script output missing marker");
        }
        console.log("OK: run_script under scripts/");
      } finally {
        try {
          rmSync(join(workspaceRoot, allowedScript), { force: true });
        } catch {
          /* ignore */
        }
      }
    } else {
      console.log("SKIP: run_script (scripts/smoke-tools.ts missing)");
    }

    // 4. web_search disabled
    delete process.env.WEB_SEARCH_ENABLED;
    const web = await registry.execute(
      "web_search",
      { query: "test" },
      ctx
    );
    if (web.ok) throw new Error("web_search should be disabled by default");
    if (!web.error?.toLowerCase().includes("disabled")) {
      throw new Error(`expected disabled error, got: ${web.error}`);
    }
    console.log("OK: web_search disabled");

    // 5. write outside root
    const escape = await registry.execute(
      "write_file",
      { path: "../outside-workspace.txt", content: "nope" },
      ctx
    );
    if (escape.ok) throw new Error("write outside root should fail");
    console.log(`OK: write escape blocked (${escape.error})`);

    // Plugin loader with example echo tool
    const withExtras = createBuiltinRegistry();
    const { loaded, errors } = await loadExtraTools(withExtras, [
      "./examples/extra-tools/echoTool.ts",
    ]);
    if (errors.length) {
      throw new Error(`loadExtraTools errors: ${errors.join("; ")}`);
    }
    if (!loaded.some((l) => l.includes("echo"))) {
      throw new Error("expected echo tool loaded");
    }
    const echo = await withExtras.execute(
      "echo",
      { message: "plugin-ok" },
      ctx
    );
    if (!echo.ok || echo.output !== "plugin-ok") {
      throw new Error(`echo plugin failed: ${echo.error}`);
    }
    console.log("OK: loadExtraTools plugin pattern");

    // createRegistryFromConfig
    const cfgReg = await createRegistryFromConfig({
      extraModules: ["./examples/extra-tools/echoTool.ts"],
    });
    if (!cfgReg.get("echo") || !cfgReg.get("write_file")) {
      throw new Error("createRegistryFromConfig missing tools");
    }
    console.log("OK: createRegistryFromConfig");

    console.log("All phase-C tools smoke checks passed.");
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
