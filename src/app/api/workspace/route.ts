import { z } from "zod";
import { readWorkspace, mutateWorkspace } from "@/server/store";
import { actionSchema, WorkflowError } from "@/server/workflow";
import { guardLocalRequest } from "@/server/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    guardLocalRequest(request);
  } catch {
    return Response.json({ error: "Local access only." }, { status: 403 });
  }
  return Response.json(readWorkspace(), {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(request: Request) {
  try {
    guardLocalRequest(request);
  } catch {
    return Response.json(
      { error: "Local, same-origin access only." },
      { status: 403 },
    );
  }
  try {
    const raw = await request.text();
    if (raw.length > 100000)
      return Response.json({ error: "Request is too large." }, { status: 413 });
    const parsed = z
      .object({ version: z.number().int(), action: actionSchema })
      .parse(JSON.parse(raw));
    return Response.json(mutateWorkspace(parsed.version, parsed.action));
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        { status: 400 },
      );
    if (error instanceof WorkflowError)
      return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof SyntaxError)
      return Response.json({ error: "Invalid request." }, { status: 400 });
    console.error("Workspace update failed", error);
    return Response.json(
      { error: "Could not save this change. Please try again." },
      { status: 500 },
    );
  }
}
