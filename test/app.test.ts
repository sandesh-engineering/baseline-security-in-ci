import { test } from "node:test";
import assert from "node:assert";
import request from "supertest";
import app from "../src/app";

test("GET /health returns ok", async () => {
  const res = await request(app).get("/health");
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { status: "ok" });
});

test("GET /api/users returns the in-memory users", async () => {
  const res = await request(app).get("/api/users");
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ]);
});

test("GET /unknown returns 404", async () => {
  const res = await request(app).get("/unknown");
  assert.strictEqual(res.status, 404);
  assert.deepStrictEqual(res.body, { error: "Not found" });
});

test("Helmet security headers are present", async () => {
  const res = await request(app).get("/health");
  assert.ok(res.headers["x-content-type-options"]);
  assert.ok(res.headers["x-frame-options"]);
});
