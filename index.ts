/**
 * pi-cpamc: Dynamic cpamc (CLIProxyAPI) provider bridge for Pi.
 *
 * Registers one Pi provider per cpamc account so `/model` groups every account
 * with the models that account currently serves.
 *
 * ZERO hardcoded accounts or credentials:
 * - Accounts and models are fetched dynamically in real time from cpamc's Management API.
 * - Keys and endpoints are resolved in order:
 *   1. Environment variables (CPAMC_BASE_URL, CPAMC_MANAGEMENT_KEY, CPAMC_API_KEY)
 *   2. Persistent config file (~/.pi/agent/cpamc.json, managed via `/cpamc` slash command)
 *   3. Auto-discovery from local CLIProxyAPI key files (.mgmtkey / .apikey)
 *   4. Default fallback: http://127.0.0.1:8317
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface CpamcConfig {
  baseUrl: string;
  managementKey: string;
  clientApiKey: string;
}

interface SavedConfig {
  baseUrl?: string;
  managementKey?: string;
  clientApiKey?: string;
  apiKey?: string;
}

interface CpamcAccount {
  id?: string;
  name?: string;
  label?: string;
  account?: string;
  provider?: string;
  status?: string;
  disabled?: boolean;
}

interface CpamcModel {
  id?: string;
  display_name?: string;
  owned_by?: string;
  type?: string;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8317";
const CPAMC_API = "openai-completions";
const REQUEST_TIMEOUT_MS = 5000;
const RESYNC_INTERVAL_MS = 60_000;

const MODEL_CONTEXT_WINDOW = 200_000;
const MODEL_MAX_TOKENS = 8192;

/**
 * Returns the path to the persistent user configuration file.
 */
function getConfigFilePath(): string {
  const dir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(dir, "cpamc.json");
}

/**
 * Loads saved user configuration from ~/.pi/agent/cpamc.json if present.
 */
function loadSavedConfig(): SavedConfig {
  const filepath = getConfigFilePath();
  if (existsSync(filepath)) {
    try {
      const raw = readFileSync(filepath, "utf8");
      return JSON.parse(raw);
    } catch {
      // Ignore parse errors and treat as empty
    }
  }
  return {};
}

/**
 * Persists updated configuration fields to ~/.pi/agent/cpamc.json.
 */
function saveConfigPatch(patch: SavedConfig): void {
  const filepath = getConfigFilePath();
  const current = loadSavedConfig();
  const updated = { ...current, ...patch };
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(updated, null, 2), "utf8");
}

/**
 * Searches candidate file paths for a key file (.mgmtkey or .apikey)
 * and returns the trimmed content of the first existing file.
 */
function findKeyInPaths(filename: string): string | undefined {
  const candidates = [
    join(homedir(), "Documents", "CLIProxyAPI", filename),
    join(homedir(), ".cli-proxy-api", filename),
    join(homedir(), ".config", "cliproxyapi", filename),
    join(homedir(), "CLIProxyAPI", filename),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const content = readFileSync(candidate, "utf8").trim();
        if (content.length > 0) return content;
      } catch {
        // Continue searching next candidate
      }
    }
  }

  return undefined;
}

/**
 * Resolves configuration with clear priority:
 * 1. Environment variables
 * 2. Saved user config file (cpamc.json)
 * 3. Local key files (.mgmtkey / .apikey)
 * 4. Default localhost URL
 */
