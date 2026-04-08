import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

function buildChallengeResponse(
  challengeCode: string,
  verificationToken: string,
  endpoint: string
): string {
  return createHash("sha256")
    .update(`${challengeCode}${verificationToken}${endpoint}`)
    .digest("hex");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const challengeCode = url.searchParams.get("challenge_code");
  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN;
  // eBay expects the endpoint value to match the callback URL exactly (no query).
  const endpoint = `${url.origin}${url.pathname}`;

  if (!challengeCode) {
    return NextResponse.json(
      { ok: false, error: "Missing challenge_code query parameter" },
      { status: 400 }
    );
  }

  if (!verificationToken) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Missing EBAY_VERIFICATION_TOKEN environment variable for eBay validation",
      },
      { status: 500 }
    );
  }

  const challengeResponse = buildChallengeResponse(
    challengeCode,
    verificationToken,
    endpoint
  );

  return NextResponse.json({ challengeResponse });
}

export async function POST(request: Request) {
  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  // TODO: Add signature validation and event processing logic before production use.
  console.log("[eBay Notification] Incoming event", payload);

  return NextResponse.json({ received: true });
}
