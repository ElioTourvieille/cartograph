import { AnalysesList } from "@/components/analyses-list";

export default function Home() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xs font-semibold">Analyses</h1>
      <AnalysesList />
    </div>
  );
}
