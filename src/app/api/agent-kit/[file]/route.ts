import { readFile } from "node:fs/promises";
import path from "node:path";
import { guardLocalRequest } from "@/server/request";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  try {
    guardLocalRequest(request);
    const { file } = await params;
    if (!["connector.mjs", "package.json"].includes(file))
      return new Response("Not found", { status: 404 });
    return new Response(
      await readFile(path.join(process.cwd(), "agent-kit/mcp", file), "utf8"),
      {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${file}"`,
        },
      },
    );
  } catch {
    return new Response("Unavailable", { status: 403 });
  }
}
