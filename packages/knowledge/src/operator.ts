/** O is a square map on the living channel. Identity until a signal exists. */

import { assertRegistered, type AxisName } from "./axes.js";
import type { Factor } from "./encode.js";

export function identityOperator(dimension: number, channel: AxisName): Factor {
  const values = Array.from({ length: dimension * dimension }, () => 0);
  for (let i = 0; i < dimension; i++) values[i * dimension + i] = 1;
  return {
    name: "O",
    axes: [channel, channel],
    shape: [dimension, dimension],
    values,
  };
}

/** S[k, ch] · O[ch, ch] → Y[k, ch] */
export function applyOperator(S: Factor, O: Factor): Factor {
  const channel = S.axes[1];
  if (!channel || S.axes[0] !== "k") {
    throw new Error("applyOperator expects S axes [k, channel]");
  }
  if (O.axes[0] !== channel || O.axes[1] !== channel) {
    throw new Error("applyOperator expects O axes [channel, channel]");
  }
  assertRegistered(`k${channel},${channel}${channel}->k${channel}`);
  const k = S.shape[0] ?? 0;
  const dim = S.shape[1] ?? 0;
  if (O.shape[0] !== dim || O.shape[1] !== dim) {
    throw new Error(`O shape ${O.shape.join("x")} != channel ${dim}`);
  }
  const values = Array.from({ length: k * dim }, () => 0);
  for (let row = 0; row < k; row++) {
    for (let j = 0; j < dim; j++) {
      let sum = 0;
      for (let i = 0; i < dim; i++) {
        sum += S.values[row * dim + i]! * O.values[i * dim + j]!;
      }
      values[row * dim + j] = sum;
    }
  }
  return { name: "Y", axes: S.axes, shape: [k, dim], values };
}
