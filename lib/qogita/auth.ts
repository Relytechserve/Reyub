/**
 * Qogita Buyer API auth — obtain access token via email/password.
 * @see https://api.qogita.com/auth/login/
 * @see https://qogita.readme.io/reference/auth_login_create
 */

const QOGITA_API_BASE = "https://api.qogita.com";

type TokenCache = {
  accessToken: string;
  /** epoch ms — from JWT exp or heuristic */
  expiresAt: number;
};

let cache: TokenCache | null = null;

function decodeJwtExpMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp === "number") {
      return payload.exp * 1000;
    }
  } catch {
    // not a JWT or invalid
  }
  return null;
}

/** Default cache TTL if JWT has no exp (55 min) */
const FALLBACK_TTL_MS = 55 * 60 * 1000;

function parseLoginResponse(data: unknown): { access: string; refresh?: string } {
  if (!data || typeof data !== "object") {
    throw new Error("Qogita login: empty response");
  }
  const o = data as Record<string, unknown>;
  const access =
    (typeof o.access === "string" && o.access) ||
    (typeof o.access_token === "string" && o.access_token) ||
    (typeof o.token === "string" && o.token) ||
    null;
  if (!access) {
    throw new Error(
      "Qogita login: no access token in response (expected access, access_token, or token)"
    );
  }
  const refresh =
    (typeof o.refresh === "string" && o.refresh) ||
    (typeof o.refresh_token === "string" && o.refresh_token) ||
    undefined;
  return { access, refresh };
}

/**
 * POST /auth/login/ — returns new access (and usually refresh) tokens.
 */
export async function loginWithPassword(
  email: string,
  password: string
): Promise<{ access: string; refresh?: string }> {
  const res = await fetch(`${QOGITA_API_BASE}/auth/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Qogita login: invalid JSON (${res.status})`);
  }

  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "message" in data
        ? String((data as { message?: string }).message)
        : text;
    throw new Error(`Qogita login failed (${res.status}): ${msg}`);
  }

  return parseLoginResponse(data);
}

/**
 * Returns a valid Bearer access token, using env credentials and in-memory cache.
 * Set `QOGITA_EMAIL` + `QOGITA_PASSWORD`. Optional `QOGITA_API_TOKEN` overrides
 * (only if you want to pin a long-lived token without calling login).
 */
export async function getQogitaAccessToken(): Promise<string> {
  const pinned = process.env.QOGITA_API_TOKEN?.trim();
  if (pinned) {
    return pinned;
  }

  const email = process.env.QOGITA_EMAIL?.trim();
  const password = process.env.QOGITA_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Set QOGITA_EMAIL and QOGITA_PASSWORD (or QOGITA_API_TOKEN) in the environment."
    );
  }

  const now = Date.now();
  if (cache && cache.expiresAt > now + 60_000) {
    return cache.accessToken;
  }

  const { access } = await loginWithPassword(email, password);
  const expMs = decodeJwtExpMs(access);
  const expiresAt = expMs ?? now + FALLBACK_TTL_MS;
  cache = { accessToken: access, expiresAt };
  return access;
}

/** Clear cache (e.g. after 401 from API) */
export function clearQogitaTokenCache(): void {
  cache = null;
}
