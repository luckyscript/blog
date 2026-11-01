import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { APIContext } from "astro";
import { db } from "../../db";
import { users, sessions, loginAttempts } from "../../db/schema";
import { AppError } from "./errors";
import { verifyTurnstile } from "./turnstile";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "inkrain_admin";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, key] = stored.split(":");
  if (algorithm !== "scrypt" || !salt || !key || password.length > 256)
    return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export async function sessionUser(context: APIContext) {
  const token = context.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [session] = await db()
    .select({ id: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hash(token)),
        gt(sessions.expiresAt, new Date())
      )
    );
  return session ?? null;
}
export async function login(
  context: APIContext,
  email: string,
  password: string,
  turnstileToken: unknown = ""
) {
  await verifyTurnstile(turnstileToken, context.url.hostname);
  let address = "unknown";
  try {
    address = context.clientAddress;
  } catch {
    /* Some adapters do not expose a client address. */
  }
  const key = hash(`login:${address}`);
  const now = new Date();
  const resetsAt = new Date(now.getTime() + 15 * 60_000);
  await db()
    .insert(loginAttempts)
    .values({ key, count: 1, resetsAt })
    .onDuplicateKeyUpdate({
      set: {
        count: sql`IF(${loginAttempts.resetsAt} < ${now}, 1, ${loginAttempts.count} + 1)`,
        resetsAt: sql`IF(${loginAttempts.resetsAt} < ${now}, ${resetsAt}, ${loginAttempts.resetsAt})`,
      },
    });
  const [attempt] = await db()
    .select()
    .from(loginAttempts)
    .where(eq(loginAttempts.key, key));
  if (attempt.count > 8)
    throw new AppError(429, "登录尝试过多，请在 15 分钟后重试");
  const [user] = await db()
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()));
  // Use a real scrypt operation even for unknown accounts.
  const dummy = "scrypt:00000000000000000000000000000000:" + "00".repeat(64);
  const valid = await verifyPassword(password, user?.passwordHash ?? dummy);
  if (!user || !valid) throw new AppError(401, "邮箱或密码不正确");
  await db().delete(loginAttempts).where(eq(loginAttempts.key, key));
  await db().delete(sessions).where(lt(sessions.expiresAt, now));
  const token = randomBytes(32).toString("hex");
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  await db()
    .insert(sessions)
    .values({ tokenHash: hash(token), userId: user.id, expiresAt: expires });
  context.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: context.url.protocol === "https:",
    path: "/",
    expires,
  });
  return { id: user.id, email: user.email };
}
export async function logout(context: APIContext) {
  const token = context.cookies.get(SESSION_COOKIE)?.value;
  if (token)
    await db()
      .delete(sessions)
      .where(eq(sessions.tokenHash, hash(token)));
  context.cookies.delete(SESSION_COOKIE, { path: "/" });
}
export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string
) {
  if (newPassword.length < 12 || newPassword.length > 128)
    throw new AppError(400, "新密码需要 12 至 128 个字符");
  const [user] = await db().select().from(users).where(eq(users.id, userId));
  if (!user || !(await verifyPassword(oldPassword, user.passwordHash)))
    throw new AppError(400, "当前密码不正确");
  await db().transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword) })
      .where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
}
export async function createAdmin(email: string, password: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("ADMIN_EMAIL 格式不正确");
  if (password.length < 12 || password.length > 128)
    throw new Error("ADMIN_PASSWORD 需要 12 至 128 个字符");
  const [existing] = await db()
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()));
  if (existing) return existing.id;
  const id = randomUUID();
  await db()
    .insert(users)
    .values({
      id,
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      createdAt: new Date(),
    });
  return id;
}
