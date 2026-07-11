import { createHash, timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../../config/env.js";
import { SESSION_COOKIE_NAME } from "../../shared/constants.js";

// The session is a signed cookie (@fastify/cookie HMAC with SESSION_SECRET)
// whose value is the login timestamp in epoch milliseconds. No server-side
// session store — restarts keep everyone logged in until the TTL lapses.

export function passwordMatches(candidate: string, adminPassword: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(adminPassword).digest();
  return timingSafeEqual(a, b);
}

export function issueSession(reply: FastifyReply, config: Pick<AppConfig, "NODE_ENV" | "SESSION_TTL_DAYS">): void {
  reply.setCookie(SESSION_COOKIE_NAME, String(Date.now()), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.NODE_ENV === "production",
    signed: true,
    maxAge: config.SESSION_TTL_DAYS * 24 * 60 * 60
  });
}

export function destroySession(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

export function hasValidSession(
  request: FastifyRequest,
  config: Pick<AppConfig, "SESSION_TTL_DAYS">
): boolean {
  const raw = request.cookies[SESSION_COOKIE_NAME];

  if (!raw) {
    return false;
  }

  const unsigned = request.unsignCookie(raw);

  if (!unsigned.valid || !unsigned.value) {
    return false;
  }

  const loggedInAt = Number(unsigned.value);

  if (!Number.isFinite(loggedInAt)) {
    return false;
  }

  const ageMs = Date.now() - loggedInAt;
  return ageMs >= 0 && ageMs < config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}
