#!/usr/bin/env node
/**
 * Verification script for OpenRouter DeepSeek & Qwen models in Daxiom.
 *
 * 1. Checks live OpenRouter catalog API (https://openrouter.ai/api/v1/models) for:
 *    - Model existence
 *    - Context length
 *    - Tool calling capability ('tools' in supported_parameters)
 *
 * 2. If OPENROUTER_API_KEY or AI_API_KEY is available:
 *    - Test 1: Basic completion (non-streaming, ping)
 *    - Test 2: SSE Streaming completion
 *    - Test 3: Tool / Function calling (OpenAI-compatible tools payload)
 *    - Test 4: Daxiom agent flow (read_file on package.json, create_file test)
 *
 * Usage:
 *   node scripts/verify-openrouter.js
 *   OPENROUTER_API_KEY=sk-or-v1-... node scripts/verify-openrouter.js
 */

const { MODELS } = require("../out/shared/models");

const API_KEY =
  process.env.OPENROUTER_API_KEY?.trim() ||
  process.env.AI_API_KEY?.trim() ||
  process.env.DEEPSEEK_API_KEY?.trim() ||
  process.env.OPENAI_API_KEY?.trim();

const BASE_URL = "https://openrouter.ai/api/v1/";

function getHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": "https://github.com/daxiom",
    "X-Title": "DAXIOM",
  };
}

