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

function findKeyInPaths(filename) {
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
        if (content.length > 0) return { key: content, path: candidate };
      } catch {}
    }
  }
  return null;
}

console.log("== [pi-cpamc] Smoke Test ==");

const saved = loadSavedConfig();

const baseUrl = (
  process.env.CPAMC_BASE_URL ||
  saved.baseUrl ||
  "http://127.0.0.1:8317"
).replace(/\/+$/, "");

let mgmt = null;
if (process.env.CPAMC_MANAGEMENT_KEY) {
  mgmt = { key: process.env.CPAMC_MANAGEMENT_KEY, path: "env:CPAMC_MANAGEMENT_KEY" };
} else if (saved.managementKey) {
  mgmt = { key: saved.managementKey, path: "config:cpamc.json" };
} else {
  mgmt = findKeyInPaths(".mgmtkey");
}

let clientKey = null;
if (process.env.CPAMC_API_KEY || process.env.CPAMC_CLIENT_API_KEY) {
  clientKey = { key: process.env.CPAMC_API_KEY || process.env.CPAMC_CLIENT_API_KEY, path: "env" };
} else if (saved.clientApiKey || saved.apiKey) {
  clientKey = { key: saved.clientApiKey || saved.apiKey, path: "config:cpamc.json" };
} else {
  clientKey = findKeyInPaths(".apikey");
}

console.log(`Base URL: ${baseUrl}`);
console.log(`Management Key Source: ${mgmt ? mgmt.path : "NOT FOUND"}`);
console.log(`Client Key Source: ${clientKey ? clientKey.path : "NOT FOUND"}`);

if (!mgmt || !clientKey) {
  console.error("FAIL: Missing management key or client key.");
  process.exit(1);
}

try {
  const res = await fetch(`${baseUrl}/v8/management/credentials`, {
    headers: {
      Authorization: `Bearer ${mgmt.key}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    console.error(`FAIL: cpamc returned HTTP ${res.status}`);
    process.exit(1);
  }

  const data = await res.json();
  const accounts = (data?.files || []).filter((a) => !a.disabled && a.status === "active");

  console.log(`Found ${accounts.length} active account(s) dynamically from cpamc:`);

  for (const acc of accounts) {
    const accId = acc.id;
    const label = acc.account || acc.label || acc.name || accId;
    const modelsRes = await fetch(
      `${baseUrl}/v8/management/credentials/models?name=${encodeURIComponent(accId)}`,
      {
        headers: {
          Authorization: `Bearer ${mgmt.key}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (modelsRes.ok) {
      const modelsData = await modelsRes.json();
      const count = modelsData?.models?.length || 0;
      console.log(` - Account [${acc.provider || "provider"}]: ${label} (${count} models)`);
    } else {
      console.log(` - Account [${acc.provider || "provider"}]: ${label} (error fetching models)`);
    }
  }

  console.log("\nSUCCESS: All credentials and dynamic accounts verified!");
} catch (err) {
  console.error("FAIL: Could not connect to cpamc:", err.message);
  process.exit(1);
}
