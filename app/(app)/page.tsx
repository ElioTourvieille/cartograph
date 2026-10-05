import { auth } from "@clerk/nextjs/server";
import { OrgDiagnostic } from "@/components/org-diagnostic";

export default async function Home() {
  const { orgId } = await auth();

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs">
        <span className="text-muted">Organisation vue par le serveur : </span>
        <span className="font-mono">{orgId}</span>
      </p>
      <OrgDiagnostic />
    </div>
  );
}