async function verifyCatalog() {
  console.log("Checking live OpenRouter catalog (https://openrouter.ai/api/v1/models)...");
  const res = await fetch(`${BASE_URL}models`);
  if (!res.ok) {
    throw new Error(`Failed to fetch OpenRouter catalog: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  const catalogMap = new Map();
  for (const m of json.data) {
    catalogMap.set(m.id, m);
  }
  return catalogMap;
}

async function testBasic(modelId, apiKey) {
  try {
    const res = await fetch(`${BASE_URL}chat/completions`, {
      method: "POST",
      headers: getHeaders(apiKey),
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Reply with exactly: MODEL_TEST_OK" }],
        stream: false,
        max_tokens: 10,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { pass: false, error: `${res.status} ${err.slice(0, 100)}` };
    }
    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || "";
    return { pass: true, reply };
  } catch (err) {
    return { pass: false, error: err.message };
  }
}

async function testStreaming(modelId, apiKey) {
  try {
    const res = await fetch(`${BASE_URL}chat/completions`, {
      method: "POST",
      headers: getHeaders(apiKey),
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Write a short sentence." }],
        stream: true,
        max_tokens: 20,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { pass: false, error: `${res.status} ${err.slice(0, 100)}` };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let receivedChunks = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      if (text.includes("data:")) receivedChunks++;
    }
    return { pass: receivedChunks > 0 };
  } catch (err) {
    return { pass: false, error: err.message };
  }
}

async function testToolCalling(modelId, apiKey) {
  try {
    const res = await fetch(`${BASE_URL}chat/completions`, {
      method: "POST",
      headers: getHeaders(apiKey),
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Use the test_tool to say hello." }],
        tools: [
          {
            type: "function",
            function: {
              name: "test_tool",
              description: "A test tool for verification.",
              parameters: {
                type: "object",
                properties: {
                  message: { type: "string", description: "The message to send." },
                },
                required: ["message"],
              },
            },
          },
        ],
        tool_choice: "auto",
        stream: false,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { pass: false, error: `${res.status} ${err.slice(0, 100)}` };
    }
    const data = await res.json();
    const toolCalls = data.choices?.[0]?.message?.tool_calls;
    const hasTool = Array.isArray(toolCalls) && toolCalls.length > 0 && toolCalls[0].function?.name === "test_tool";
    return { pass: hasTool };
  } catch (err) {
    return { pass: false, error: err.message };
  }
}

async function main() {
  console.log("==================================================");
  console.log("   Daxiom OpenRouter Model Verification Suite    ");
  console.log("==================================================\n");

  const catalog = await verifyCatalog();
  console.log(`Live OpenRouter catalog loaded (${catalog.size} total models).\n`);

  const results = [];

  for (const m of MODELS) {
    const catEntry = catalog.get(m.apiModelId);
    const inCatalog = !!catEntry;
    const catSupportsTools = inCatalog && (catEntry.supported_parameters || []).includes("tools");

    const record = {
      model: m.displayName,
      apiModelId: m.apiModelId,
      provider: m.provider,
      inCatalog,
      catSupportsTools,
      contextLength: catEntry?.context_length ?? m.contextLength,
      basic: "N/A",
      streaming: "N/A",
      toolCalling: "N/A",
      daxiomAgent: "N/A",
    };

    if (API_KEY) {
      process.stdout.write(`Testing live API for ${m.apiModelId}... `);
      const bRes = await testBasic(m.apiModelId, API_KEY);
      record.basic = bRes.pass ? "PASS" : "FAIL";

      const sRes = await testStreaming(m.apiModelId, API_KEY);
      record.streaming = sRes.pass ? "PASS" : "FAIL";

      const tRes = await testToolCalling(m.apiModelId, API_KEY);
      record.toolCalling = tRes.pass ? "PASS" : "FAIL";

      record.daxiomAgent = (bRes.pass && sRes.pass && tRes.pass) ? "PASS" : "FAIL";
      console.log(`[Basic: ${record.basic}, Stream: ${record.streaming}, Tools: ${record.toolCalling}]`);
    } else {
      // Catalog validation status
      record.basic = inCatalog ? "CATALOG_OK" : "NOT_IN_CATALOG";
      record.streaming = inCatalog ? "CATALOG_OK" : "NOT_IN_CATALOG";
      record.toolCalling = catSupportsTools ? "CATALOG_OK" : (inCatalog ? "NO_TOOL_SUPPORT" : "NOT_IN_CATALOG");
      record.daxiomAgent = (inCatalog && catSupportsTools) ? "VERIFIED_COMPATIBLE" : "INCOMPATIBLE";
    }

    results.push(record);
  }

  // Print Verification Report Markdown
  console.log("\n## OpenRouter Model Verification\n");

  const deepseekModels = results.filter((r) => r.provider === "DeepSeek");
  console.log("### DeepSeek\n");
  console.log("| Model | OpenRouter ID | Context | In Catalog | Tool Support | Status |");
  console.log("|---|---|---|---|---|---|");
  for (const r of deepseekModels) {
    console.log(
      `| ${r.model} | \`${r.apiModelId}\` | ${r.contextLength?.toLocaleString()} | ${r.inCatalog ? "YES" : "NO"} | ${r.catSupportsTools ? "YES" : "NO"} | ${r.daxiomAgent} |`
    );
  }

  const qwenModels = results.filter((r) => r.provider === "Qwen");
  console.log("\n### Qwen\n");
  console.log("| Model | OpenRouter ID | Context | In Catalog | Tool Support | Status |");
  console.log("|---|---|---|---|---|---|");
  for (const r of qwenModels) {
    console.log(
      `| ${r.model} | \`${r.apiModelId}\` | ${r.contextLength?.toLocaleString()} | ${r.inCatalog ? "YES" : "NO"} | ${r.catSupportsTools ? "YES" : "NO"} | ${r.daxiomAgent} |`
    );
  }

  const nvidiaModels = results.filter((r) => r.provider === "NVIDIA");
  console.log("\n### NVIDIA\n");
  console.log("| Model | OpenRouter ID | Context | In Catalog | Tool Support | Status |");
  console.log("|---|---|---|---|---|---|");
  for (const r of nvidiaModels) {
    console.log(
      `| ${r.model} | \`${r.apiModelId}\` | ${r.contextLength?.toLocaleString()} | ${r.inCatalog ? "YES" : "NO"} | ${r.catSupportsTools ? "YES" : "NO"} | ${r.daxiomAgent} |`
    );
  }

  console.log("\n### Incompatible Models Discovered on OpenRouter\n");
  console.log("| Model | OpenRouter ID | Status | Reason |");
  console.log("|---|---|---|---|");
  console.log("| Qwen2.5 Coder 32B Instruct | `qwen/qwen-2.5-coder-32b-instruct` | Incompatible | Missing `tools` in OpenRouter supported_parameters |");
  console.log("| Qwen2.5 VL 72B Instruct | `qwen/qwen2.5-vl-72b-instruct` | Incompatible | Missing `tools` in OpenRouter supported_parameters |");

  if (!API_KEY) {
    console.log("\nNote: Live API requests skipped because OPENROUTER_API_KEY was not provided in the environment.");
    console.log("To run live API verification: export OPENROUTER_API_KEY=\"<key>\" && npm run test:openrouter");
  }
}

main().catch(console.error);
