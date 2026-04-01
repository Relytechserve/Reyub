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

/** Field names seen across Qogita / Django / OpenAPI variants */
const ACCESS_KEYS = [
  "access",
  "access_token",
  "accessToken",
  "token",
  "auth_token",
  "authToken",
  "jwt",
  "key",
  "bearerToken",
] as const;

const REFRESH_KEYS = [
  "refresh",
  "refresh_token",
  "refreshToken",
] as const;

function pickString(
  obj: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) {
      return v;
    }
  }
  return undefined;
}

function parseLoginResponse(data: unknown): { access: string; refresh?: string } {
  if (data === null || data === undefined) {
    throw new Error("Qogita login: empty response body");
  }

  // Rare: top-level JSON array e.g. [accessJwt, refreshJwt]
  if (Array.isArray(data) && data.length >= 1) {
    const a = data[0];
    const r = data[1];
    if (typeof a === "string" && a.length > 0) {
      return {
        access: a,
        refresh: typeof r === "string" ? r : undefined,
      };
    }
  }

  if (typeof data !== "object") {
    throw new Error("Qogita login: expected JSON object or array");
  }

  const root = data as Record<string, unknown>;

  // 1) Flat body
  let access = pickString(root, ACCESS_KEYS);
  let refresh = pickString(root, REFRESH_KEYS);

  // 2) { data: { ... } }
  if (!access && root.data && typeof root.data === "object") {
    const d = root.data as Record<string, unknown>;
    access = pickString(d, ACCESS_KEYS);
    refresh = pickString(d, REFRESH_KEYS) ?? refresh;
  }

  // 3) { tokens: { ... } } or { token: { ... } } (nested objects)
  for (const wrapKey of ["tokens", "token", "auth", "session", "credentials"]) {
    if (!access && root[wrapKey] && typeof root[wrapKey] === "object") {
      const inner = root[wrapKey] as Record<string, unknown>;
      access = pickString(inner, ACCESS_KEYS);
      refresh = pickString(inner, REFRESH_KEYS) ?? refresh;
      if (access) break;
    }
  }

  // 4) { user: { ... } } / { buyer: { ... } }
  for (const wrapKey of ["user", "buyer", "account", "profile"]) {
    if (!access && root[wrapKey] && typeof root[wrapKey] === "object") {
      const inner = root[wrapKey] as Record<string, unknown>;
      access = pickString(inner, ACCESS_KEYS);
      refresh = pickString(inner, REFRESH_KEYS) ?? refresh;
      if (access) break;
    }
  }

  // 5) Last resort: any JWT-shaped string anywhere in the tree (three base64url segments)
  if (!access) {
    const jwtLike = findJwtLikeString(root);
    if (jwtLike) {
      access = jwtLike;
    }
  }

  if (!access) {
    const keys = Object.keys(root);
    throw new Error(
      `Qogita login: could not find an access token in the JSON body. Top-level keys: ${keys.length ? keys.join(", ") : "(none)"}. If the API shape changed, open an issue with these key names (not values).`
    );
  }

  return { access, refresh };
}

const JWT_LIKE =
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+$/;

function findJwtLikeString(obj: unknown, depth = 0): string | undefined {
  if (depth > 6) return undefined;
  if (typeof obj === "string" && JWT_LIKE.test(obj)) {
    return obj;
  }
  if (obj && typeof obj === "object") {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findJwtLikeString(item, depth + 1);
        if (found) return found;
      }
    } else {
      for (const v of Object.values(obj)) {
        const found = findJwtLikeString(v, depth + 1);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function tokenFromResponseHeaders(res: Response): string | undefined {
  const h = res.headers;
  const candidates = [
    h.get("x-access-token"),
    h.get("X-Access-Token"),
    h.get("authorization"),
    h.get("Authorization"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    const bearer = c.replace(/^Bearer\s+/i, "").trim();
    if (bearer.length > 20) {
      return bearer;
    }
  }
  return undefined;
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

  const headerToken = tokenFromResponseHeaders(res);
  if (headerToken) {
    return { access: headerToken };
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
