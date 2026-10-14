// What the entry point relays to the chat panel, one JSON object per line, and
// the two small readers that turn the agent server's messages into those
// events. Pure and import-free so the panel and the route share the types.

export type AgentEvent =
  | { type: "thread"; threadId: string }
  /** The agent is looking something up: this tool, with these arguments. */
  | { type: "tool"; id: string; name: string; args: Record<string, unknown> }
  /** What that lookup came back with, as counts only (never the rows). */
  | { type: "result"; id: string; found: boolean; total: number | null; more: number | null }
  | { type: "text"; delta: string }
  | { type: "done" }
  | { type: "error"; message: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Tool calls an AI message asks for. Anything not shaped like one is skipped. */
export function toolCallsOf(
  message: unknown,
): { id: string; name: string; args: Record<string, unknown> }[] {
  if (!isRecord(message) || message.type !== "ai" || !Array.isArray(message.tool_calls)) return [];
  return message.tool_calls.flatMap((call: unknown) =>
    isRecord(call) && typeof call.id === "string" && typeof call.name === "string"
      ? [{ id: call.id, name: call.name, args: isRecord(call.args) ? call.args : {} }]
      : [],
  );
}

/** A tool message, reduced to whether it found something and how much. */
export function summariseResult(
  message: unknown,
): { id: string; found: boolean; total: number | null; more: number | null } | null {
  if (!isRecord(message) || message.type !== "tool") return null;
  const id = message.tool_call_id;
  if (typeof id !== "string") return null;
  let parsed: unknown = null;
  if (typeof message.content === "string") {
    try {
      parsed = JSON.parse(message.content);
    } catch {
      parsed = null;
    }
  }
  if (!isRecord(parsed)) return { id, found: false, total: null, more: null };
  return {
    id,
    // A summary or a route table carries no `found`; an error carries false.
    found: parsed.found !== false && parsed.error === undefined,
    total: typeof parsed.total === "number" ? parsed.total : null,
    more: typeof parsed.more === "number" ? parsed.more : null,
  };
}
