import { auth } from "@clerk/nextjs/server";
import { AnalysesList } from "@/components/analyses-list";
import { AppFrame } from "@/components/app-frame";
import { Landing } from "@/components/landing/landing";
import { RepoForm } from "@/components/repo-form";

// One address, two pages. Signed out, the root is the landing page; signed in,
// it is the dashboard, exactly where it always was, so nothing that points at
// "/" (the header link, Clerk's redirects) has to change. proxy.ts leaves this
// route open; every other route stays behind sign-in.
export default async function Home() {
  const { userId } = await auth();
  if (userId === null) return <Landing />;

  return (
    <AppFrame>
      <div className="flex flex-col gap-3">
        <RepoForm />
        <div className="flex flex-col gap-2">
          <h1 className="text-xs font-semibold">Analyses</h1>
          <AnalysesList />
        </div>
      </div>
    </AppFrame>
  );
}
