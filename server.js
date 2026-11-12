import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load a local .env file when present (Node >= 20.6). Never fail if it is absent.
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // No .env file - rely on the process environment / defaults.
}

const PORT = Number(process.env.PORT) || 3000;
const BLUE_API_BASE_URL = (
  process.env.BLUE_API_BASE_URL || "https://sign.bluemotorfinance.co.uk"
).replace(/\/+$/, "");

// Optional credentials forwarded to the Blue API. The endpoints are internal,
// so depending on the deployment they may require a session cookie and/or an
// Authorization header. These are configured via the environment, never hardcoded.
const BLUE_API_COOKIE = process.env.BLUE_API_COOKIE || "";
const BLUE_API_AUTH = process.env.BLUE_API_AUTH || "";

const app = express();

// Build the credentials sent to the Blue API for a single incoming request.
// The Blue API uses HTTP Basic auth with only a password (empty username).
// A password supplied from the login screen (forwarded as a custom header)
// takes precedence. Otherwise we fall back to the Cookie / Authorization
// values configured in the environment.
function credentialsFromRequest(req) {
  const password = req.get("x-blue-password");
  if (password) {
    const encoded = Buffer.from(`:${password}`).toString("base64");
    return { Authorization: `Basic ${encoded}` };
  }
  const headers = {};
  if (BLUE_API_COOKIE) headers.Cookie = BLUE_API_COOKIE;
  if (BLUE_API_AUTH) headers.Authorization = BLUE_API_AUTH;
  return headers;
}

function blueApiHeaders(credentials = {}, extra = {}) {
  return { ...credentials, ...extra };
}

async function fetchSessions(proposalId, credentials = {}) {
  const url = `${BLUE_API_BASE_URL}/Sessions?proposalId=${encodeURIComponent(
    proposalId,
  )}`;

  const res = await fetch(url, {
    headers: blueApiHeaders(credentials, { Accept: "application/json" }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      res.status === 401 || res.status === 403
        ? "Authentication with the Blue API failed. Check your credentials."
        : `Blue API returned ${res.status} when listing sessions.`,
    );
    err.statusCode =
      res.status === 401 || res.status === 403
        ? 401
        : res.status === 404
          ? 404
          : 502;
    err.detail = body.slice(0, 500);
    throw err;
  }

  const data = await res.json();
  const sessions = Array.isArray(data?.SignSessions) ? data.SignSessions : [];
  return sessions;
}

function summariseSessions(sessions) {
  return sessions.map((s) => ({
    sessionRef: s.SessionRef,
    documentVersion: s.DocumentVersion,
  }));
}

// Find the single session matching the requested document version.
function selectSession(sessions, documentVersion) {
  const wanted = String(documentVersion).trim();
  const matches = sessions.filter(
    (s) => String(s.DocumentVersion).trim() === wanted,
  );
  return matches;
}

// Returns { proposalId, documentVersion } validated, or throws a 400.
function validateInput(proposalId, documentVersion) {
  const pid = String(proposalId ?? "").trim();
  const version = String(documentVersion ?? "").trim();

  if (!pid) {
    const err = new Error("A proposal ID is required.");
    err.statusCode = 400;
    throw err;
  }
  if (!version) {
    const err = new Error("A document version is required.");
    err.statusCode = 400;
    throw err;
  }
  return { proposalId: pid, documentVersion: version };
}

// Preview endpoint: list the available session refs / document versions for a
// proposal so the user can confirm which version they want.
app.get("/api/sessions", async (req, res) => {
  try {
    const pid = String(req.query.proposalId ?? "").trim();
    if (!pid) {
      return res.status(400).json({ error: "A proposal ID is required." });
    }
    const sessions = await fetchSessions(pid, credentialsFromRequest(req));
    return res.json({ proposalId: pid, sessions: summariseSessions(sessions) });
  } catch (err) {
    return res
      .status(err.statusCode || 500)
      .json({ error: err.message, detail: err.detail });
  }
});

// Main endpoint: resolve the session ref from the document version and stream
// the audit pack PDF back to the browser.
app.get("/api/audit", async (req, res) => {
  try {
    const { proposalId, documentVersion } = validateInput(
      req.query.proposalId,
      req.query.documentVersion,
    );

    const credentials = credentialsFromRequest(req);
    const sessions = await fetchSessions(proposalId, credentials);

    if (sessions.length === 0) {
      return res.status(404).json({
        error: `No sign sessions found for proposal ${proposalId}.`,
      });
    }

    const matches = selectSession(sessions, documentVersion);

    if (matches.length === 0) {
      const available = [
        ...new Set(sessions.map((s) => String(s.DocumentVersion))),
      ].sort();
      return res.status(404).json({
        error: `No session found for document version ${documentVersion} on proposal ${proposalId}.`,
        availableVersions: available,
      });
    }

    if (matches.length > 1) {
      return res.status(409).json({
        error: `Multiple sessions (${matches.length}) match document version ${documentVersion} on proposal ${proposalId}. Cannot determine a single audit pack.`,
        matches: summariseSessions(matches),
      });
    }

    const sessionRef = matches[0].SessionRef;
    if (!sessionRef) {
      return res.status(502).json({
        error: `The matching session for version ${documentVersion} has no SessionRef.`,
      });
    }

    const encodedRef = encodeURIComponent(sessionRef);
    const auditUrl = `${BLUE_API_BASE_URL}/GetAudit/${encodedRef}?sessionRef=${encodedRef}`;

    const auditRes = await fetch(auditUrl, {
      headers: blueApiHeaders(credentials, { Accept: "application/pdf" }),
    });

    if (!auditRes.ok) {
      const body = await auditRes.text().catch(() => "");
      if (auditRes.status === 401 || auditRes.status === 403) {
        return res.status(401).json({
          error:
            "Authentication with the Blue API failed. Check your credentials.",
          detail: body.slice(0, 500),
        });
      }
      return res.status(auditRes.status === 404 ? 404 : 502).json({
        error: `Blue API returned ${auditRes.status} when downloading the audit pack.`,
        detail: body.slice(0, 500),
      });
    }

    const filename = `audit-pack-${proposalId}-v${documentVersion}.pdf`;
    res.setHeader(
      "Content-Type",
      auditRes.headers.get("content-type") || "application/pdf",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    const contentLength = auditRes.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const arrayBuffer = await auditRes.arrayBuffer();
    return res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    return res
      .status(err.statusCode || 500)
      .json({ error: err.message, detail: err.detail });
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Audit pack tool listening on http://localhost:${PORT}`);
  console.log(`Proxying Blue API at ${BLUE_API_BASE_URL}`);
});
