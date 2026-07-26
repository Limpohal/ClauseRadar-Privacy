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
const ALLOWED_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  // Strictly allow only the known extension origin
  const allowOrigin = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
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

    // ---- Input validation ----
    const { mode, text, textA, textB, frameworks } = body;
    const validModes = ["classify", "diff", "diff-doc"];
    const validFrameworkValues = ["EU MDR", "FDA", "ISO", "EN", "ASTM", "PPER", "General or Others"];
    if (!mode || !validModes.includes(mode)) {
      return json({ error: "mode must be 'classify', 'diff', or 'diff-doc'" }, 400, corsHeaders);
    }
    // Validate frameworks array if provided
    if (frameworks !== undefined) {
      if (!Array.isArray(frameworks)) {
        return json({ error: "frameworks must be an array" }, 400, corsHeaders);
      }
      for (const fw of frameworks) {
        if (!validFrameworkValues.includes(fw)) {
          return json({ error: `invalid framework: ${fw}` }, 400, corsHeaders);
        }
      }
    }
    const selectedFrameworks = frameworks && frameworks.length > 0 ? frameworks : ["EU MDR"];
    if (mode === "classify") {
      if (!text || !text.trim()) {
        return json({ error: "text is required and must not be empty" }, 400, corsHeaders);
      }
      if (text.length > 10000) {
        return json({ error: "text too long (max 10000 characters)" }, 400, corsHeaders);
      }
    } else if (mode === "diff") {
      if (!textA || !textA.trim() || !textB || !textB.trim()) {
        return json({ error: "both textA and textB are required and must not be empty" }, 400, corsHeaders);
      }
      if (textA.length > 10000 || textB.length > 10000) {
        return json({ error: "text too long (max 10000 characters each)" }, 400, corsHeaders);
      }
    } else if (mode === "diff-doc") {
      if (!textA || !textA.trim() || !textB || !textB.trim()) {
        return json({ error: "both textA and textB are required and must not be empty" }, 400, corsHeaders);
      }
      if (textA.length > 50000 || textB.length > 50000) {
        return json({ error: "text too long (max 50000 characters each for document compare)" }, 400, corsHeaders);
      }
    }

    let result;
    try {
      if (mode === "classify") {
        result = await classify(text, env, selectedFrameworks);
      } else if (mode === "diff") {
        result = await diff(textA, textB, env, selectedFrameworks);
      } else if (mode === "diff-doc") {
        result = await diffDoc(textA, textB, env, selectedFrameworks);
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

async function callModel(systemPrompt, userPrompt, env, mode) {
  const MAX_RETRIES = 1;
  const BASE_DELAY_MS = 800;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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

    // Retry on transient errors (429, 5xx, network errors)
    const isTransient = res.status === 429 || res.status >= 500;
    if (!res.ok) {
      if (isTransient && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 800ms, 1600ms
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`OpenRouter error: ${res.status}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("Model did not return valid JSON");
    }

    // ---- Schema validation ----
    const validationError = validateResponse(parsed, mode);
    if (validationError) {
      if (attempt < MAX_RETRIES) {
        // Retry with stricter prompt
        const stricterPrompt = userPrompt + "\n\nIMPORTANT: Respond with ONLY valid JSON matching the exact schema. No extra text, no markdown.";
        return callModel(systemPrompt, stricterPrompt, env, mode);
      }
      throw new Error(`Model response validation failed: ${validationError}`);
    }

    return parsed;
  }

  // Should not reach here, but TypeScript safety
  throw new Error("Model call failed after retries");
}

function validateResponse(obj, mode) {
  if (!obj || typeof obj !== "object") return "Response is not an object";

  // Check if response has multi-framework format
  if (obj.frameworks && Array.isArray(obj.frameworks)) {
    for (const fwResult of obj.frameworks) {
      if (!fwResult.framework || typeof fwResult.framework !== "string") {
        return "Multi-framework result missing 'framework' field";
      }
      // Validate each framework result
      if (mode === "classify") {
        const error = validateClassifyResult(fwResult);
        if (error) return error;
      } else if (mode === "diff") {
        const error = validateDiffResult(fwResult);
        if (error) return error;
      }
    }
    return null;
  }

  // Single framework format (backward compatibility)
  if (mode === "classify") {
    return validateClassifyResult(obj);
  } else if (mode === "diff") {
    return validateDiffResult(obj);
  }
  return null;
}

function validateClassifyResult(obj) {
  if (!obj.level || !["Critical", "Minor", "Administrative"].includes(obj.level)) {
    return "Missing or invalid 'level' (must be Critical, Minor, or Administrative)";
  }
  if (!obj.rationale || typeof obj.rationale !== "string" || !obj.rationale.trim()) {
    return "Missing or empty 'rationale'";
  }
  if (obj.confidence !== undefined && !["high", "medium", "low"].includes(obj.confidence)) {
    return "Invalid 'confidence' (must be high, medium, or low)";
  }
  if (obj.borderline !== undefined && typeof obj.borderline !== "boolean") {
    return "Invalid 'borderline' (must be boolean)";
  }
  if (obj.alternativeLevels !== undefined) {
    if (!Array.isArray(obj.alternativeLevels) || !obj.alternativeLevels.every(l => ["Critical", "Minor", "Administrative"].includes(l))) {
      return "Invalid 'alternativeLevels' (must be array of Critical/Minor/Administrative)";
    }
  }
  return null;
}

function validateDiffResult(obj) {
  if (!Array.isArray(obj.rows)) return "Missing 'rows' array";
  for (const row of obj.rows) {
    if (!row.clause || typeof row.clause !== "string") return "Row missing 'clause'";
    if (!row.change || typeof row.change !== "string") return "Row missing 'change'";
    if (!row.level || !["Critical", "Minor", "Administrative"].includes(row.level)) {
      return "Row has missing or invalid 'level'";
    }
    if (row.confidence !== undefined && !["high", "medium", "low"].includes(row.confidence)) {
      return "Row invalid 'confidence' (must be high, medium, or low)";
    }
    if (row.borderline !== undefined && typeof row.borderline !== "boolean") {
      return "Row invalid 'borderline' (must be boolean)";
    }
    if (row.alternativeLevels !== undefined) {
      if (!Array.isArray(row.alternativeLevels) || !row.alternativeLevels.every(l => ["Critical", "Minor", "Administrative"].includes(l))) {
        return "Row invalid 'alternativeLevels'";
      }
    }
  }
  return null;
}

// Map framework display names to internal keys
const FRAMEWORK_KEYS = {
  "EU MDR": "mdr",
  "FDA": "fda",
  "ISO": "iso13485",
  "EN": "mdr", // EN standards are harmonized under MDR/IVDR
  "ASTM": "general", // ASTM test methods, use general with specific note
  "PPER": "general", // PPER - use general
  "General or Others": "general"
};

function getFrameworkPrompt(frameworkKey) {
  const frameworks = {
    mdr: `You are a regulatory affairs assistant for medical device professionals applying EU MDR 2017/745.
Classify the significance of the given clause/paragraph exactly as: "Critical", "Minor", or "Administrative".
- Critical: changes conformity requirements, safety/performance obligations (Annex I), or approval pathway.
- Minor: changes process, documentation, or timelines without altering core obligations.
- Administrative: wording, formatting, numbering, or non-substantive edits.
Respond with ONLY valid JSON, no markdown:
{"level": "...", "rationale": "one concise sentence", "citation": "exact phrase or concept from the text that triggered this classification", "confidence": "high|medium|low", "borderline": false, "alternativeLevels": []}`,
    ivdr: `You are a regulatory affairs assistant for IVD professionals applying EU IVDR 2017/746.
Classify the significance of the given clause/paragraph exactly as: "Critical", "Minor", or "Administrative".
- Critical: changes conformity requirements, safety/performance obligations (Annex I), or approval pathway.
- Minor: changes process, documentation, or timelines without altering core obligations.
- Administrative: wording, formatting, numbering, or non-substantive edits.
Respond with ONLY valid JSON, no markdown:
{"level": "...", "rationale": "one concise sentence", "citation": "exact phrase or concept from the text that triggered this classification", "confidence": "high|medium|low", "borderline": false, "alternativeLevels": []}`,
    fda: `You are a regulatory affairs assistant for medical device professionals applying FDA 21 CFR Part 820 (QSR).
Classify the significance of the given clause/paragraph exactly as: "Critical", "Minor", or "Administrative".
- Critical: changes regulatory requirements affecting safety/effectiveness, design controls (820.30), CAPA (820.100), or submission pathway (510(k)/PMA).
- Minor: changes process, documentation, or timelines without altering core QSR obligations.
- Administrative: wording, formatting, numbering, or non-substantive edits.
Respond with ONLY valid JSON, no markdown:
{"level": "...", "rationale": "one concise sentence", "citation": "exact phrase or concept from the text that triggered this classification", "confidence": "high|medium|low", "borderline": false, "alternativeLevels": []}`,
    iso13485: `You are a regulatory affairs assistant for medical device professionals applying ISO 13485:2016.
Classify the significance of the given clause/paragraph exactly as: "Critical", "Minor", or "Administrative".
- Critical: changes QMS requirements affecting product conformity, risk management (clause 7.1), design/development (clause 7.3), or supplier controls (clause 7.4).
- Minor: changes process, documentation, or timelines without altering core QMS obligations.
- Administrative: wording, formatting, numbering, or non-substantive edits.
Respond with ONLY valid JSON, no markdown:
{"level": "...", "rationale": "one concise sentence", "citation": "exact phrase or concept from the text that triggered this classification", "confidence": "high|medium|low", "borderline": false, "alternativeLevels": []}`,
    iso14971: `You are a regulatory affairs assistant for medical device professionals applying ISO 14971:2019.
Classify the significance of the given clause/paragraph exactly as: "Critical", "Minor", or "Administrative".
- Critical: changes risk management requirements affecting risk acceptability criteria, risk control measures, residual risk evaluation, or benefit-risk analysis.
- Minor: changes risk management process, documentation, or timelines without altering core risk acceptability.
- Administrative: wording, formatting, numbering, or non-substantive edits.
Respond with ONLY valid JSON, no markdown:
{"level": "...", "rationale": "one concise sentence", "citation": "exact phrase or concept from the text that triggered this classification", "confidence": "high|medium|low", "borderline": false, "alternativeLevels": []}`,
    general: `You are a regulatory affairs assistant for medical device professionals.
Classify the significance of the given clause/paragraph exactly as: "Critical", "Minor", or "Administrative".
- Critical: changes conformity requirements, safety/performance obligations, or approval pathway.
- Minor: changes process, documentation, or timelines without altering core obligations.
- Administrative: wording, formatting, numbering, or non-substantive edits.
IMPORTANT: Use "General or Others" ONLY when no other listed tag genuinely applies. If you use it, name the actual regulation or standard you have in mind within the rationale text, rather than leaving the answer vague.
Respond with ONLY valid JSON, no markdown:
{"level": "...", "rationale": "one concise sentence", "citation": "exact phrase or concept from the text that triggered this classification", "confidence": "high|medium|low", "borderline": false, "alternativeLevels": []}`
  };
  return frameworks[frameworkKey] || frameworks.general;
}

async function classifyForFramework(text, env, frameworkKey) {
  if (!text || !text.trim()) throw new Error("No text provided");
  return callModel(getFrameworkPrompt(frameworkKey), text.slice(0, 4000), env, "classify");
}

async function classify(text, env, frameworks) {
  // If only one framework, return single result for backward compatibility
  if (frameworks.length === 1) {
    const frameworkKey = FRAMEWORK_KEYS[frameworks[0]] || "mdr";
    const result = await classifyForFramework(text, env, frameworkKey);
    return { ...result, framework: frameworks[0] };
  }
  
  // Multiple frameworks: get result for each
  const results = [];
  for (const fw of frameworks) {
    const frameworkKey = FRAMEWORK_KEYS[fw] || "mdr";
    try {
      const result = await classifyForFramework(text, env, frameworkKey);
      results.push({ framework: fw, ...result });
    } catch (err) {
      results.push({ 
        framework: fw, 
        level: "Administrative", 
        rationale: `Error classifying for ${fw}: ${err.message}`,
        citation: "",
        confidence: "low",
        borderline: false,
        alternativeLevels: []
      });
    }
  }
  
  return { frameworks: results };
}

async function diff(textA, textB, env, framework) {
  if (!textA || !textB) throw new Error("Both versions are required");
  const userPrompt = `PREVIOUS EDITION:\n${textA.slice(0, 4000)}\n\nNEW EDITION:\n${textB.slice(0, 4000)}`;
  return callModel(getDiffFrameworkPrompt(framework), userPrompt, env, "diff");
}

function getDiffFrameworkPrompt(framework) {
  const prompts = {
    mdr: `You are a regulatory affairs assistant for medical device professionals applying EU MDR 2017/745.
Compare the previous and new versions of a regulatory clause. Break the comparison into
individual clause-level changes. For each change, classify impact exactly as "Critical", "Minor", or "Administrative"
using the same definitions as a standard gap analysis:
- Critical: changes conformity requirements, safety/performance obligations (Annex I), or approval pathway.
- Minor: changes process, documentation, or timelines without altering core obligations.
- Administrative: wording, formatting, numbering, or non-substantive edits.
Respond with ONLY valid JSON, no markdown:
{"rows": [{"clause": "short clause label", "change": "one concise sentence describing what changed", "level": "...", "citation": "exact phrase from old or new text that triggered this", "confidence": "high|medium|low", "borderline": false, "alternativeLevels": []}]}`,
    ivdr: `You are a regulatory affairs assistant for IVD professionals applying EU IVDR 2017/746.
Compare the previous and new versions of a regulatory clause. Break the comparison into
individual clause-level changes. For each change, classify impact exactly as "Critical", "Minor", or "Administrative"
using the same definitions as a standard gap analysis:
- Critical: changes conformity requirements, safety/performance obligations (Annex I), or approval pathway.
- Minor: changes process, documentation, or timelines without altering core obligations.
- Administrative: wording, formatting, numbering, or non-substantive edits.
Respond with ONLY valid JSON, no markdown:
{"rows": [{"clause": "short clause label", "change": "one concise sentence describing what changed", "level": "...", "citation": "exact phrase from old or new text that triggered this", "confidence": "high|medium|low", "borderline": false, "alternativeLevels": []}]}`,
    fda: `You are a regulatory affairs assistant for medical device professionals applying FDA 21 CFR Part 820 (QSR).
Compare the previous and new versions of a regulatory clause. Break the comparison into
individual clause-level changes. For each change, classify impact exactly as "Critical", "Minor", or "Administrative"
using the same definitions as a standard gap analysis:
- Critical: changes regulatory requirements affecting safety/effectiveness, design controls (820.30), CAPA (820.100), or submission pathway (510(k)/PMA).
- Minor: changes process, documentation, or timelines without altering core QSR obligations.
- Administrative: wording, formatting, numbering, or non-substantive edits.
Respond with ONLY valid JSON, no markdown:
{"rows": [{"clause": "short clause label", "change": "one concise sentence describing what changed", "level": "...", "citation": "exact phrase from old or new text that triggered this", "confidence": "high|medium|low", "borderline": false, "alternativeLevels": []}]}`,
    iso13485: `You are a regulatory affairs assistant for medical device professionals applying ISO 13485:2016.
Compare the previous and new versions of a regulatory clause. Break the comparison into
individual clause-level changes. For each change, classify impact exactly as "Critical", "Minor", or "Administrative"
using the same definitions as a standard gap analysis:
- Critical: changes QMS requirements affecting product conformity, risk management (clause 7.1), design/development (clause 7.3), or supplier controls (clause 7.4).
- Minor: changes process, documentation, or timelines without altering core QMS obligations.
- Administrative: wording, formatting, numbering, or non-substantive edits.
Respond with ONLY valid JSON, no markdown:
{"rows": [{"clause": "short clause label", "change": "one concise sentence describing what changed", "level": "...", "citation": "exact phrase from old or new text that triggered this", "confidence": "high|medium|low", "borderline": false, "alternativeLevels": []}]}`,
    iso14971: `You are a regulatory affairs assistant for medical device professionals applying ISO 14971:2019.
Compare the previous and new versions of a regulatory clause. Break the comparison into
individual clause-level changes. For each change, classify impact exactly as "Critical", "Minor", or "Administrative"
using the same definitions as a standard gap analysis:
- Critical: changes risk management requirements affecting risk acceptability criteria, risk control measures, residual risk evaluation, or benefit-risk analysis.
- Minor: changes risk management process, documentation, or timelines without altering core risk acceptability.
- Administrative: wording, formatting, numbering, or non-substantive edits.
Respond with ONLY valid JSON, no markdown:
{"rows": [{"clause": "short clause label", "change": "one concise sentence describing what changed", "level": "...", "citation": "exact phrase from old or new text that triggered this", "confidence": "high|medium|low", "borderline": false, "alternativeLevels": []}]}`,
    general: `You are a regulatory affairs assistant for medical device professionals.
Compare the previous and new versions of a regulatory clause. Break the comparison into
individual clause-level changes. For each change, classify impact exactly as "Critical", "Minor", or "Administrative"
using the same definitions as a standard gap analysis:
- Critical: changes conformity requirements, safety/performance obligations, or approval pathway.
- Minor: changes process, documentation, or timelines without altering core obligations.
- Administrative: wording, formatting, numbering, or non-substantive edits.
IMPORTANT: Use "General or Others" ONLY when no other listed tag genuinely applies. If you use it, name the actual regulation or standard you have in mind within the rationale text, rather than leaving the answer vague.
Respond with ONLY valid JSON, no markdown:
{"rows": [{"clause": "short clause label", "change": "one concise sentence describing what changed", "level": "...", "citation": "exact phrase from old or new text that triggered this", "confidence": "high|medium|low", "borderline": false, "alternativeLevels": []}]}`
  };
  return prompts[framework] || prompts.general;
}

async function diffForFramework(textA, textB, env, frameworkKey) {
  if (!textA || !textB) throw new Error("Both versions are required");
  const userPrompt = `PREVIOUS EDITION:\n${textA.slice(0, 4000)}\n\nNEW EDITION:\n${textB.slice(0, 4000)}`;
  return callModel(getDiffFrameworkPrompt(frameworkKey), userPrompt, env, "diff");
}

async function diff(textA, textB, env, frameworks) {
  // If only one framework, return single result for backward compatibility
  if (frameworks.length === 1) {
    const frameworkKey = FRAMEWORK_KEYS[frameworks[0]] || "mdr";
    const result = await diffForFramework(textA, textB, env, frameworkKey);
    return { ...result, framework: frameworks[0] };
  }
  
  // Multiple frameworks: get result for each
  const results = [];
  for (const fw of frameworks) {
    const frameworkKey = FRAMEWORK_KEYS[fw] || "mdr";
    try {
      const result = await diffForFramework(textA, textB, env, frameworkKey);
      results.push({ framework: fw, ...result });
    } catch (err) {
      results.push({ 
        framework: fw, 
        rows: [{ clause: "Comparison", change: `Error comparing for ${fw}: ${err.message}`, level: "Administrative" }]
      });
    }
  }
  
  return { frameworks: results };
}

async function diffDocForFramework(textA, textB, env, frameworkKey) {
  const segmentsA = segmentDocument(textA);
  const segmentsB = segmentDocument(textB);

  // Simple alignment by index (assumes similar structure)
  const maxSegments = Math.max(segmentsA.length, segmentsB.length);
  const sections = [];

  for (let i = 0; i < maxSegments; i++) {
    const segA = segmentsA[i] || { title: `Section ${i + 1}`, text: "" };
    const segB = segmentsB[i] || { title: `Section ${i + 1}`, text: "" };

    // Skip if both are empty
    if (!segA.text.trim() && !segB.text.trim()) continue;

    try {
      const userPrompt = `PREVIOUS EDITION:\n${segA.text.slice(0, 3000)}\n\nNEW EDITION:\n${segB.text.slice(0, 3000)}`;
      const diffResult = await callModel(getDiffFrameworkPrompt(frameworkKey), userPrompt, env, "diff");
      sections.push({
        topLevel: segA.title || `Section ${i + 1}`,
        title: segA.title,
        rows: diffResult.rows || []
      });
    } catch (err) {
      // If one segment fails, add it with error info
      sections.push({
        topLevel: segA.title || `Section ${i + 1}`,
        title: segA.title,
        rows: [{ clause: segA.title || "Segment", change: "Comparison failed", level: "Administrative" }]
      });
    }
  }

  return { sections };
}

async function diffDoc(textA, textB, env, frameworks) {
  // If only one framework, return single result for backward compatibility
  if (frameworks.length === 1) {
    const frameworkKey = FRAMEWORK_KEYS[frameworks[0]] || "mdr";
    const result = await diffDocForFramework(textA, textB, env, frameworkKey);
    return { ...result, framework: frameworks[0] };
  }
  
  // Multiple frameworks: get result for each
  const results = [];
  for (const fw of frameworks) {
    const frameworkKey = FRAMEWORK_KEYS[fw] || "mdr";
    try {
      const result = await diffDocForFramework(textA, textB, env, frameworkKey);
      results.push({ framework: fw, ...result });
    } catch (err) {
      results.push({ 
        framework: fw, 
        sections: [{ topLevel: "Error", title: "Error", rows: [{ clause: "Comparison", change: `Error comparing for ${fw}: ${err.message}`, level: "Administrative" }] }]
      });
    }
  }
  
  return { frameworks: results };
}
