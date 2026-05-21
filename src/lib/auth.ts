import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { getAdminConfig } from "@/lib/env";

const adminCookieName = "figyfun_admin_session";
const sessionDurationSeconds = 60 * 60 * 12;

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function signSession(expiresAt: number, username: string) {
  const { ADMIN_SESSION_SECRET } = getAdminConfig();

  return createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(`${username}.${expiresAt}`)
    .digest("base64url");
}

export function verifyAdminCredentials(username: string, password: string) {
  const config = getAdminConfig();

  return (
    safeEqual(username, config.ADMIN_USERNAME) &&
    safeEqual(password, config.ADMIN_PASSWORD)
  );
}

export async function createAdminSession() {
  const { ADMIN_USERNAME } = getAdminConfig();
  const expiresAt = Math.floor(Date.now() / 1000) + sessionDurationSeconds;
  const signature = signSession(expiresAt, ADMIN_USERNAME);
  const cookieStore = await cookies();

  cookieStore.set(adminCookieName, `${ADMIN_USERNAME}.${expiresAt}.${signature}`, {
    httpOnly: true,
    maxAge: sessionDurationSeconds,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(adminCookieName);
}

export async function isAdminAuthenticated() {
  const cookieValue = (await cookies()).get(adminCookieName)?.value;

  if (!cookieValue) {
    return false;
  }

  const [username, expiresAtText, signature] = cookieValue.split(".");
  const expiresAt = Number(expiresAtText);

  if (!username || !signature || !Number.isFinite(expiresAt)) {
    return false;
  }

  if (expiresAt <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  const { ADMIN_USERNAME } = getAdminConfig();
  const expectedSignature = signSession(expiresAt, username);

  return (
    safeEqual(username, ADMIN_USERNAME) &&
    safeEqual(signature, expectedSignature)
  );
}
