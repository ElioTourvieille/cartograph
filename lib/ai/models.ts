// The two models, by exact identifier. Never a moving alias: an alias changes
// under you and every cached explanation would silently come from a model
// nobody chose. The model name is part of every cache key, so re-pinning one
// of these invalidates only the explanations that model wrote.
//
// Where each identifier comes from: the model list of the Claude Code
// environment this project was built in, and checked as present by the
// Anthropic API (GET /v1/models) with this project's own key on 2026-10-12.
// The size is the reason for the choice, not a guess at quality: classifying a
// file into one of seven roles is a small, repeated question; explaining a file
// against its neighbours is the one worth the larger model.

/** Small model: assigns a role to a file no adapter could identify. */
export const CLASSIFY_MODEL = "claude-haiku-4-5-20251001";

/** Larger model: explains a file or a folded folder. */
export const EXPLAIN_MODEL = "claude-sonnet-5-5";

/**
 * Bumped when a prompt changes in a way that should not reuse old answers. It
 * is part of the cache key, so a new prompt starts a fresh cache.
 */
export const PROMPT_VERSION = "v1";
