import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { Client } from "@langchain/langgraph-sdk";
import { api } from "@/convex/_generated/api";
import { mintCredential } from "@/lib/agent/credential";
import { type AgentEvent, summariseResult, toolCallsOf } from "@/lib/agent/events";

// The one entry point to the agent. It proves the asker owns the analysis,
// mints a credential for that analysis alone, opens (or continues) the
// conversation on the agent's server and relays what comes back as it happens.
//
// What reaches the agent is the question and, in the run's config, the
// credential. The analysis is never in the prompt: the agent could not name it
// if a repository's own text told it to.

export const dynamic = "force-dynamic";

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:2024";
const ASSISTANT = "cartograph";
const MAX_QUESTION = 2000;
const MAX_PATH = 500;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const fail = (status: number, error: string) => Response.json({ error }, { status });

/** The text of a streamed message chunk: a string, or text blocks. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string" ? block.text : "",
    )
    .join("");
}

/** The messages inside one node's update, whatever the node is called. */
function messagesIn(update: unknown): unknown[] {
  if (Array.isArray(update)) return update.flatMap(messagesIn);
  if (isRecord(update) && Array.isArray(update.messages)) return update.messages;
  return [];
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session.userId || !session.orgId) return fail(401, "Non connecté.");
  const token = await session.getToken();
  if (token === null) return fail(401, "Session expirée : reconnectez-vous.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête illisible.");
  }
  if (!isRecord(body)) return fail(400, "Requête illisible.");
  const { analysisId, question, threadId, selected } = body;
  if (typeof analysisId !== "string" || typeof question !== "string") {
    return fail(400, "Requête incomplète.");
  }
  const asked = question.trim();
  if (asked === "" || asked.length > MAX_QUESTION) return fail(400, "Question vide ou trop longue.");

  // The asker owns this analysis: it is read under THEIR token, which the
  // org-scoping builders resolve to their organization. Anything else is null.
  const progress = await fetchQuery(api.analyses.progress, { analysisId }, { token }).catch(
    () => null,
  );
  if (progress === null) return fail(404, "Analyse introuvable.");
  if (progress.status !== "complete") return fail(409, "L'analyse n'est pas terminée.");
  // The agent runs in its own process and its runs, with the paths it looked up
  // and the answers it wrote, are recorded by that process's own tracing, which
  // cannot be masked per analysis. Until it can, a private repository is not
  // put in front of it.
  if (progress.access !== null) {
    return fail(
      403,
      "L'agent n'est pas disponible pour un dépôt privé : ses traces ne peuvent pas encore être masquées.",
    );
  }

  const client = new Client({ apiUrl: AGENT_URL });

  // A thread belongs to one analysis of one organization; its owner is written
  // on it when it is created and checked before it is continued, so a thread id
  // from another conversation is a refusal, not someone else's history.
  let thread: string;
  try {
    if (typeof threadId === "string" && threadId !== "") {
      const existing = await client.threads.get(threadId);
      const meta = existing.metadata;
      if (!isRecord(meta) || meta.analysisId !== progress.id || meta.orgId !== session.orgId) {
        return fail(403, "Cette conversation n'appartient pas à cette analyse.");
      }
      thread = existing.thread_id;
    } else {
      const created = await client.threads.create({
        metadata: { analysisId: progress.id, orgId: session.orgId, userId: session.userId },
      });
      thread = created.thread_id;
    }
  } catch {
    // The agent being down is not the application being down.
    return fail(503, "L'agent n'est pas joignable pour le moment.");
  }

  const credential = mintCredential({ orgId: session.orgId, analysisId: progress.id });
  const hint =
    typeof selected === "string" && selected !== "" && selected.length <= MAX_PATH
      ? `\n\n(Fichier sélectionné dans l'interface : ${selected})`
      : "";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const announced = new Set<string>();
      try {
        send({ type: "thread", threadId: thread });
        const run = client.runs.stream(thread, ASSISTANT, {
          input: { messages: [{ type: "human", content: `${asked}${hint}` }] },
          config: { configurable: { __credential: credential } },
          streamMode: ["updates", "messages-tuple"],
          signal: request.signal,
        });
        for await (const part of run) {
          const data: unknown = part.data;
          if (part.event === "updates" && isRecord(data)) {
            for (const message of Object.values(data).flatMap(messagesIn)) {
              for (const call of toolCallsOf(message)) {
                if (announced.has(call.id)) continue;
                announced.add(call.id);
                send({ type: "tool", id: call.id, name: call.name, args: call.args });
              }
              const result = summariseResult(message);
              if (result !== null) send({ type: "result", ...result });
            }
          } else if (part.event.startsWith("messages") && Array.isArray(data)) {
            const message: unknown = data[0];
            if (isRecord(message) && (message.type === "AIMessageChunk" || message.type === "ai")) {
              const delta = textOf(message.content);
              if (delta !== "") send({ type: "text", delta });
            }
          } else if (part.event === "error") {
            send({ type: "error", message: "L'agent a rencontré une erreur." });
          }
        }
        send({ type: "done" });
      } catch {
        send({ type: "error", message: "L'agent n'a pas pu terminer sa réponse." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
