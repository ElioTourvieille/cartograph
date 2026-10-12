import Anthropic from "@anthropic-ai/sdk";
import { wrapAnthropic } from "langsmith/wrappers/anthropic";

// The one place in the codebase that constructs the AI client. Every call to a
// model goes through the client returned here, and that client is wrapped, so
// every call is traced. A client built anywhere else would work and silently
// skip tracing, which is exactly the failure this file exists to rule out.
//
// Where traces go, and what can be hidden: LangSmith, at LANGSMITH_ENDPOINT
// (api.smith.langchain.com, the US region, unless set to the EU endpoint), in
// the project named by LANGSMITH_PROJECT. Prompts here contain other people's
// source code, and a trace stores them. Setting LANGSMITH_HIDE_INPUTS=true
// and LANGSMITH_HIDE_OUTPUTS=true stops inputs and outputs from being sent
// (the run, its timing and its token counts are still recorded). Which of those
// to set before client code goes through here is the owner's decision; this
// file only reports what is set.

/** An expected failure with a message a person can act on. */
export class AiError extends Error {}

let client: ReturnType<typeof build> | undefined;

function build() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new AiError("ANTHROPIC_API_KEY manque dans .env.local : aucun modèle ne peut être appelé.");
  }
  // Wrapped whether or not tracing is configured: with no LangSmith key the
  // wrapper does nothing, and the call succeeds untraced. aiStatus() is how
  // that state is made visible.
  return wrapAnthropic(new Anthropic({ apiKey }));
}

export function ai() {
  client ??= build();
  return client;
}

export type AiStatus = {
  /** A key to call the model is present. */
  model: boolean;
  /** Tracing is switched on and has a key: runs are being recorded. */
  tracing: boolean;
  /** Inputs and outputs are withheld from traces. */
  hiddenInputs: boolean;
  hiddenOutputs: boolean;
};

export function aiStatus(): AiStatus {
  const set = (name: string): boolean => (process.env[name] ?? "") !== "";
  return {
    model: set("ANTHROPIC_API_KEY"),
    tracing: process.env.LANGSMITH_TRACING === "true" && set("LANGSMITH_API_KEY"),
    hiddenInputs: process.env.LANGSMITH_HIDE_INPUTS === "true",
    hiddenOutputs: process.env.LANGSMITH_HIDE_OUTPUTS === "true",
  };
}
