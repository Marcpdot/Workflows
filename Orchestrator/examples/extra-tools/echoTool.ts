/**
 * Example plugin tool — register via TOOL_EXTRA_MODULES=./examples/extra-tools/echoTool.ts
 */
import type { Tool } from "../../src/tools/types.js";

export const tools: Tool[] = [
  {
    name: "echo",
    description: "Echo back a message (example plugin tool).",
    parameters: [
      {
        name: "message",
        type: "string",
        description: "Text to echo",
        required: true,
      },
    ],
    async execute(args) {
      const message = args.message;
      if (typeof message !== "string") {
        return {
          ok: false,
          output: "",
          error: "echo: message (string) required",
        };
      }
      return { ok: true, output: message };
    },
  },
];
