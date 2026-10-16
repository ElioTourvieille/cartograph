import { ConvexError, v } from "convex/values";
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
  WithoutSystemFields,
} from "convex/server";
import { mutation, query } from "../_generated/server";
import type {
  DatabaseReader,
  DatabaseWriter,
  QueryCtx,
} from "../_generated/server";
import type { DataModel, Doc, Id, TableNames } from "../_generated/dataModel";

// The one place that decides who may read a row.
//
// This file is the only one allowed to use the raw `query` and `mutation`
// builders; `pnpm check:isolation` fails if any other file imports them. A
// public function therefore cannot exist without going through `orgQuery` or
// `orgMutation`, which read the organization off the verified token and hand
// the function a database handle that can only see that organization's rows.

// Who is calling. Two kinds of token reach the builders, and both carry the
// organization the same way, so the scoping below is one code path:
//   - a person's Clerk session: the organization, nothing narrower;
//   - an agent credential, minted by our server for ONE analysis: the same
//     organization claim plus an `analysis` claim. It can read that analysis
//     and nothing else, and it cannot write at all.
type Caller = { orgId: string; analysisId: string | null };

// Clerk's v2 session token carries the active organization as `o.id`; older
// templates use a flat `org_id`.
async function readCaller(ctx: Pick<QueryCtx, "auth">): Promise<Caller> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new ConvexError("Non connecté.");

  const claim = identity.analysis;
  let analysisId: string | null = null;
  if (claim !== undefined) {
    if (typeof claim !== "string" || claim === "") {
      throw new ConvexError("Jeton d'analyse invalide.");
    }
    analysisId = claim;
  }

  const o = identity.o;
  if (typeof o === "object" && o !== null && "id" in o && o.id) {
    return { orgId: String(o.id), analysisId };
  }
  const flat = identity.org_id;
  if (typeof flat === "string" && flat !== "") return { orgId: flat, analysisId };
  throw new ConvexError("Aucune organisation active.");
}

const ONE_ANALYSIS = "Ce jeton est limité à une analyse.";
const refuse = (): never => {
  throw new ConvexError(ONE_ANALYSIS);
};

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
    installations: () =>
      db.query("installations").withIndex("by_org", (q) => q.eq("orgId", orgId)),
  } satisfies {
    [T in TableNames]: () => Query<NamedTableInfo<DataModel, T>>;
  };
}

// The rows of one analysis, through the (organization, analysis) index, so a
// page of an analysis is a range read and never a scan of the organization.
function analysisTables(
  db: DatabaseReader,
  orgId: string,
  analysisId: Id<"analyses">,
) {
  return {
    files: () =>
      db
        .query("files")
        .withIndex("by_org_analysis", (q) =>
          q.eq("orgId", orgId).eq("analysisId", analysisId),
        ),
    edges: () =>
      db
        .query("edges")
        .withIndex("by_org_analysis", (q) =>
          q.eq("orgId", orgId).eq("analysisId", analysisId),
        ),
    routes: () =>
      db
        .query("routes")
        .withIndex("by_org_analysis", (q) =>
          q.eq("orgId", orgId).eq("analysisId", analysisId),
        ),
    explanations: () =>
      db
        .query("explanations")
        .withIndex("by_org_analysis", (q) =>
          q.eq("orgId", orgId).eq("analysisId", analysisId),
        ),
    fileRoles: () =>
      db
        .query("fileRoles")
        .withIndex("by_org_analysis", (q) =>
          q.eq("orgId", orgId).eq("analysisId", analysisId),
        ),
    insights: () =>
      db
        .query("insights")
        .withIndex("by_org_analysis", (q) =>
          q.eq("orgId", orgId).eq("analysisId", analysisId),
        ),
  };
}

