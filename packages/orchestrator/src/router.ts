/**
 * Rule-based task analysis + model routing (Milestone 0).
 *
 * Rules:
 * - low complexity / summarize / tool → local
 * - medium code → local
 * - high complexity / research / reasoning → frontier
 */

import type {
  Complexity,
  ModelChoice,
  RoutingDecision,
  TaskType,
} from "./types.js";

export interface RouterConfig {
  localModel: string;
  frontierModel: string;
}

const RESEARCH_RE =
  /\b(research|undersøk|utred|sammenlign|compare|analyze\s+market|survey|literature|kilder|sources)\b/i;

const REASONING_RE =
  /\b(reason|reasoning|prove|bevis|deduce|derive|math|matematikk|logikk|logic\s+puzzle|step[- ]by[- ]step|resonner)\b/i;

const CODE_RE =
  /\b(code|kode|function|implement|refactor|bug|typescript|javascript|python|api|class|debug|compile|unit\s*test)\b/i;

const SUMMARIZE_RE =
  /\b(summarize|summary|oppsummer|tl;?dr|kort\s+versjon|condense|abstract)\b/i;

const TOOL_RE =
  /\b(tool|run\s+command|shell|fil|file\s+system|kalkulator|calculator|execute|kjør)\b/i;

const HIGH_COMPLEXITY_RE =
  /\b(architect|system\s+design|multi[- ]step|kompleks|complex|trade-?offs?|production|scale|distributed|sikkerhet|security\s+review)\b/i;

const LOW_COMPLEXITY_RE =
  /\b(hello|hei|hi\b|what\s+is|hva\s+er|define|definer|simple|enkel|quick|rask)\b/i;

export function analyzeTask(prompt: string): {
  taskType: TaskType;
  complexity: Complexity;
} {
  const text = prompt.trim();

  let taskType: TaskType = "general";
  if (SUMMARIZE_RE.test(text)) taskType = "summarize";
  else if (TOOL_RE.test(text)) taskType = "tool";
  else if (RESEARCH_RE.test(text)) taskType = "research";
  else if (REASONING_RE.test(text)) taskType = "reasoning";
  else if (CODE_RE.test(text)) taskType = "code";

  let complexity: Complexity = "medium";
  if (HIGH_COMPLEXITY_RE.test(text) || text.length > 1200) {
    complexity = "high";
  } else if (
    LOW_COMPLEXITY_RE.test(text) ||
    taskType === "summarize" ||
    taskType === "tool" ||
    text.length < 80
  ) {
    complexity = "low";
  }

  // Research / reasoning are treated as high unless clearly tiny.
  if (
    (taskType === "research" || taskType === "reasoning") &&
    complexity !== "low"
  ) {
    complexity = "high";
  }

  return { taskType, complexity };
}

export function route(
  prompt: string,
  config: RouterConfig
): RoutingDecision {
  const { taskType, complexity } = analyzeTask(prompt);

  let model: ModelChoice;
  let reason: string;

  if (taskType === "research" || taskType === "reasoning") {
    model = "frontier";
    reason = `${taskType} → frontier (Grok)`;
  } else if (taskType === "summarize" || taskType === "tool") {
    model = "local";
    reason = `${taskType} → local (Ollama)`;
  } else if (taskType === "code" && complexity !== "high") {
    model = "local";
    reason = `code/${complexity} → local (Ollama)`;
  } else if (complexity === "high") {
    model = "frontier";
    reason = `high complexity → frontier (Grok)`;
  } else if (complexity === "low") {
    model = "local";
    reason = `low complexity → local (Ollama)`;
  } else {
    // medium general → local (token-efficient default)
    model = "local";
    reason = `medium/${taskType} → local (Ollama)`;
  }

  return {
    model,
    reason,
    taskType,
    complexity,
    localModel: config.localModel,
    frontierModel: config.frontierModel,
  };
}
