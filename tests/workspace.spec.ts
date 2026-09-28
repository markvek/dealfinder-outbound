import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { createServer, type Server } from "node:http";
let mock: Server;
test.beforeAll(async () => {
  mock = createServer(async (req, res) => {
    if (req.method === "GET" || req.method === "DELETE") {
      res.writeHead(405);
      res.end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const rpc = JSON.parse(body);
    if (rpc.id === undefined) {
      res.writeHead(202);
      res.end();
      return;
    }
    const result =
      rpc.method === "initialize"
        ? {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "Test research server", version: "1.0.0" },
          }
        : {
            tools: [
              {
                name: "search_companies",
                description: "Find companies",
                inputSchema: { type: "object" },
              },
            ],
          };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  });
  await new Promise<void>((resolve) =>
    mock.listen(55212, "127.0.0.1", resolve),
  );
});
test.afterAll(async () => {
  mock.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    mock.close((e) => (e ? reject(e) : resolve())),
  );
});

test("four workflow tabs, scoped sidebar, persisted search creation and settings", async ({
  page,
}) => {
  await page.goto("/searches");
  await expect(
    page.getByRole("heading", { name: "Searches", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Core workflow" }).getByRole("link"),
  ).toHaveCount(4);
  await page
    .getByRole("button", { name: "New search", exact: true })
    .last()
    .click();
  await page.getByLabel("Search name").fill("Healthcare infrastructure");
  await page
    .getByLabel("Investment focus")
    .fill("Essential operational software for clinics.");
  await page
    .getByRole("button", { name: "Create search", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page
      .locator(".search-card")
      .filter({ hasText: "Healthcare infrastructure" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .locator(".search-card")
      .filter({ hasText: "Healthcare infrastructure" }),
  ).toBeVisible();
  await page
    .locator(".search-card")
    .filter({ hasText: "Healthcare infrastructure" })
    .click();
  await page.getByRole("button", { name: "Move to past searches" }).click();
  await expect(
    page.getByRole("button", { name: "Restore search" }),
  ).toBeVisible();
  await page.goto("/searches/settings");
  await page.getByLabel("Minimum employees", { exact: true }).fill("75");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  await page.reload();
  await expect(
    page.getByLabel("Minimum employees", { exact: true }),
  ).toHaveValue("75");
});
test("review, email edits and approval persist; already-talking cancels eligibility", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Sender name", { exact: true }).fill("Taylor Morgan");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  await page.goto("/review/forgeworks");
  await page
    .getByLabel("Review notes (optional)")
    .fill("Strong operational fit.");
  await page.getByRole("button", { name: /Good — I’ll reach out/ }).click();
  await expect(
    page.getByRole("button", { name: "Generate outreach" }),
  ).toBeVisible();
  const api = async (command: string, input: unknown, token?: string) => {
    const r = await page.request.post("/api/automation", {
      headers: token
        ? { Authorization: `Bearer ${token}` }
        : { Origin: "http://127.0.0.1:55211" },
      data: { command, input, key: crypto.randomUUID() },
    });
    expect(r.ok(), await r.text()).toBe(true);
    return (await r.json()).result;
  };
  const agent = await api("agent.save", {
    name: "Test writer",
    adapter: "external",
    roles: ["writer"],
  });
  const key = await api("key.create", {
    name: "Test executor",
    days: 1,
    scopes: ["execute", "read"],
    agentIds: [agent.id],
  });
  await api(
    "worker.register",
    { agentId: agent.id, capabilities: { roles: ["writer"] } },
    key.token,
  );
  await api("defaults.save", { writer: agent.id });
  await page.reload();
  await page.getByRole("button", { name: "Generate outreach" }).click();
  await page.getByRole("button", { name: "Queue jobs", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("1 jobs queued");
  const claimed = await api("worker.claim", { agentId: agent.id }, key.token);
  await api(
    "worker.complete",
    {
      id: claimed.id,
      leaseToken: claimed.leaseToken,
      result: {
        subject: "Introduction",
        body: "Hi Sam, could we discuss production planning?",
        costUsd: 0.01,
      },
    },
    key.token,
  );
  const generated = await (await page.request.get("/api/workspace")).json();
  await page.goto(`/outreach/${generated.drafts[0].id}`);

  await expect(
    page.getByRole("heading", { name: "Email draft", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Message", { exact: true })
    .fill(
      "Hi Sam,\n\nYour production planning software is central to your customers’ operations. Would you be open to a conversation?\n\nBest,\nTaylor",
    );
  await page.getByLabel("Recipient email").fill("sam@example.com");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve email", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Approve email", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Approved for manual handoff" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  const snapshot = await (await page.request.get("/api/workspace")).json();
  const draftId = snapshot.drafts.find(
    (d: { companyId: string }) => d.companyId === "forgeworks",
  ).id;
  const approvedText = await page.request.post("/api/outreach/export", {
    headers: { Origin: "http://127.0.0.1:55211" },
    data: { id: draftId, version: snapshot.version, format: "text" },
  });
  expect(approvedText.status()).toBe(200);
  const staleExport = await page.request.post("/api/outreach/export", {
    headers: { Origin: "http://127.0.0.1:55211" },
    data: { id: draftId, version: snapshot.version - 1, format: "text" },
  });
  expect(staleExport.status()).toBe(409);
  const sampleExport = await page.request.post("/api/outreach/export", {
    headers: { Origin: "http://127.0.0.1:55211" },
    data: { id: draftId, version: snapshot.version, format: "csv" },
  });
  expect(sampleExport.status()).toBe(409);

  await page
    .getByLabel("Subject", { exact: true })
    .fill("Updated introduction");
  await expect(page.getByRole("button", { name: "Copy email" })).toBeDisabled();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Approved for manual handoff" }),
  ).not.toBeVisible();
  await page.goto("/review/forgeworks");
  await page.getByRole("button", { name: /Good — already talking/ }).click();
  await expect(
    page.getByRole("button", { name: "Generate outreach" }),
  ).not.toBeVisible();
  await page.reload();
  await expect(page.locator(".current-decision")).toContainText(
    "already talking",
  );
});
test("MCP connection performs initialization and tool discovery", async ({
  page,
}) => {
  await page.goto("/settings");
  await page
    .getByLabel("MCP server endpoint")
    .fill("http://127.0.0.1:55212/mcp");
  await page.getByRole("button", { name: "Save & test connection" }).click();
  await expect(page.locator(".connection-result")).toContainText(
    "Connected to Test research server",
    { timeout: 20000 },
  );
  await expect(page.locator(".connection-result")).toContainText(
    "search_companies",
  );
});
test("stale writes and cross-origin mutations are rejected", async ({
  request,
}) => {
  const data = await (await request.get("/api/workspace")).json();
  const response = await request.post("/api/workspace", {
    headers: { Origin: "http://127.0.0.1:55211" },
    data: {
      version: data.version - 1,
      action: { type: "search.archive", id: "industrial-software" },
    },
  });
  expect(response.status()).toBe(409);
  const external = await request.post("/api/workspace", {
    headers: { Origin: "https://untrusted.example" },
    data: {},
  });
  expect(external.status()).toBe(403);
});
test("mobile navigation and layout have no horizontal page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/searches");
  await expect(
    page.getByRole("heading", { name: "Searches", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(
    page.getByRole("complementary", { name: "Step navigation" }),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "Close sidebar", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Core workflow" })
    .getByRole("link", { name: "Companies" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Companies", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".context/companies-mobile.png",
    fullPage: true,
  });
});

test("agents, dated searches, schedule preview, navigation and MCP keys", async ({
  page,
}) => {
  await page.goto("/settings/agents");
  await page.getByRole("button", { name: "Add agent", exact: true }).click();
  await page
    .getByLabel("Agent name", { exact: true })
    .fill("Research reviewer");
  await page
    .getByLabel("Connection type", { exact: true })
    .selectOption("external");
  await page
    .getByText("Company secondary review", { exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Save agent", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const state = await (await page.request.get("/api/automation")).json();
  const agent = state.agents.find(
    (a: { name: string }) => a.name === "Research reviewer",
  );
  const issue = await page.request.post("/api/automation", {
    headers: { Origin: "http://127.0.0.1:55211" },
    data: {
      command: "key.create",
      input: {
        name: "MCP integration test",
        days: 1,
        scopes: ["read", "jobs", "schedules", "execute"],
        agentIds: [agent.id],
      },
    },
  });
  expect(issue.ok(), await issue.text()).toBe(true);
  const { token, key } = (await issue.json()).result;
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.resolve("agent-kit/mcp/connector.mjs")],
    env: {
      ...process.env,
      DEALFINDER_URL: "http://127.0.0.1:55211",
      DEALFINDER_TOKEN: token,
    } as Record<string, string>,
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("agent_claim");
    const call = async (name: string, input: Record<string, unknown>) => {
      const r = await client.callTool({
        name,
        arguments: { input, key: crypto.randomUUID() },
      });
      expect(r.isError, JSON.stringify(r)).not.toBe(true);
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    await call("agent_register", {
      agentId: agent.id,
      capabilities: {
        roles: ["research", "judge"],
        webSearch: true,
        dateFiltering: true,
      },
    });
    await page.goto("/searches/industrial-software");
    await page
      .getByRole("button", { name: "Run / schedule once", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Internet research", { exact: true })
      .selectOption(agent.id);
    await page
      .getByRole("dialog")
      .getByLabel("Company secondary review", { exact: true })
      .selectOption("none");
    await page
      .getByRole("dialog")
      .getByLabel("Research date window")
      .selectOption("range");
    await page.getByLabel("Research from (UTC)").fill("2026-09-01");
    await page.getByLabel("Research through (UTC)").fill("2026-09-15");
    await page
      .getByRole("dialog")
      .getByLabel("Additional instructions", { exact: true })
      .fill("Prioritize ownership changes.");
    await page
      .getByRole("button", { name: "Queue search", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    const claimed = await call("agent_claim", { agentId: agent.id });
    expect(claimed.snapshot.window.from).toBe("2026-09-01T00:00:00.000Z");
    await call("agent_complete", {
      id: claimed.id,
      leaseToken: claimed.leaseToken,
      result: { companies: [], costUsd: 0 },
    });
    await page
      .locator("details.panel")
      .filter({ hasText: "Recurring schedule" })
      .locator("summary")
      .first()
      .click();
    await page
      .getByRole("button", { name: "Preview next dates", exact: true })
      .click();
    await expect(page.locator("details.panel[open]")).toContainText(
      "(America/Los_Angeles)",
    );
    await page.goto("/companies/forgeworks");
    await expect(
      page.getByRole("button", { name: "Previous company", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Next company", exact: true }),
    ).toBeDisabled();
    const denied = await page.request.post("/api/workspace", {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: "http://127.0.0.1:55211",
      },
      data: {},
    });
    expect(denied.status()).toBe(403);
    await page.request.post("/api/automation", {
      headers: { Origin: "http://127.0.0.1:55211" },
      data: { command: "key.revoke", input: { id: key.id } },
    });
    const revoked = await client.callTool({
      name: "workspace_read",
      arguments: {},
    });
    expect(revoked.isError).toBe(true);
  } finally {
    await client.close();
  }
  await page.goto("/settings/access");
  await expect(
    page.getByRole("heading", { name: "Agent access", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".context/agent-access.png", fullPage: true });
});

test("company ID navigation retains filtered list and warns about unsaved notes", async ({
  page,
}) => {
  for (const name of ["Navigation Alpha", "Navigation Beta"]) {
    const state = await (await page.request.get("/api/workspace")).json();
    const response = await page.request.post("/api/workspace", {
      headers: { Origin: "http://127.0.0.1:55211" },
      data: {
        version: state.version,
        action: {
          type: "company.add",
          company: {
            searchId: "industrial-software",
            name,
            domain: name.endsWith("Alpha")
              ? "nav-alpha.example"
              : "nav-beta.example",
            category: "Industrial software",
            geography: "United States",
            employees: 100,
            revenue: 80,
            description: "Navigation test fixture",
            customers: "Manufacturers",
            criticality: "Planning",
            concern: "Verify scale",
            source: "https://evidence.example/product",
          },
        },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await page.goto("/companies");
  await page.getByPlaceholder("Find a company…").fill("Navigation");
  const first = page.locator(".companies-table tbody tr").first();
  await first.getByRole("link").first().click();
  await expect(page.locator(".company-navigation")).toContainText("1 / 2");
  await page.getByLabel("Review notes (optional)").fill("Unsaved note");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Next company", exact: true }).click();
  await expect(page.locator(".company-navigation")).toContainText("1 / 2");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Next company", exact: true }).click();
  await expect(page.locator(".company-navigation")).toContainText("2 / 2");
  await expect(page.getByLabel("Review notes (optional)")).toHaveValue("");
  await page
    .getByRole("link", { name: "← All companies", exact: true })
    .click();
  await expect(page.getByPlaceholder("Find a company…")).toHaveValue(
    "Navigation",
  );
  await expect(page.locator(".companies-table tbody tr")).toHaveCount(2);
});
