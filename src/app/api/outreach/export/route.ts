import { z } from "zod";
import { readWorkspace } from "@/server/store";
import { eligible } from "@/server/workflow";
import { guardLocalRequest } from "@/server/request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    guardLocalRequest(request);
  } catch {
    return Response.json(
      { error: "Local, same-origin access only." },
      { status: 403 },
    );
  }
  const input = z
    .object({
      id: z.string().max(100),
      version: z.number().int(),
      format: z.enum(["text", "csv"]),
    })
    .safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json({ error: "Invalid export request." }, { status: 400 });
  const state = readWorkspace();
  const draft = state.drafts.find((d) => d.id === input.data.id);
  const company = state.companies.find((c) => c.id === draft?.companyId);
  if (
    state.version !== input.data.version ||
    !draft ||
    !company ||
    !eligible(state, company.id) ||
    draft.status !== "approved" ||
    draft.approvedRevision !== draft.revision ||
    draft.decision !== company.decision ||
    draft.memoVersion !== company.memoVersion
  ) {
    return Response.json(
      {
        error:
          "This email is no longer the current approved revision. Refresh before copying or exporting.",
      },
      { status: 409 },
    );
  }
  if (input.data.format === "text")
    return Response.json({
      text: `Subject: ${draft.subject}\n\n${draft.body}`,
    });
  if (company.sample || !draft.recipient)
    return Response.json(
      { error: "CSV export requires a real company and a recipient." },
      { status: 409 },
    );
  const text = [
    ["company", "email", "subject", "body"],
    [company.name, draft.recipient, draft.subject, draft.body],
  ]
    .map((row) =>
      row
        .map(
          (v) =>
            `"${(/^[=+@\-\t\r]/.test(v) ? "'" + v : v).replaceAll('"', '""')}"`,
        )
        .join(","),
    )
    .join("\r\n");
  return Response.json({
    text,
    filename: `${company.name.toLowerCase().replace(/\W+/g, "-")}-outreach.csv`,
  });
}