function resolveConfig(): CpamcConfig | undefined {
  const saved = loadSavedConfig();

  const baseUrl = (
    process.env.CPAMC_BASE_URL ||
    saved.baseUrl ||
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");

  const managementKey =
    process.env.CPAMC_MANAGEMENT_KEY ||
    saved.managementKey ||
    findKeyInPaths(".mgmtkey");

  const clientApiKey =
    process.env.CPAMC_API_KEY ||
    process.env.CPAMC_CLIENT_API_KEY ||
    saved.clientApiKey ||
    saved.apiKey ||
    findKeyInPaths(".apikey");

  if (!managementKey) {
    console.warn(
      "[pi-cpamc] No management key found. Set CPAMC_MANAGEMENT_KEY, run '/cpamc keys ...', or ensure .mgmtkey exists.",
    );
    return undefined;
  }

  if (!clientApiKey) {
    console.warn(
      "[pi-cpamc] No client API key found. Set CPAMC_API_KEY, run '/cpamc keys ...', or ensure .apikey exists.",
    );
    return undefined;
  }

  return { baseUrl, managementKey, clientApiKey };
}

async function fetchJson(
  url: string,
  managementKey: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${managementKey}`,
      Accept: "application/json",
    },
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`cpamc ${url} returned HTTP ${response.status}`);
  }

  return response.json();
}

function accountLabel(account: CpamcAccount): string {
  return account.account ?? account.label ?? account.name ?? account.id ?? "unknown";
}

function isUsable(account: CpamcAccount): boolean {
  if (account.disabled === true) return false;
  if (account.status && account.status !== "active") return false;
  return Boolean(account.id);
}

function toModelDefinition(model: CpamcModel, index: number) {
  const id = model.id ?? `cpamc-model-${index}`;
  return {
    type: "chat" as const,
    id,
    name: model.display_name ?? id,
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: MODEL_CONTEXT_WINDOW,
    maxTokens: MODEL_MAX_TOKENS,
  };
}

async function fetchAccountModels(
  baseUrl: string,
  managementKey: string,
  accountId: string,
  signal?: AbortSignal,
): Promise<CpamcModel[]> {
  const catalog = (await fetchJson(
    `${baseUrl}/v8/management/credentials/models?name=${encodeURIComponent(accountId)}`,
    managementKey,
    signal,
  )) as { models?: CpamcModel[] };

  return catalog?.models ?? [];
}

/**
 * Reconciles Pi's registered providers with cpamc's live account inventory.
 */
async function syncAccounts(
  pi: ExtensionAPI,
  config: CpamcConfig,
  registeredAccountIds: Set<string>,
  signal?: AbortSignal,
): Promise<number> {
  const credentials = (await fetchJson(
    `${config.baseUrl}/v8/management/credentials`,
    config.managementKey,
    signal,
  )) as { files?: CpamcAccount[] };

  const accounts = (credentials?.files ?? []).filter(isUsable);
  const liveAccountIds = new Set<string>();
  let registered = 0;

  for (const account of accounts) {
    const accountId = account.id as string;
    const models = await fetchAccountModels(config.baseUrl, config.managementKey, accountId, signal);
    if (models.length === 0) continue;

    liveAccountIds.add(accountId);

    pi.registerProvider(`cpamc/${accountId}`, {
      name: `cpamc — ${accountLabel(account)} (${account.provider ?? "unknown"})`,
      baseUrl: `${config.baseUrl}/v1`,
      apiKey: config.clientApiKey,
      api: CPAMC_API,
      models: models.map(toModelDefinition),
      refreshModels: async (context: { signal?: AbortSignal }) => {
        const fresh = await fetchAccountModels(config.baseUrl, config.managementKey, accountId, context?.signal);
        return fresh.map(toModelDefinition);
      },
    });

    registeredAccountIds.add(accountId);
    registered++;
  }

  // Remove providers for accounts that disappeared from cpamc
  for (const accountId of [...registeredAccountIds]) {
    if (liveAccountIds.has(accountId)) continue;
    pi.unregisterProvider(`cpamc/${accountId}`);
    registeredAccountIds.delete(accountId);
  }

  return registered;
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const registeredAccountIds = new Set<string>();

  const runSync = async (signal?: AbortSignal): Promise<number | undefined> => {
    try {
      const config = resolveConfig();
      if (!config) return undefined;
      return await syncAccounts(pi, config, registeredAccountIds, signal);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[pi-cpamc] provider sync skipped: ${reason}`);
      return undefined;
    }
  };

  // Register interactive /cpamc command for runtime status and remote VPS configuration
  pi.registerCommand("cpamc", {
    description: "Manage CLIProxyAPI (cpamc) bridge: /cpamc status | url <url> | keys <mgmt> <api> | resync",
    getArgumentCompletions: (prefix) => {
      const subcommands = ["status", "url", "keys", "resync"];
      const filtered = subcommands.filter((s) => s.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((s) => ({ value: s, label: s })) : null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || "status").toLowerCase();

      if (sub === "status") {
        const config = resolveConfig();
        const saved = loadSavedConfig();
        const baseUrl = config?.baseUrl || saved.baseUrl || DEFAULT_BASE_URL;
        const count = registeredAccountIds.size;
        ctx.ui.notify(
          `[pi-cpamc] URL: ${baseUrl} | Cuentas activas: ${count} | Keys: ${config ? "OK" : "Faltan credenciales"}`,
          config ? "info" : "warning",
        );
        return;
      }

      if (sub === "url") {
        const newUrl = parts[1];
        if (!newUrl || !/^https?:\/\//i.test(newUrl)) {
          ctx.ui.notify("Uso: /cpamc url <http://host:puerto o https://vps.com:puerto>", "error");
          return;
        }
        const cleaned = newUrl.replace(/\/+$/, "");
        saveConfigPatch({ baseUrl: cleaned });
        const registered = await runSync();
        if (registered !== undefined) {
          ctx.ui.notify(`[pi-cpamc] URL actualizada a ${cleaned}. Sincronizadas ${registered} cuenta(s).`, "info");
        } else {
          ctx.ui.notify(`[pi-cpamc] URL guardada (${cleaned}), pero falló la conexión con cpamc.`, "warning");
        }
        return;
      }

      if (sub === "keys") {
        const mgmtKey = parts[1];
        const apiKey = parts[2];
        if (!mgmtKey || !apiKey) {
          ctx.ui.notify("Uso: /cpamc keys <managementKey> <apiKey>", "error");
          return;
        }
        saveConfigPatch({ managementKey: mgmtKey, clientApiKey: apiKey });
        const registered = await runSync();
        if (registered !== undefined) {
          ctx.ui.notify(`[pi-cpamc] Keys guardadas. Sincronizadas ${registered} cuenta(s).`, "info");
        } else {
          ctx.ui.notify("[pi-cpamc] Keys guardadas, pero falló la conexión con cpamc.", "warning");
        }
        return;
      }

      if (sub === "resync") {
        const registered = await runSync();
        if (registered !== undefined) {
          ctx.ui.notify(`[pi-cpamc] Re-sincronización exitosa: ${registered} cuenta(s) activas.`, "info");
        } else {
          ctx.ui.notify("[pi-cpamc] Falló la re-sincronización.", "error");
        }
        return;
      }

      ctx.ui.notify("Subcomandos: /cpamc status | url <url> | keys <mgmt> <api> | resync", "warning");
    },
  });

  // Initial sync before completing startup
  await runSync(AbortSignal.timeout(REQUEST_TIMEOUT_MS));

  // Background recovery and dynamic account change polling
  const timer = setInterval(() => {
    void runSync();
  }, RESYNC_INTERVAL_MS);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
}
