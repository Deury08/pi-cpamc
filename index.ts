/**
 * pi-cpamc: Dynamic cpamc (CLIProxyAPI) provider bridge for Pi.
 *
 * 100% API-driven and container/OS-agnostic:
 * - ZERO file inspection on disk: works seamlessly whether cpamc runs locally,
 *   in Docker, in WSL, in Linux, or on a remote VPS.
 * - ZERO hardcoded models: discovers whatever models cpamc serves dynamically
 *   via `GET /v1/models`.
 * - Interactive `/cpamc connect` command for one-click setup.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface CpamcConfig {
  baseUrl: string;
  apiKey: string;
}

interface SavedConfig {
  baseUrl?: string;
  apiKey?: string;
}

interface CpamcModel {
  id: string;
  object?: string;
  owned_by?: string;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8317";
const CPAMC_API = "openai-completions";
const REQUEST_TIMEOUT_MS = 5000;
const RESYNC_INTERVAL_MS = 60_000;

const MODEL_CONTEXT_WINDOW = 200_000;
const MODEL_MAX_TOKENS = 8192;

/**
 * Path to the user's persistent configuration file (~/.pi/agent/cpamc.json).
 */
function getConfigFilePath(): string {
  const dir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(dir, "cpamc.json");
}

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

function saveConfig(config: SavedConfig): void {
  const filepath = getConfigFilePath();
  const current = loadSavedConfig();
  const updated = { ...current, ...config };
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(updated, null, 2), "utf8");
}

/**
 * Resolves active configuration from environment variables or saved cpamc.json.
 */
function resolveConfig(): CpamcConfig | undefined {
  const saved = loadSavedConfig();

  const baseUrl = (
    process.env.CPAMC_BASE_URL ||
    saved.baseUrl ||
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");

  const apiKey = process.env.CPAMC_API_KEY || saved.apiKey;

  if (!apiKey) {
    return undefined;
  }

  return { baseUrl, apiKey };
}

/**
 * Checks server health via GET / (which returns {"message":"CLI Proxy API Server",...}).
 */
async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return Boolean(body && (body.message?.includes("CLI Proxy") || Array.isArray(body.endpoints)));
  } catch {
    return false;
  }
}

/**
 * Fetches dynamic list of available models from cpamc via GET /v1/models.
 */
