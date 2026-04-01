"use server";

import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { userSettings, users } from "@/db/schema";
import { hashPassword } from "@/lib/password";

export type RegisterResult =
  | { ok: true }
  | { ok: false; message: string };

export async function registerUser(input: {
  name?: string;
  email: string;
  password: string;
}): Promise<RegisterResult> {
  const email = input.email.toLowerCase().trim();
  if (email.length < 3 || !email.includes("@")) {
    return { ok: false, message: "Enter a valid email." };
  }
  if (input.password.length < 8) {
    return { ok: false, message: "Password must be at least 8 characters." };
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) {
    return { ok: false, message: "An account with this email already exists." };
  }

  const passwordHash = await hashPassword(input.password);

  const [created] = await db
    .insert(users)
    .values({
      email,
      name: input.name?.trim() || null,
      passwordHash,
    })
    .returning({ id: users.id });

  if (!created) {
    return { ok: false, message: "Could not create account." };
  }

  await db.insert(userSettings).values({
    userId: created.id,
    defaultTargetMarginPct: "0.15",
    vatRegistered: false,
    defaultCapitalGbp: "1000",
    riskMix: { high: 0.6, medium: 0.3, low: 0.1 },
    maxRecommendationSkus: 8,
    minUnitsPerLine: 5,
    defaultMinOrderValueGbp: "500",
    syncTimeUk: "07:00",
    categoriesEnabled: ["health-beauty", "fragrance", "household"],
    amazonDefaultFulfilment: "FBA",
    alertPreferences: null,
    fxManual: null,
  });

  return { ok: true };
}