export type OrgDb = ReturnType<typeof scopedTables> & {
  // Rows of one analysis. The analysis itself is not checked here: ask for it
  // with get() first, which does check it belongs to this organization.
  inAnalysis(analysisId: Id<"analyses">): ReturnType<typeof analysisTables>;
  // One project by its lowercased "owner/name", through its own index: the
  // lookup "one analysis per repository" rests on. Never a scan.
  projectByRepoKey(key: string): Promise<Doc<"projects"> | null>;
  analysisOfProject(projectId: Id<"projects">): Promise<Doc<"analyses"> | null>;
  // One installation of this organization by GitHub's id, through its own index.
  installationByGithubId(githubId: number): Promise<Doc<"installations"> | null>;
  // One cached explanation by its key, through its own index.
  explanationByKey(
    analysisId: Id<"analyses">,
    key: string,
  ): Promise<Doc<"explanations"> | null>;
  // Fetching by id goes through the organization too: a row that belongs to
  // someone else comes back as null, exactly as if it did not exist.
  get<T extends TableNames>(table: T, id: Id<T>): Promise<Doc<T> | null>;
  // Turns an id typed by a person into a typed id, or null if it isn't one for
  // that table. Reads nothing, so it leaks nothing.
  normalizeId<T extends TableNames>(table: T, raw: string): Id<T> | null;
};

// `only` is the analysis an agent credential names, or null for a person. With
// one, every handle that could reach beyond that analysis refuses, and a row is
// visible only if it IS that analysis, its project, or one of its rows.
function orgDb(db: DatabaseReader, orgId: string, only: string | null): OrgDb {
  const tables: ReturnType<typeof scopedTables> =
    only === null
      ? scopedTables(db, orgId)
      : {
          projects: refuse,
          analyses: refuse,
          files: refuse,
          edges: refuse,
          routes: refuse,
          explanations: refuse,
          fileRoles: refuse,
          insights: refuse,
          installations: refuse,
        };
  return {
    ...tables,
    inAnalysis: (analysisId) => {
      if (only !== null && analysisId !== only) return refuse();
      return analysisTables(db, orgId, analysisId);
    },
    projectByRepoKey: (key) => {
      if (only !== null) return refuse();
      return db
        .query("projects")
        .withIndex("by_org_repo_key", (q) => q.eq("orgId", orgId).eq("repoKey", key))
        .first();
    },
    explanationByKey: (analysisId, key) => {
      if (only !== null) return refuse();
      return db
        .query("explanations")
        .withIndex("by_org_analysis_key", (q) =>
          q.eq("orgId", orgId).eq("analysisId", analysisId).eq("key", key),
        )
        .first();
    },
    installationByGithubId: (githubId) => {
      if (only !== null) return refuse();
      return db
        .query("installations")
        .withIndex("by_org_github", (q) => q.eq("orgId", orgId).eq("githubId", githubId))
        .first();
    },
    analysisOfProject: (projectId) => {
      if (only !== null) return refuse();
      return db
        .query("analyses")
        .withIndex("by_org_project", (q) => q.eq("orgId", orgId).eq("projectId", projectId))
        .first();
    },
    async get(table, id) {
      const doc = await db.get(table, id);
      if (doc === null || doc.orgId !== orgId) return null;
      if (only === null) return doc;
      if (table === "analyses") return id === only ? doc : null;
      if (table === "projects") {
        const claimed = db.normalizeId("analyses", only);
        const analysis = claimed === null ? null : await db.get("analyses", claimed);
        return analysis !== null && analysis.orgId === orgId && analysis.projectId === id
          ? doc
          : null;
      }
      return "analysisId" in doc && doc.analysisId === only ? doc : null;
    },
    normalizeId: (table, raw) => db.normalizeId(table, raw),
  };
}

export type OrgCtx = { db: OrgDb };

// The write side. Every insert stamps the organization, so a row cannot be
// created for another one; patch and delete look at the row first and refuse
// one that is not this organization's. There is no way to write without going
// through these. One typed method per table that is written, so no cast is
// needed to build a document.
type Insertable<T extends TableNames> = Omit<WithoutSystemFields<Doc<T>>, "orgId">;

