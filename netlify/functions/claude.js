// ShieldQA — Netlify Function
// Routes:
//   action: "fetch"   → real HTTP fetch of a target site (SSRF-guarded)
//   action: "claude"  → proxy to Anthropic, returns { text }
//   action: "openai"  → proxy to OpenAI, returns { text }
//
// Required env vars (set in Netlify → Site settings → Environment variables):
//   ANTHROPIC_API_KEY   (required)
//   OPENAI_API_KEY      (required for the ensemble)
//   CLAUDE_MODEL        (optional, default below)
//   OPENAI_MODEL        (optional, default below — bump this to your newest model)

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const dns = require("dns").promises;

// ── Lightweight in-memory rate limiter ──────────────────────────────────
// Note: Lambda containers are ephemeral, so this is best-effort abuse
// protection, not a hard guarantee. For strict limits use a durable store
// (Netlify Blobs, Upstash Redis, etc.).
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_MAX = 100;                  // requests per window per IP
const rateBuckets = new Map();

function rateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const hits = (rateBuckets.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateBuckets.set(ip, hits);
  // opportunistic cleanup so the Map can't grow unbounded
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (v.every(t => now - t > RATE_WINDOW_MS)) rateBuckets.delete(k);
    }
  }
  return hits.length > RATE_MAX;
}

// ── SSRF protection ─────────────────────────────────────────────────────
function ipToBlockedReason(ip) {
  // IPv6
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return "loopback/unspecified IPv6";
    if (lower.startsWith("fc") || lower.startsWith("fd")) return "unique-local IPv6";
    if (lower.startsWith("fe80")) return "link-local IPv6";
    // IPv4-mapped IPv6 (::ffff:a.b.c.d)
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipToBlockedReason(mapped[1]);
    return null;
  }
  // IPv4
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return null;
  const [a, b] = p;
  if (a === 10) return "private 10.0.0.0/8";
  if (a === 127) return "loopback 127.0.0.0/8";
  if (a === 0) return "reserved 0.0.0.0/8";
  if (a === 169 && b === 254) return "link-local / cloud metadata 169.254.0.0/16";
  if (a === 172 && b >= 16 && b <= 31) return "private 172.16.0.0/12";
  if (a === 192 && b === 168) return "private 192.168.0.0/16";
  if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT 100.64.0.0/10";
  if (a >= 224) return "multicast/reserved";
  return null;
}

async function assertSafeUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); }
  catch { throw new Error("Malformed URL"); }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host === "metadata.google.internal") {
    throw new Error(`Blocked host: ${host}`);
  }

  // Resolve the hostname and reject any private / reserved address.
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve host: ${host}`);
  }
  for (const { address } of addrs) {
    const reason = ipToBlockedReason(address);
    if (reason) throw new Error(`Blocked: ${host} resolves to a ${reason} address`);
  }
  return u.toString();
}

// ── fetch with timeout (works on all Node versions) ─────────────────────
function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    fetch(url, options)
      .then(res => { clearTimeout(timer); resolve(res); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const ip =
    (event.headers["x-nf-client-connection-ip"]) ||
    (event.headers["client-ip"]) ||
    (event.headers["x-forwarded-for"] || "").split(",")[0].trim();

  if (rateLimited(ip)) {
    return json(429, { error: "Rate limit exceeded. Please wait a few minutes." });
  }

  const action = body.action || "claude";

  // ── ROUTE 1: Real site fetch ──────────────────────────────────────────
  if (action === "fetch") {
    const targetUrl = body.url;
    if (!targetUrl) return json(400, { error: "No URL provided" });

    let safeUrl;
    try {
      safeUrl = await assertSafeUrl(targetUrl);
    } catch (err) {
      return json(400, { error: `Refused to fetch URL: ${err.message}` });
    }

    const result = {
      url: safeUrl, status: null, redirected: false, finalUrl: safeUrl,
      responseTime: null, headers: {}, html: "", htmlLength: 0,
      error: null, robotsTxt: false, sitemapXml: false,
    };

    try {
      const start = Date.now();
      const res = await fetchWithTimeout(safeUrl, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ShieldQA/1.0; +https://shieldqa.netlify.app)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Cache-Control": "no-cache",
        },
      }, 12000);

      result.responseTime = Date.now() - start;
      result.status = res.status;
      result.redirected = res.redirected;
      result.finalUrl = res.url;
      res.headers.forEach((value, key) => { result.headers[key.toLowerCase()] = value; });

      const text = await res.text();
      result.html = text.slice(0, 80000);
      result.htmlLength = text.length;
    } catch (err) {
      result.error = err.message;
      result.status = 0;
    }

    // Probe robots.txt and sitemap.xml
    try {
      const base = new URL(safeUrl).origin;
      const [robotsRes, sitemapRes] = await Promise.allSettled([
        fetchWithTimeout(base + "/robots.txt", {}, 5000),
        fetchWithTimeout(base + "/sitemap.xml", {}, 5000),
      ]);
      result.robotsTxt = robotsRes.status === "fulfilled" && robotsRes.value.status === 200;
      result.sitemapXml = sitemapRes.status === "fulfilled" && sitemapRes.value.status === 200;
      if (result.robotsTxt) {
        try { result.robotsTxtContent = (await robotsRes.value.text()).slice(0, 2000); } catch {}
      }
    } catch {
      result.robotsTxt = false;
      result.sitemapXml = false;
    }

    return json(200, result);
  }

  // ── Normalized AI request: { action, system, user, max_tokens, model? } ─
  const system = body.system || "";
  const user = body.user || "";
  const maxTokens = Math.min(body.max_tokens || 2000, 4000);

  if (!user) return json(400, { error: "No prompt provided" });

  // ── ROUTE 2: Claude ───────────────────────────────────────────────────
  if (action === "claude") {
    if (!process.env.ANTHROPIC_API_KEY) {
      return json(500, { error: "ANTHROPIC_API_KEY not configured" });
    }
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: body.model || CLAUDE_MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return json(res.status, { error: data.error?.message || "Claude request failed" });
      }
      const text = (data.content || []).map(b => b.text || "").join("");
      return json(200, { provider: "claude", text });
    } catch (err) {
      return json(502, { error: "Claude proxy failed", details: err.message });
    }
  }

  // ── ROUTE 3: OpenAI ───────────────────────────────────────────────────
  if (action === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      return json(500, { error: "OPENAI_API_KEY not configured" });
    }
    try {
      const messages = [];
      if (system) messages.push({ role: "system", content: system });
      messages.push({ role: "user", content: user });

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: body.model || OPENAI_MODEL,
          max_tokens: maxTokens,
          messages,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return json(res.status, { error: data.error?.message || "OpenAI request failed" });
      }
      const text = data.choices?.[0]?.message?.content || "";
      return json(200, { provider: "openai", text });
    } catch (err) {
      return json(502, { error: "OpenAI proxy failed", details: err.message });
    }
  }

  return json(400, { error: `Unknown action: ${action}` });
};
