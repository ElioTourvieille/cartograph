"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// Live: re-runs by itself when the organization switches or the user signs out.
export function OrgDiagnostic() {
  const claim = useQuery(api.diagnostic.orgClaim);

  let text: string;
  if (claim === undefined) text = "…";
  else if (claim === null) text = "aucune identité";
  else text = claim.orgId ?? "aucune organisation active";

  return (
    <p className="text-xs">
      <span className="text-muted">Organisation vue par Convex : </span>
      <span className="font-mono">{text}</span>
    </p>
  );
}
