// ClauseRadar backend — Cloudflare Worker
//
// Bindings required (set in wrangler.toml / dashboard):
//   RATE_LIMIT          KV namespace, used for daily per-device counters
//   OPENROUTER_API_KEY  secret, your OpenRouter key (wrangler secret put OPENROUTER_API_KEY)
//
// Endpoint: POST /v1/analyze  { mode: "classify" | "diff", ... }

const DAILY_LIMIT = 20;
// Pick a low-cost model from https://openrouter.ai/models — swap this for whatever
// is cheapest/fastest at the time you deploy.
const MODEL = "deepseek/deepseek-v4-flash";

// Known extension ID (update if reinstalling)
const EXTENSION_ID = "ihhclcjimmnboonghhgaddedaljcedlg";

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  // Allow the specific extension origin or any chrome-extension:// origin
  const allowOrigin = origin.startsWith("chrome-extension://") ? origin : `chrome-extension://${EXTENSION_ID}`;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type, X-Device-Id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "false"
  };
}

export default {
  async fetch(request, env) {
    const corsHeaders = getCorsHeaders(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/v1/analyze" || request.method !== "POST") {
      return json({ error: "Not found" }, 404, corsHeaders);
    }

    const deviceId = request.headers.get("X-Device-Id");
    if (!deviceId) {
      return json({ error: "Missing device id" }, 400, corsHeaders);
    }

    // ---- Rate limiting (per device, per UTC day) ----
    const today = new Date().toISOString().slice(0, 10);
    const rateKey = `${deviceId}:${today}`;
    const used = parseInt((await env.RATE_LIMIT.get(rateKey)) || "0", 10);

    if (used >= DAILY_LIMIT) {
      return json(
        { error: "Daily limit reached", quota: { used, limit: DAILY_LIMIT } },
        429,
        corsHeaders
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, corsHeaders);
    }

    const { mode } = body;
    let result;
    try {
      if (mode === "classify") {
        result = await classify(body.text, env);
      } else if (mode === "diff") {
        result = await diff(body.textA, body.textB, env);
      } else {
        return json({ error: "mode must be 'classify' or 'diff'" }, 400, corsHeaders);
      }
    } catch (err) {
      return json({ error: err.message || "Model call failed" }, 502, corsHeaders);
    }

    const newUsed = used + 1;
    await env.RATE_LIMIT.put(rateKey, String(newUsed), { expirationTtl: 60 * 60 * 24 * 2 });

    return json({ ...result, quota: { used: newUsed, limit: DAILY_LIMIT } }, 200, corsHeaders);
  }
};

function json(obj, status = 200, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

async function callModel(systemPrompt, userPrompt, env) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!res.ok) {
    throw new Error(`OpenRouter error: ${res.status}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || "";
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Model did not return valid JSON");
  }
}

const CLASSIFY_SYSTEM = `You are a regulatory affairs assistant for medical device professionals.
Classify the significance of the given clause/paragraph exactly as: "Critical", "Minor", or "Administrative".
- Critical: changes conformity requirements, safety/performance obligations, or approval pathway.
- Minor: changes process, documentation, or timelines without altering core obligations.
- Administrative: wording, formatting, numbering, or non-substantive edits.
Respond with ONLY valid JSON, no markdown: {"level": "...", "rationale": "one concise sentence"}`;

async function classify(text, env) {
  if (!text || !text.trim()) throw new Error("No text provided");
  return callModel(CLASSIFY_SYSTEM, text.slice(0, 4000), env);
}

const DIFF_SYSTEM = `You are a regulatory affairs assistant for medical device professionals.
Compare the previous and new versions of a regulatory clause. Break the comparison into
individual clause-level changes. For each change, classify impact exactly as "Critical", "Minor", or "Administrative"
using the same definitions as a standard gap analysis:
- Critical: changes conformity requirements, safety/performance obligations, or approval pathway.
- Minor: changes process, documentation, or timelines without altering core obligations.
- Administrative: wording, formatting, numbering, or non-substantive edits.
Respond with ONLY valid JSON, no markdown:
{"rows": [{"clause": "short clause label", "change": "one concise sentence describing what changed", "level": "..."}]}`;

async function diff(textA, textB, env) {
  if (!textA || !textB) throw new Error("Both versions are required");
  const userPrompt = `PREVIOUS EDITION:\n${textA.slice(0, 4000)}\n\nNEW EDITION:\n${textB.slice(0, 4000)}`;
  return callModel(DIFF_SYSTEM, userPrompt, env);
}
