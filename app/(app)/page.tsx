import { AnalysesList } from "@/components/analyses-list";
import { RepoForm } from "@/components/repo-form";

export default function Home() {
  return (
    <div className="flex flex-col gap-3">
      <RepoForm />
      <div className="flex flex-col gap-2">
        <h1 className="text-xs font-semibold">Analyses</h1>
        <AnalysesList />
      </div>
    </div>
  );
}
