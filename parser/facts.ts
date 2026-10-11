// What the parser reads from a file's syntax, with no idea what it is for:
// directives at the top, the names it exports, its classes with their
// decorators, and the calls an adapter asked to watch. An adapter turns these
// into roles and routes; the parser core never looks at what they mean.

/**
 * A literal argument as written. A string stays a string, an array and an
 * object keep their shape, and anything that is not a plain literal (a
 * variable, a call, a template with substitutions) is null. null means "not
 * recoverable from the syntax", and an adapter must treat it that way.
 */
export type Arg = string | null | { array: Arg[] } | { object: Record<string, Arg> };

export type DecoratorFact = { name: string; args: Arg[] };

export type ClassFact = {
  name: string | null;
  decorators: DecoratorFact[];
  methods: { name: string; decorators: DecoratorFact[] }[];
};

export type CallFact = { name: string; args: Arg[] };

export type FileFacts = {
  /** String directives opening the file, such as "use client". */
  directives: string[];
  /** Names the file exports (and "default"), not counting re-exports. */
  exports: string[];
  classes: ClassFact[];
  /** Calls whose name an adapter asked for, with their literal arguments. */
  calls: CallFact[];
};

export const NO_FACTS: FileFacts = { directives: [], exports: [], classes: [], calls: [] };
