import { READ_TOOLS } from "./readTools.js";
import { PLAN_TOOLS, PLAN_WRITE_TOOLS } from "./planTools.js";
import { WRITE_TOOLS } from "./writeTools.js";
import type { ToolDefinition } from "../provider.js";
import type { ToolHandlerContext } from "./readTools.js";

/**
 * The tool registry IS the allowlist (security-architecture.md §5 /
 * ai-architecture.md §8: "the model has no reachable tool call" beyond
 * what's registered here). Fixed per-request, computed before the model
 * ever sees a tool list -- nothing in a model's output can add to or
 * remove from this set.
 *
 * ALL_READ_TOOLS/ALL_WRITE_TOOLS merge the original tools with Gate 10/11's
 * Plan tools -- a separate file (tools/planTools.ts) keeps Plan-specific
 * logic grouped rather than growing readTools.ts/writeTools.ts further, but
 * they share the exact same ReadToolHandler/WriteToolHandler shape and the
 * exact same lookup/execute path below, so there is still only one read
 * allowlist and one write allowlist, never a second registry.
 */
const ALL_READ_TOOLS = [...READ_TOOLS, ...PLAN_TOOLS];
const ALL_WRITE_TOOLS = [...WRITE_TOOLS, ...PLAN_WRITE_TOOLS];

export function getToolDefinitions(): ToolDefinition[] {
  return [...ALL_READ_TOOLS.map((t) => t.definition), ...ALL_WRITE_TOOLS.map((t) => t.definition)];
}

export type ToolExecutionResult = { toolName: string; isWrite: boolean; isError: boolean; result: unknown };

export async function executeTool(handlerCtx: ToolHandlerContext, toolName: string, args: unknown): Promise<ToolExecutionResult> {
  const readTool = ALL_READ_TOOLS.find((t) => t.definition.name === toolName);
  if (readTool) {
    try {
      const result = await readTool.execute(handlerCtx, args);
      return { toolName, isWrite: false, isError: false, result };
    } catch (err) {
      return { toolName, isWrite: false, isError: true, result: { message: toStructuredErrorMessage(err) } };
    }
  }

  const writeTool = ALL_WRITE_TOOLS.find((t) => t.definition.name === toolName);
  if (writeTool) {
    try {
      const result = await writeTool.execute(handlerCtx, args);
      return { toolName, isWrite: true, isError: false, result };
    } catch (err) {
      return { toolName, isWrite: true, isError: true, result: { message: toStructuredErrorMessage(err) } };
    }
  }

  // Not in the registry at all -- the model asked for something that
  // doesn't exist. Returned as a structured tool error for the model to
  // correct (ai-architecture.md §6), never silently ignored, never
  // retried with guessed arguments.
  return { toolName, isWrite: false, isError: true, result: { message: `Unknown tool: ${toolName}` } };
}

function toStructuredErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return "Tool execution failed.";
}
