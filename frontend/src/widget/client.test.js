import test from "node:test";
import assert from "node:assert/strict";
import { createWidgetClient, resolveApiBase, WidgetError } from "./client.js";

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });

function harness(handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const h = handlers.shift();
    if (h instanceof Error) throw h;
    return h;
  };
  return { calls, client: createWidgetClient({ apiBase: "https://m.test", publicKey: "wk_x", fetchImpl }) };
}

test("session then message: token in header only, rotated each turn", async () => {
  const { client, calls } = harness([
    reply(200, { sessionToken: "t1", config: { languages: ["en"] } }),
    reply(200, { success: true, answer: "hi", sources: [{ title: "a" }], sessionToken: "t2" }),
    reply(200, { success: true, answer: "again", sessionToken: "t3" }),
  ]);
  await client.start("en");
  const r = await client.send("hello", "en");
  assert.equal(r.answer, "hi");
  await client.send("more");
  assert.equal(calls[1].init.headers.Authorization, "Bearer t1");
  assert.equal(calls[2].init.headers.Authorization, "Bearer t2");
  assert.ok(calls.every((c) => !c.url.includes("t1")));
  assert.equal(calls[1].init.credentials, "omit");
  assert.equal(calls[0].url, "https://m.test/api/widget/public/session");
});

test("maps 403, 429 and network failures to safe errors", async () => {
  for (const [res, code] of [[reply(403, {}), "unavailable"], [reply(429, {}), "rate"], [new TypeError("x"), "network"], [reply(500, {}), "failed"]]) {
    const { client } = harness([res]);
    await assert.rejects(client.start(), (e) => e instanceof WidgetError && e.code === code);
  }
});

test("expired session before first turn is replaced; after first turn it surfaces", async () => {
  const a = harness([
    reply(200, { sessionToken: "t1" }), reply(401, {}), reply(200, { sessionToken: "t2" }),
    reply(200, { answer: "ok", sessionToken: "t3" }),
  ]);
  await a.client.start();
  assert.equal((await a.client.send("x")).answer, "ok");

  const b = harness([
    reply(200, { sessionToken: "t1" }), reply(200, { answer: "1", sessionToken: "t2" }), reply(401, {}),
  ]);
  await b.client.start();
  await b.client.send("x");
  await assert.rejects(b.client.send("y"), (e) => e.code === "expired");
});

test("resolveApiBase uses override or script origin", () => {
  assert.equal(resolveApiBase("https://cdn.test/widget.js", null, "https://site.test"), "https://cdn.test");
  assert.equal(resolveApiBase("https://cdn.test/widget.js", "https://api.test/", "https://site.test"), "https://api.test");
});
