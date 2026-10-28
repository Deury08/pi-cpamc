/**
 * pi-cpamc: Dynamic cpamc (CLIProxyAPI) provider bridge for Pi.
 *
 * Registers one Pi provider per cpamc account so `/model` groups every account
 * with the models that account currently serves.
 *
 * ZERO hardcoded accounts or credentials:
 * - Accounts and models are fetched dynamically in real time from cpamc's Management API.
 * - Keys and endpoints are resolved from environment variables or auto-discovered
 *   from local CLIProxyAPI key files (.mgmtkey / .apikey).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface CpamcConfig {
  baseUrl: string;
  managementKey: string;
  clientApiKey: string;
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
 * Resolves configuration from environment variables first, falling back
 * to auto-discovery from local CLIProxyAPI key files.
 */
function resolveConfig(): CpamcConfig | undefined {
  const baseUrl = (process.env.CPAMC_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const managementKey = process.env.CPAMC_MANAGEMENT_KEY || findKeyInPaths(".mgmtkey");
  const clientApiKey =
    process.env.CPAMC_API_KEY ||
    process.env.CPAMC_CLIENT_API_KEY ||
    findKeyInPaths(".apikey");

  if (!managementKey) {
    console.warn(
      "[pi-cpamc] No management key found. Set CPAMC_MANAGEMENT_KEY or ensure .mgmtkey exists.",
    );
    return undefined;
  }

  if (!clientApiKey) {
    console.warn(
      "[pi-cpamc] No client API key found. Set CPAMC_API_KEY or ensure .apikey exists.",
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
