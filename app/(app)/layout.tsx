import type { ReactNode } from "react";
import { AppFrame } from "@/components/app-frame";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