async function fetchModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<CpamcModel[]> {
  const res = await fetch(`${baseUrl}/v1/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`cpamc GET /v1/models returned HTTP ${res.status}`);
  }

  const json = (await res.json()) as { data?: CpamcModel[] };
  return json?.data ?? [];
}

function toModelDefinition(model: CpamcModel) {
  const id = model.id;
  const ownerSuffix = model.owned_by ? ` [${model.owned_by}]` : "";
  const isThinking = id.includes("thinking") || id.includes("reason");

  return {
    type: "chat" as const,
    id,
    name: `${id}${ownerSuffix}`,
    reasoning: isThinking,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: MODEL_CONTEXT_WINDOW,
    maxTokens: MODEL_MAX_TOKENS,
  };
}

/**
 * Synchronizes available models from cpamc and registers the provider in Pi.
 */
async function syncProvider(
  pi: ExtensionAPI,
  config: CpamcConfig,
  signal?: AbortSignal,
): Promise<number> {
  const models = await fetchModels(config.baseUrl, config.apiKey, signal);
  if (models.length === 0) {
    pi.unregisterProvider("cpamc");
    return 0;
  }

  pi.registerProvider("cpamc", {
    name: "CLIProxyAPI (cpamc)",
    baseUrl: `${config.baseUrl}/v1`,
    apiKey: config.apiKey,
    api: CPAMC_API,
    models: models.map(toModelDefinition),
    refreshModels: async (context: { signal?: AbortSignal }) => {
      const fresh = await fetchModels(config.baseUrl, config.apiKey, context?.signal);
      return fresh.map(toModelDefinition);
    },
  });

  return models.length;
}

/**
 * Interactive wizard launched by `/cpamc connect`.
 */
async function runInteractiveConnect(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): Promise<void> {
  if (!ctx.ui?.input) {
    ctx.ui?.notify("El comando /cpamc connect requiere interfaz interactiva.", "warning");
    return;
  }

  const saved = loadSavedConfig();
  const currentUrl = saved.baseUrl || DEFAULT_BASE_URL;

  // Step 1: Server URL
  const inputUrl = await ctx.ui.input(
    "URL de CLIProxyAPI (presioná Enter para localhost o escribí tu VPS/Docker):",
    currentUrl,
  );

  if (inputUrl === undefined) {
    ctx.ui.notify("Conexión cancelada.", "info");
    return;
  }

  const targetUrl = (inputUrl.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(targetUrl)) {
    ctx.ui.notify("La URL debe comenzar con http:// o https://", "error");
    return;
  }

  // Step 2: Health check
  ctx.ui.notify(`Verificando conexión con ${targetUrl}...`, "info");
  const isAlive = await checkHealth(targetUrl);
  if (!isAlive) {
    ctx.ui.notify(`Aviso: ${targetUrl} no respondió al ping de saludo. Verificá que el proxy esté corriendo.`, "warning");
  }

  // Step 3: API Key
  const inputKey = await ctx.ui.input(
    "API Key de cpamc (sk-...):",
    saved.apiKey || "",
  );

  if (!inputKey || !inputKey.trim()) {
    ctx.ui.notify("Conexión cancelada: la API Key es obligatoria.", "warning");
    return;
  }

  const apiKey = inputKey.trim();

  // Step 4: Validate against /v1/models and save
  try {
    ctx.ui.notify("Consultando modelos disponibles en la API...", "info");
    const count = await syncProvider(pi, { baseUrl: targetUrl, apiKey });
    saveConfig({ baseUrl: targetUrl, apiKey });

    ctx.ui.notify(
      `[pi-cpamc] ¡Conectado con éxito! Se detectaron ${count} modelos disponibles listos para usar en /model.`,
      "info",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(`[pi-cpamc] Error al conectar: ${msg}`, "error");
  }
}

export default async function (pi: ExtensionAPI): Promise<void> {
  let isRegistered = false;

  const runSync = async (signal?: AbortSignal): Promise<number | undefined> => {
    try {
      const config = resolveConfig();
      if (!config) {
        return undefined;
      }
      const count = await syncProvider(pi, config, signal);
      isRegistered = count > 0;
      return count;
    } catch {
      // Falla cerrado en silencio para no ensuciar el input interactivo ni la terminal del TUI.
      // Si el usuario quiere diagnosticar o reintentar, usa `/cpamc status` o `/cpamc connect`.
      return undefined;
    }
  };

  // Register /cpamc management command
  pi.registerCommand("cpamc", {
    description: "Administrar CLIProxyAPI: /cpamc [connect | status | resync]",
    getArgumentCompletions: (prefix) => {
      const subcommands = ["connect", "status", "resync"];
      const filtered = subcommands.filter((s) => s.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((s) => ({ value: s, label: s })) : null;
    },
    handler: async (args, ctx) => {
      const sub = (args.trim().split(/\s+/)[0] || "status").toLowerCase();

      if (sub === "connect") {
        const parts = args.trim().split(/\s+/).filter(Boolean).slice(1);

        // Fast non-interactive invocation: /cpamc connect <url> <apiKey>
        if (parts.length >= 2) {
          const url = parts[0].replace(/\/+$/, "");
          const key = parts[1];
          try {
            const count = await syncProvider(pi, { baseUrl: url, apiKey: key });
            saveConfig({ baseUrl: url, apiKey: key });
            ctx.ui.notify(`[pi-cpamc] Conectado a ${url}. ${count} modelos disponibles.`, "info");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.ui.notify(`[pi-cpamc] Error de conexión: ${msg}`, "error");
          }
          return;
        }

        await runInteractiveConnect(ctx, pi);
        return;
      }

      if (sub === "resync") {
        const count = await runSync();
        if (count !== undefined) {
          ctx.ui.notify(`[pi-cpamc] Re-sincronización exitosa: ${count} modelos disponibles.`, "info");
        } else {
          ctx.ui.notify("[pi-cpamc] Falló la re-sincronización.", "error");
        }
        return;
      }

      // Default: status
      const config = resolveConfig();
      if (!config) {
        ctx.ui.notify("[pi-cpamc] No configurado aún. Escribí /cpamc connect para conectarte.", "warning");
        return;
      }
      ctx.ui.notify(
        `[pi-cpamc] URL: ${config.baseUrl} | Estado: ${isRegistered ? "Conectado" : "Esperando sync"} | Usá /model para elegir modelos`,
        "info",
      );
    },
  });

  // Initial sync before completing startup
  await runSync(AbortSignal.timeout(REQUEST_TIMEOUT_MS));

  // Background recovery and dynamic catalog refresh
  const timer = setInterval(() => {
    void runSync();
  }, RESYNC_INTERVAL_MS);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
}
