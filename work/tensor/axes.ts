/** Machine-readable akseregister v0. Se akseregister.md. */

export const AXES_VERSION = "axes-v0" as const;

export const ACTIVE_AXES = ["d", "e", "b", "k"] as const;
export type ActiveAxis = (typeof ACTIVE_AXES)[number];

export const RESERVED_AXES = ["c", "t", "w", "r"] as const;
export type ReservedAxis = (typeof RESERVED_AXES)[number];

export const ALIASES = { f: "d" } as const;
export type AliasAxis = keyof typeof ALIASES;

export type AxisName = ActiveAxis | ReservedAxis | AliasAxis;

export const AXIS_META: Record<
  ActiveAxis,
  { meaning: string; owner: string }
> = {
  d: { meaning: "channel / bridge", owner: "encode-model + encode-version" },
  e: { meaning: "evidence type", owner: "ingest-contract" },
  b: { meaning: "run / batch", owner: "runtime" },
  k: { meaning: "row inside a source", owner: "encode of that source" },
};

const ACTIVE = new Set<string>(ACTIVE_AXES);
const RESERVED = new Set<string>(RESERVED_AXES);

export type EquationKind = "read" | "encode" | "update_S" | "update_O" | "collapse";

export interface Equation {
  name: string;
  expr: string;
  kind: EquationKind;
}

/** Første lovlige algoritmer. Ingen egen cosine-modul. */
export const EQUATIONS_V0: Equation[] = [
  { name: "read_chunks", expr: "d,kd->k", kind: "read" },
  { name: "batch_read", expr: "bd,kd->bk", kind: "read" },
  { name: "mark_source", expr: "ke,kd->ed", kind: "read" },
  { name: "collapse", expr: "kd,d->", kind: "collapse" },
];

export class AxisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AxisError";
  }
}

/** Map a letter in an einsum string to its registered home axis. */
export function resolveAxis(letter: string): ActiveAxis {
  if (letter in ALIASES) return ALIASES[letter as AliasAxis];
  if (ACTIVE.has(letter)) return letter as ActiveAxis;
  if (RESERVED.has(letter)) {
    throw new AxisError(`axis '${letter}' is reserved; not active in ${AXES_VERSION}`);
  }
  throw new AxisError(`unbound axis '${letter}' is not in ${AXES_VERSION}`);
}

/** Letters on one side of '->', ignoring commas. */
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

/** Reject reserved / unknown letters. Does not check shapes. */
export function assertRegistered(expr: string): void {
  const { inputs, output } = parseExpr(expr);
  for (const token of [...inputs, output]) {
    for (const letter of lettersIn(token)) resolveAxis(letter);
  }
}

export function listActive(): ActiveAxis[] {
  return [...ACTIVE_AXES];
}