export type OrgWriteDb = OrgDb & {
  insertProject(doc: Insertable<"projects">): Promise<Id<"projects">>;
  insertAnalysis(doc: Insertable<"analyses">): Promise<Id<"analyses">>;
  insertFile(doc: Insertable<"files">): Promise<Id<"files">>;
  insertEdge(doc: Insertable<"edges">): Promise<Id<"edges">>;
  insertFileRole(doc: Insertable<"fileRoles">): Promise<Id<"fileRoles">>;
  insertRoute(doc: Insertable<"routes">): Promise<Id<"routes">>;
  insertExplanation(doc: Insertable<"explanations">): Promise<Id<"explanations">>;
  insertInstallation(doc: Insertable<"installations">): Promise<Id<"installations">>;
  patchInstallation(
    id: Id<"installations">,
    fields: Partial<Insertable<"installations">>,
  ): Promise<void>;
  patchAnalysis(
    id: Id<"analyses">,
    fields: Partial<Insertable<"analyses">>,
  ): Promise<void>;
  delete<T extends TableNames>(table: T, id: Id<T>): Promise<void>;
};

export type OrgWriteCtx = { db: OrgWriteDb };

function orgWriteDb(db: DatabaseWriter, orgId: string): OrgWriteDb {
  // Writers are people: an agent credential never reaches this far.
  const read = orgDb(db, orgId, null);
  const owned = async (table: TableNames, id: Id<TableNames>) => {
    if ((await read.get(table, id)) === null) {
      throw new ConvexError("Ligne introuvable.");
    }
  };
  return {
    ...read,
    insertProject: (doc) => db.insert("projects", { ...doc, orgId }),
    insertAnalysis: (doc) => db.insert("analyses", { ...doc, orgId }),
    insertFile: (doc) => db.insert("files", { ...doc, orgId }),
    insertEdge: (doc) => db.insert("edges", { ...doc, orgId }),
    insertFileRole: (doc) => db.insert("fileRoles", { ...doc, orgId }),
    insertRoute: (doc) => db.insert("routes", { ...doc, orgId }),
    insertExplanation: (doc) => db.insert("explanations", { ...doc, orgId }),
    insertInstallation: (doc) => db.insert("installations", { ...doc, orgId }),
    async patchInstallation(id, fields) {
      await owned("installations", id);
      await db.patch("installations", id, fields);
    },
    async patchAnalysis(id, fields) {
      await owned("analyses", id);
      await db.patch("analyses", id, fields);
    },
    async delete(table, id) {
      await owned(table, id);
      await db.delete(table, id);
    },
  };
}

// An organization is never an argument: declaring one makes the definition
// unassignable (it would need a property nobody can supply), so a caller cannot
// name an organization other than their own.
type NoOrgArg<Args> =
  Extract<keyof Args, "orgId" | "organizationId"> extends never
    ? unknown
    : { "an organization can't be an argument": never };

type Def<
  Args extends PropertyValidators,
  Returns extends GenericValidator,
  Ctx,
