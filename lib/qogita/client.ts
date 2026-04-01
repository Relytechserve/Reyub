import { getQogitaAccessToken } from "@/lib/qogita/auth";

const BASE = "https://api.qogita.com";

export async function qogitaFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getQogitaAccessToken();
  const url = path.startsWith("http") ? path : `${BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
}
