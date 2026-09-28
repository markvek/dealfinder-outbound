import { notFound } from "next/navigation";
import { WorkspaceApp } from "@/components/dealfinder/workspace-app";
import { steps } from "@/lib/types";
export default async function Page({
  params,
}: {
  params: Promise<{ step: string; path?: string[] }>;
}) {
  const { step, path } = await params;
  if (![...steps, "settings"].includes(step)) notFound();
  if ((path?.length ?? 0) > 1) notFound();
  return <WorkspaceApp step={step} view={path?.[0] ?? ""} />;
}
