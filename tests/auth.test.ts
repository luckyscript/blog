import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/lib/server/auth";

test("密码使用带随机盐的 scrypt，错误密码与异常哈希不能通过", async () => {
  const first = await hashPassword("a-long-test-password-2026");
  const second = await hashPassword("a-long-test-password-2026");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("a-long-test-password-2026", first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  assert.equal(await verifyPassword("whatever", "invalid"), false);
  assert.equal(await verifyPassword("x".repeat(500), first), false);
});
