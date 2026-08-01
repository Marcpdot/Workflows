/**
 * Offline smoke for Milestone 3C role pipeline (mock runStage — no models).
 */

import {
  defaultPipelineRoles,
  plannerRole,
  runRolePipeline,
  workerRole,
  type AgentRole,
} from "@workflows/agents";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  // 1. Two stages in order; worker sees planner output
  const order: string[] = [];
  const result = await runRolePipeline({
    task: "Add smoke test for feature X",
    roles: defaultPipelineRoles(),
    runStage: async ({ role, task, priorStages }) => {
      order.push(role.name);
      if (role.name === "planner") {
        assert(priorStages.length === 0, "planner should have no prior stages");
        assert(task.includes("smoke"), "task passed to planner");
        return { text: "Plan: 1) write smoke 2) run it" };
      }
      if (role.name === "worker") {
        assert(priorStages.length === 1, "worker gets planner stage");
        assert(priorStages[0]!.role === "planner", "prior is planner");
        assert(
          priorStages[0]!.text.includes("Plan:"),
          "worker receives planner text"
        );
        return {
          text: "Done: smoke-x.ts added",
          toolSteps: [],
        };
      }
      return { text: "unknown role" };
    },
  });

  assert(order.join(",") === "planner,worker", `order was ${order.join(",")}`);
  assert(result.stages.length === 2, "two stages");
  assert(result.finalText.includes("Done"), "final from worker");
  console.log("OK: planner → worker order + priorStages");

  // 2. Single role pipeline
  const single = await runRolePipeline({
    task: "say hi",
    roles: [workerRole],
    runStage: async ({ role, priorStages }) => {
      assert(role.name === "worker", "single worker");
      assert(priorStages.length === 0, "no prior");
      return { text: "hi" };
    },
  });
  assert(single.finalText === "hi", "single final");
  assert(single.stages.length === 1, "one stage");
  console.log("OK: single role pipeline");

  // 3. Empty roles → error
  let emptyFailed = false;
  try {
    await runRolePipeline({
      task: "x",
      roles: [],
      runStage: async () => ({ text: "no" }),
    });
  } catch {
    emptyFailed = true;
  }
  assert(emptyFailed, "empty roles should throw");
  console.log("OK: empty roles error");

  // 4. Empty task → error
  let taskFailed = false;
  try {
    await runRolePipeline({
      task: "  ",
      roles: [plannerRole],
      runStage: async () => ({ text: "no" }),
    });
  } catch {
    taskFailed = true;
  }
  assert(taskFailed, "empty task should throw");
  console.log("OK: empty task error");

  // 5. Custom three roles sequential
  const names: string[] = [];
  const three = await runRolePipeline({
    task: "multi",
    roles: [
      { name: "a", systemPrompt: "a" },
      { name: "b", systemPrompt: "b" },
      { name: "c", systemPrompt: "c" },
    ] satisfies AgentRole[],
    runStage: async ({ role, priorStages }) => {
      names.push(role.name);
      return { text: `${role.name}:${priorStages.length}` };
    },
  });
  assert(names.join("") === "abc", "abc order");
  assert(three.stages[2]!.text === "c:2", "c sees 2 priors");
  console.log("OK: three custom roles");

  // 6. Built-in roles shape (planner is structured JSON, no tools — M10)
  assert(
    Array.isArray(plannerRole.toolsAllowed) &&
      plannerRole.toolsAllowed.length === 0,
    "planner has no tools (structured plan)"
  );
  assert(workerRole.toolsAllowed === undefined, "worker all tools");
  console.log("OK: built-in role defaults");

  console.log("All agents pipeline smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
