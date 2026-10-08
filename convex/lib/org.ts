import { ConvexError } from "convex/values";
import type {
  GenericValidator,
  Infer,
  ObjectType,
  PropertyValidators,
} from "convex/values";
import type {
  NamedTableInfo,
  Query,
  RegisteredMutation,
  RegisteredQuery,
} from "convex/server";
import { mutation, query } from "../_generated/server";
import type { DatabaseReader, QueryCtx } from "../_generated/server";
import type { DataModel, Doc, Id, TableNames } from "../_generated/dataModel";

// The one place that decides who may read a row.
//
// This file is the only one allowed to use the raw `query` and `mutation`
// builders; `pnpm check:isolation` fails if any other file imports them. A
// public function therefore cannot exist without going through `orgQuery` or
// `orgMutation`, which read the organization off the verified token and hand
// the function a database handle that can only see that organization's rows.

// Clerk's v2 session token carries the active organization as `o.id`; older
// templates use a flat `org_id`.
async function readOrgId(ctx: Pick<QueryCtx, "auth">): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new ConvexError("Non connecté.");
  const o = identity.o;
  if (typeof o === "object" && o !== null && "id" in o && o.id) {
    return String(o.id);
  }
  const flat = identity.org_id;
  if (typeof flat === "string" && flat !== "") return flat;
  throw new ConvexError("Aucune organisation active.");
}

// One entry per table, and `satisfies` makes a table added to the schema
// without an entry here a type error. Each goes through the organization
// index, so there is no way to ask a handle for "all rows".
function scopedTables(db: DatabaseReader, orgId: string) {
  return {
    projects: () =>
      db.query("projects").withIndex("by_org", (q) => q.eq("orgId", orgId)),
    analyses: () =>
      db.query("analyses").withIndex("by_org", (q) => q.eq("orgId", orgId)),
    files: () =>
      db.query("files").withIndex("by_org", (q) => q.eq("orgId", orgId)),
    edges: () =>
      db.query("edges").withIndex("by_org", (q) => q.eq("orgId", orgId)),
    routes: () =>
      db.query("routes").withIndex("by_org", (q) => q.eq("orgId", orgId)),
    explanations: () =>
      db.query("explanations").withIndex("by_org", (q) => q.eq("orgId", orgId)),
    fileRoles: () =>
      db.query("fileRoles").withIndex("by_org", (q) => q.eq("orgId", orgId)),
    insights: () =>
      db.query("insights").withIndex("by_org", (q) => q.eq("orgId", orgId)),
  } satisfies {
    [T in TableNames]: () => Query<NamedTableInfo<DataModel, T>>;
  };
}

export type OrgDb = ReturnType<typeof scopedTables> & {
  // Fetching by id goes through the organization too: a row that belongs to
  // someone else comes back as null, exactly as if it did not exist.
  get<T extends TableNames>(table: T, id: Id<T>): Promise<Doc<T> | null>;
  // Turns an id typed by a person into a typed id, or null if it isn't one for
  // that table. Reads nothing, so it leaks nothing.
  normalizeId<T extends TableNames>(table: T, raw: string): Id<T> | null;
};

function orgDb(db: DatabaseReader, orgId: string): OrgDb {
  return {
    ...scopedTables(db, orgId),
    async get(table, id) {
      const doc = await db.get(table, id);
      return doc !== null && doc.orgId === orgId ? doc : null;
    },
    normalizeId: (table, raw) => db.normalizeId(table, raw),
  };
}

export type OrgCtx = { db: OrgDb };

// An organization is never an argument: declaring one makes the definition
// unassignable (it would need a property nobody can supply), so a caller cannot
// name an organization other than their own.
type NoOrgArg<Args> =
  Extract<keyof Args, "orgId" | "organizationId"> extends never
    ? unknown
    : { "an organization can't be an argument": never };

type Def<Args extends PropertyValidators, Returns extends GenericValidator> = {
  args: Args;
  returns: Returns;
  handler: (
    ctx: OrgCtx,
    args: ObjectType<Args>,
  ) => Infer<Returns> | Promise<Infer<Returns>>;
};

// Overloads: the public signature keeps the exact argument and return types
// of the function being defined, so `api.*` references stay fully typed; the
// body only has to satisfy Convex's builders in general terms.
export function orgQuery<
  Args extends PropertyValidators,
  Returns extends GenericValidator,
>(
  def: Def<Args, Returns> & NoOrgArg<Args>,
): RegisteredQuery<"public", ObjectType<Args>, Promise<Infer<Returns>>>;
export function orgQuery(def: Def<PropertyValidators, GenericValidator>) {
  return query({
    args: def.args,
    returns: def.returns,
    handler: async (ctx, args) => {
      const orgId = await readOrgId(ctx);
      return def.handler({ db: orgDb(ctx.db, orgId) }, args);
    },
  });
}

// Read-only handle for now: the first public mutation arrives with the
// pipeline (phase 7), and the typed write operations (insert stamps the
// organization, patch and delete check ownership first) are added with it.
export function orgMutation<
  Args extends PropertyValidators,
  Returns extends GenericValidator,
>(
  def: Def<Args, Returns> & NoOrgArg<Args>,
): RegisteredMutation<"public", ObjectType<Args>, Promise<Infer<Returns>>>;
export function orgMutation(def: Def<PropertyValidators, GenericValidator>) {
  return mutation({
    args: def.args,
    returns: def.returns,
    handler: async (ctx, args) => {
      const orgId = await readOrgId(ctx);
      return def.handler({ db: orgDb(ctx.db, orgId) }, args);
    },
  });
}