> = {
  args: Args;
  returns: Returns;
  handler: (
    ctx: Ctx,
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
  def: Def<Args, Returns, OrgCtx> & NoOrgArg<Args>,
): RegisteredQuery<"public", ObjectType<Args>, Promise<Infer<Returns>>>;
export function orgQuery(
  def: Def<PropertyValidators, GenericValidator, OrgCtx>,
) {
  return query({
    args: def.args,
    returns: def.returns,
    handler: async (ctx, args) => {
      const caller = await readCaller(ctx);
      return def.handler({ db: orgDb(ctx.db, caller.orgId, caller.analysisId) }, args);
    },
  });
}

export function orgMutation<
  Args extends PropertyValidators,
  Returns extends GenericValidator,
>(
  def: Def<Args, Returns, OrgWriteCtx> & NoOrgArg<Args>,
): RegisteredMutation<"public", ObjectType<Args>, Promise<Infer<Returns>>>;
export function orgMutation(
  def: Def<PropertyValidators, GenericValidator, OrgWriteCtx>,
) {
  return mutation({
    args: def.args,
    returns: def.returns,
    handler: async (ctx, args) => {
      const caller = await readCaller(ctx);
      // A credential for one analysis reads; it does not write.
      if (caller.analysisId !== null) throw new ConvexError(ONE_ANALYSIS);
      return def.handler({ db: orgWriteDb(ctx.db, caller.orgId) }, args);
    },
  });
}

// --- the pipeline's write path -----------------------------------------------
//
// The pipeline runs in the Next.js server with no signed-in person, so it has
// no token to read an organization from. It is handed an analysis id and a
// secret that only the server and this deployment know. The secret proves who
// is calling; the organization comes from the analysis row, never from the
// caller, so a call can only ever write to the organization that owns the
// analysis it names. Without the right secret nothing is read or written.

function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < given.length; i++) {
    difference |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

export type PipelineCtx = { db: OrgWriteDb; analysis: Doc<"analyses"> };

export function pipelineMutation<
  Args extends PropertyValidators,
  Returns extends GenericValidator,
>(
  def: Def<Args, Returns, PipelineCtx> & NoOrgArg<Args>,
): RegisteredMutation<
  "public",
  ObjectType<Args> & { secret: string; analysisId: Id<"analyses"> },
  Promise<Infer<Returns>>
>;
export function pipelineMutation(
  def: Def<PropertyValidators, GenericValidator, PipelineCtx>,
) {
  return mutation({
    args: { ...def.args, secret: v.string(), analysisId: v.id("analyses") },
    returns: def.returns,
    handler: async (ctx, { secret, analysisId, ...args }) => {
      const expected = process.env.PIPELINE_SECRET;
      if (expected === undefined || expected === "") {
        throw new ConvexError("PIPELINE_SECRET n'est pas défini sur ce déploiement.");
      }
      if (!sameSecret(secret, expected)) throw new ConvexError("Accès refusé.");
      const analysis = await ctx.db.get("analyses", analysisId);
      if (analysis === null) throw new ConvexError("Analyse introuvable.");
      return def.handler(
        { db: orgWriteDb(ctx.db, analysis.orgId), analysis },
        args,
      );
    },
  });
}


// --- claiming a GitHub installation -------------------------------------------
//
// Connecting an installation is the one write that has to look across
// organizations: the same GitHub installation must never belong to two of them.
// It is a person's own organization (read off their verified token, like every
// other builder) AND the server's secret: the browser cannot call it, because
// everything that proves an installation is really being returned from GitHub
// (the signed state, the cookie, the check against GitHub) happens in our
// server, which is the only holder of that secret. The handler gets one narrow
// question to ask about other organizations, and it answers only free, mine
// or other: never whose.

export type ClaimState = "free" | "mine" | "other";
export type ClaimCtx = {
  db: OrgWriteDb;
  claimState(githubId: number): Promise<ClaimState>;
};

export function claimMutation<
  Args extends PropertyValidators,
  Returns extends GenericValidator,
>(
  def: Def<Args, Returns, ClaimCtx> & NoOrgArg<Args>,
): RegisteredMutation<
  "public",
  ObjectType<Args> & { secret: string },
  Promise<Infer<Returns>>
>;
export function claimMutation(
  def: Def<PropertyValidators, GenericValidator, ClaimCtx>,
) {
  return mutation({
    args: { ...def.args, secret: v.string() },
    returns: def.returns,
    handler: async (ctx, { secret, ...args }) => {
      const expected = process.env.PIPELINE_SECRET;
      if (expected === undefined || expected === "") {
        throw new ConvexError("PIPELINE_SECRET n'est pas défini sur ce déploiement.");
      }
      if (!sameSecret(secret, expected)) throw new ConvexError("Accès refusé.");
      const caller = await readCaller(ctx);
      if (caller.analysisId !== null) throw new ConvexError(ONE_ANALYSIS);
      return def.handler(
        {
          db: orgWriteDb(ctx.db, caller.orgId),
          claimState: async (githubId) => {
            const rows = await ctx.db
              .query("installations")
              .withIndex("by_github", (q) => q.eq("githubId", githubId))
              .take(2);
            if (rows.length === 0) return "free";
            return rows.every((r) => r.orgId === caller.orgId) ? "mine" : "other";
          },
        },
        args,
      );
    },
  });
}
