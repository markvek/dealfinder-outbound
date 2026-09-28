import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  agentSchema,
  defaultsSchema,
  type Agent,
  type AgentDefaults,
  type Role,
} from "../../lib/automation";
import { audit, getDoc, putDoc } from "./repository";
import { ApiError, requireOwner, requireScope, type Actor } from "./auth";
export function defaults(): AgentDefaults {
  return (
    getDoc<AgentDefaults>("automation_meta", "defaults") ??
    defaultsSchema.parse({})
  );
}
export function saveAgent(actor: Actor, input: unknown) {
  requireOwner(actor);
  const parsed = agentSchema.parse(input);
  const old = parsed.id ? getDoc<Agent>("agents", parsed.id) : undefined;
  if (parsed.id && !old) throw new ApiError("Agent not found.", 404);
  if (old && parsed.version !== old.version)
    throw new ApiError("Agent changed. Refresh before saving.", 409);
  if (parsed.adapter === "http") {
    const url = new URL(parsed.endpoint);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new ApiError(
        "Use an HTTP(S) endpoint without embedded credentials.",
      );
  }
  const record: Agent = {
    ...parsed,
    id: old?.id ?? randomUUID(),
    version: (old?.version ?? 0) + 1,
  };
  putDoc("agents", record.id, record);
  audit(actor.id, "agent.saved", record.id);
  return record;
}
export function saveDefaults(actor: Actor, input: unknown) {
  requireOwner(actor);
  const value = defaultsSchema.parse(input);
  new Intl.DateTimeFormat("en-US", { timeZone: value.timezone });
  for (const role of ["research", "judge", "writer", "draft-judge"] as Role[])
    if (value[role]) {
      const agent = getDoc<Agent>("agents", value[role]);
      if (!agent?.enabled || !agent.roles.includes(role))
        throw new ApiError(`Choose a supported agent for ${role}.`);
    }
  for (const overrides of Object.values(value.steps ?? {}))
    for (const [role, id] of Object.entries(overrides)) {
      if (id && id !== "none") {
        const a = getDoc<Agent>("agents", id);
        if (!a?.enabled || !a.roles.includes(role as Role))
          throw new ApiError("Choose a supported agent for step defaults.");
      }
    }
  putDoc("automation_meta", "defaults", value);
  audit(actor.id, "defaults.saved", "Agent defaults");
  return value;
}
export function readyAgent(id: string, role: Role, dated = false): Agent {
  const a = getDoc<Agent>("agents", id);
  if (!a?.enabled || !a.roles.includes(role))
    throw new ApiError(`Select an enabled ${role} agent.`);
  if (a.testedVersion !== a.version)
    throw new ApiError(
      `${a.name} must pass a capability check or register through MCP first.`,
    );
  if (role === "research" && !a.webSearch)
    throw new ApiError("The research agent needs internet search capability.");
  if (dated && !a.dateFiltering)
    throw new ApiError(`${a.name} does not support dated discovery.`);
  return a;
}
export const capabilitiesSchema = z.object({
  roles: z.array(z.enum(["research", "judge", "writer", "draft-judge"])),
  webSearch: z.boolean().default(false),
  dateFiltering: z.boolean().default(false),
});
export function registerAgent(actor: Actor, id: string, capabilities: unknown) {
  requireScope(actor, "execute");
  if (!actor.agentIds.includes(id))
    throw new ApiError("This key cannot execute for that agent.", 403);
  const a = getDoc<Agent>("agents", id);
  if (!a?.enabled || a.adapter !== "external")
    throw new ApiError("External agent not available.");
  const caps = capabilitiesSchema.parse(capabilities);
  if (
    a.roles.some((role) => !caps.roles.includes(role)) ||
    (a.roles.includes("research") && !caps.webSearch)
  )
    throw new ApiError(
      "Reported capabilities do not match the configured roles.",
    );
  const result = {
    ...a,
    testedVersion: a.version,
    lastSeen: new Date().toISOString(),
    webSearch: caps.webSearch,
    dateFiltering: caps.dateFiltering,
    lastError: undefined,
  };
  putDoc("agents", id, result);
  return result;
}
export async function callHttpAgent(
  agent: Agent,
  body: unknown,
  signal: AbortSignal,
) {
  const url = new URL(agent.endpoint);
  const allowed = (process.env.DEALFINDER_CONNECTION_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim());
  if (!allowed.includes(url.origin))
    throw new ApiError(
      `Allow ${url.origin} in DEALFINDER_CONNECTION_ORIGINS before connecting.`,
    );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new ApiError("Invalid agent endpoint.");
  const secret = agent.tokenEnv ? process.env[agent.tokenEnv] : undefined;
  if (agent.tokenEnv && !secret)
    throw new ApiError(`Configure ${agent.tokenEnv} on the server.`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal,
  });
  if (!response.ok)
    throw new ApiError(`Agent endpoint returned HTTP ${response.status}.`);
  const raw = await response.text();
  if (raw.length > 2000000) throw new ApiError("Agent response exceeded 2 MB.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError("Agent response must be JSON.");
  }
}
export async function testAgent(actor: Actor, id: string) {
  requireOwner(actor);
  const a = getDoc<Agent>("agents", id);
  if (!a || a.adapter !== "http")
    throw new ApiError("External agents register from the MCP connector.");
  try {
    const caps = capabilitiesSchema.parse(
      await callHttpAgent(
        a,
        { operation: "capabilities", protocol: "dealfinder-agent-v1" },
        AbortSignal.timeout(10000),
      ),
    );
    if (
      a.roles.some((role) => !caps.roles.includes(role)) ||
      (a.roles.includes("research") && !caps.webSearch)
    )
      throw new ApiError("Agent lacks the required capabilities.");
    if (getDoc<Agent>("agents", id)?.version !== a.version)
      throw new ApiError(
        "Agent settings changed during the test. Run it again.",
        409,
      );
    const record = {
      ...a,
      testedVersion: a.version,
      lastSeen: new Date().toISOString(),
      webSearch: caps.webSearch,
      dateFiltering: caps.dateFiltering,
      lastError: undefined,
    };
    putDoc("agents", id, record);
    return record;
  } catch (error) {
    if (getDoc<Agent>("agents", id)?.version === a.version)
      putDoc("agents", id, {
        ...a,
        lastError: "Capability check failed",
        testedVersion: undefined,
      });
    throw error instanceof ApiError
      ? error
      : new ApiError(
          "Capability check failed. Verify the endpoint contract and credentials.",
        );
  }
}

export function stepDefault(
  step: "searches" | "companies" | "review" | "outreach",
  role: Role,
) {
  const d = defaults();
  return (
    d.steps?.[step]?.[role] ||
    (step !== "companies" && role !== "research"
      ? d.steps?.companies?.[role]
      : "") ||
    d[role]
  );
}
