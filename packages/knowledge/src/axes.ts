/** Index-kontrakt for tensor-kjernen. Se akseregister.md. */

export const AXES_VERSION = "axes-1" as const;

export const AXES = ["d", "e", "b", "k", "c", "t", "w", "r"] as const;
export type AxisName = (typeof AXES)[number];

export const ALIASES = { f: "d", g: "c" } as const;
export type AliasName = keyof typeof ALIASES;

export const AXIS_META: Record<
  AxisName,
  { meaning: string; owner: string }
> = {
  d: { meaning: "channel / bridge", owner: "encode-model + encode-version" },
  e: { meaning: "evidence type", owner: "ingest-contract" },
  b: { meaning: "run / batch", owner: "runtime" },
  k: { meaning: "row inside a source", owner: "encode of that source" },
  c: { meaning: "concept slot", owner: "knowledge world-model" },
  t: { meaning: "time window", owner: "clock / experience" },
  w: { meaning: "workspace slot", owner: "workspace" },
  r: { meaning: "factor rank", owner: "decomposition" },
};

const REGISTERED = new Set<string>(AXES);

export type EquationKind = "read" | "encode" | "update_S" | "update_O" | "collapse";

export interface Equation {
  name: string;
  expr: string;
  kind: EquationKind;
}

export const EQUATIONS: Equation[] = [
  { name: "read_chunks", expr: "d,kd->k", kind: "read" },
  { name: "batch_read", expr: "bd,kd->bk", kind: "read" },
  { name: "mark_source", expr: "ke,kd->ed", kind: "read" },
  { name: "bind_concept", expr: "kd,cd->kc", kind: "read" },
  { name: "map_channels", expr: "kd,df->kf", kind: "update_O" },
  { name: "map_concepts", expr: "kc,cg->kg", kind: "update_O" },
  { name: "window", expr: "ktd->kd", kind: "update_S" },
  { name: "space", expr: "kwd,w->kd", kind: "update_S" },
  { name: "factor_core", expr: "kr,rd->kd", kind: "read" },
  { name: "collapse", expr: "kd,d->", kind: "collapse" },
];

export class AxisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AxisError";
  }
}

export function resolveAxis(letter: string): AxisName {
  if (letter in ALIASES) return ALIASES[letter as AliasName];
  if (REGISTERED.has(letter)) return letter as AxisName;
  throw new AxisError(`unbound axis '${letter}' is not in ${AXES_VERSION}`);
}

export function lettersIn(part: string): string[] {
  return [...part].filter((ch) => /[a-z]/.test(ch));
}

export function parseExpr(expr: string): { inputs: string[]; output: string } {
  const [lhs, rhs] = expr.split("->");
  if (lhs === undefined || rhs === undefined) {
    throw new AxisError(`expected 'inputs->output', got '${expr}'`);
  }
  return {
    inputs: lhs.split(",").map((s) => s.trim()).filter(Boolean),
    output: rhs.trim(),
  };
}

export function assertRegistered(expr: string): void {
  const { inputs, output } = parseExpr(expr);
  for (const token of [...inputs, output]) {
    for (const letter of lettersIn(token)) resolveAxis(letter);
  }
}

export function listAxes(): AxisName[] {
  return [...AXES];
}
