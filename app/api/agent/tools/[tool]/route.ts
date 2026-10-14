import { isToolName, runTool } from "@/lib/agent/tools";
import { loadForCredential, NotReady } from "@/lib/agent/read";

// The agent's read-only HTTP surface. The caller is the agent process, with a
// credential for one analysis in the Authorization header; there is no signed-in
// person here, which is why this path is open to the Clerk middleware (see
// proxy.ts) and checks the credential itself, through Convex.
//
// Nothing in the request names an analysis or an organization. Whatever is
// wrong with the credential, the answer is the same short refusal and no data.

export const dynamic = "force-dynamic";

const refused = () => Response.json({ error: "Accès refusé." }, { status: 401 });

export async function POST(
  request: Request,
  context: { params: Promise<{ tool: string }> },
): Promise<Response> {
  const { tool } = await context.params;
  if (!isToolName(tool)) return Response.json({ error: "Outil inconnu." }, { status: 404 });

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token === "") return refused();

  let input: unknown = {};
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && "input" in body) input = body.input;
  } catch {
    // An empty body is a call with no arguments.
  }

  try {
    const { graph, coverage } = await loadForCredential(token);
    return Response.json(runTool(tool, input, graph, coverage));
  } catch (error) {
    if (error instanceof NotReady) {
      return Response.json(
        { found: false, reason: "L'analyse n'est pas terminée." },
        { status: 409 },
      );
    }
    // Not logged with the token: only that a credential did not hold.
    console.error("[agent/tools] refusé :", error instanceof Error ? error.message : "inconnu");
    return refused();
  }
}
