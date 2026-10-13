// The retired explanation prompt, kept here and not in the application.
//
// Be plain about what this is: it is NOT a prompt that once shipped. The
// application has had one explanation prompt (v1, in lib/ai/prompts.ts). This
// is a deliberately simpler baseline written for the comparison: the same
// request, with the two things v1 adds taken out, which are the instruction to
// ground the answer in the file's listed neighbours and the rule that a path
// may only be one of those listed. What the comparison measures is therefore
// what those two things are worth.
//
// It lives with the evaluations so that no dead prompt is shipped in the
// product just so that a test can reach it.

export const V0_SYSTEM = `Explique en français, en un court paragraphe, ce que fait le fichier donné. Tu peux utiliser du \`code en ligne\`, du **gras** et des puces.`;
