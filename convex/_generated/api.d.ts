/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analyses from "../analyses.js";
import type * as crons from "../crons.js";
import type * as explanations from "../explanations.js";
import type * as graph from "../graph.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_org from "../lib/org.js";
import type * as lib_repoUrl from "../lib/repoUrl.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lookup from "../lookup.js";
import type * as orgData from "../orgData.js";
import type * as pipeline from "../pipeline.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analyses: typeof analyses;
  crons: typeof crons;
  explanations: typeof explanations;
  graph: typeof graph;
  "lib/limits": typeof lib_limits;
  "lib/org": typeof lib_org;
  "lib/repoUrl": typeof lib_repoUrl;
  "lib/validators": typeof lib_validators;
  lookup: typeof lookup;
  orgData: typeof orgData;
  pipeline: typeof pipeline;
  seed: typeof seed;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
