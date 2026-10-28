import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function getConfigFilePath() {
  const dir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(dir, "cpamc.json");
}

function loadSavedConfig() {
  const filepath = getConfigFilePath();
  if (existsSync(filepath)) {
    try {
      return JSON.parse(readFileSync(filepath, "utf8"));
    } catch {}
  }
  return {};
}

console.log("== [pi-cpamc] Smoke Test ==");

const saved = loadSavedConfig();

const baseUrl = (
  process.env.CPAMC_BASE_URL ||
  saved.baseUrl ||
  "http://127.0.0.1:8317"
).replace(/\/+$/, "");

const apiKey = process.env.CPAMC_API_KEY || saved.apiKey;

console.log(`Base URL: ${baseUrl}`);
console.log(`API Key Source: ${process.env.CPAMC_API_KEY ? "env:CPAMC_API_KEY" : (saved.apiKey ? "config:cpamc.json" : "NOT FOUND")}`);

if (!apiKey) {
  console.log("Aviso: No hay API key configurada todavía. Escribí /connect dentro de Pi para configurarla.");
  process.exit(0);
}

try {
  // 1. Health check
  console.log("1. Comprobando Health check (GET /)...");
  const healthRes = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(3000) });
  if (healthRes.ok) {
    const healthData = await healthRes.json().catch(() => ({}));
    console.log(`   OK: Servidor reconocido: "${healthData.message || "CLI Proxy API"}"`);
  } else {
    console.log(`   Aviso: GET / devolvió HTTP ${healthRes.status}`);
  }

  // 2. Models discovery
  console.log("2. Consultando modelos dinámicos (GET /v1/models)...");
  const modelsRes = await fetch(`${baseUrl}/v1/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!modelsRes.ok) {
    console.error(`FAIL: GET /v1/models devolvió HTTP ${modelsRes.status}`);
    process.exit(1);
  }

  const modelsJson = await modelsRes.json();
  const models = modelsJson?.data || [];

  console.log(`   OK: Se detectaron ${models.length} modelo(s) disponibles en tiempo real:`);
  for (const m of models) {
    const owner = m.owned_by ? ` (proveedor: ${m.owned_by})` : "";
    console.log(`   - ${m.id}${owner}`);
  }

  console.log("\nSUCCESS: Conectado a la API sin leer archivos de disco!");
} catch (err) {
  console.error("FAIL: Error al conectar con cpamc:", err.message);
  process.exit(1);
}
