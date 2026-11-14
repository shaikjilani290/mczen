import test from "node:test";
import assert from "node:assert/strict";
import { createWidgetClient, resolveApiBase, WidgetError } from "./client.js";

test("cart polling stays off while idle, registers before text, and stops when the request ends", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const paths = [];
  let completeMessage;
  const client = createWidgetClient({
    apiBase: "https://platform.example", publicKey: "mzp_test", integration: true,
    cartAdapter: { execute: async () => { throw new Error("No action expected"); } },
    fetchImpl: async url => {
      paths.push(url.split("/").at(-1));
      if (url.endsWith("/connect")) return reply(200, { sessionToken: "session", config: {} });
      if (url.endsWith("/cart/poll")) return reply(200, { action: null });
      return new Promise(resolve => { completeMessage = () => resolve(reply(200, { sessionToken: "session", answer: "ok" })); });
    },
  });
  try {
    await client.start();
    t.mock.timers.tick(5000);
    await new Promise(setImmediate);
    assert.deepEqual(paths, ["connect"]);
    const sending = client.send("Show my cart.");
    await new Promise(setImmediate);
    assert.deepEqual(paths, ["connect", "poll", "message"]);
    t.mock.timers.tick(750);
    await new Promise(setImmediate);
    assert.equal(paths.filter(path => path === "poll").length, 2);
    completeMessage();
    await sending;
    t.mock.timers.tick(5000);
    await new Promise(setImmediate);
    assert.equal(paths.filter(path => path === "poll").length, 2);
  } finally { client.destroy(); t.mock.timers.reset(); }
});

test("voice and text share one in-flight cart poll, and voice stop aborts idle polling", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let polls = 0, releasePoll, pollSignal, finishMessage;
  const client = createWidgetClient({
    apiBase: "https://platform.example", publicKey: "mzp_test", integration: true,
    cartAdapter: { execute: async () => { throw new Error("No action expected"); } },
    fetchImpl: async (url, init) => {
      if (url.endsWith("/connect")) return reply(200, { sessionToken: "session", config: {} });
      if (url.endsWith("/cart/poll")) {
        polls++;
        pollSignal = init.signal;
        return new Promise((resolve, reject) => {
          releasePoll = () => resolve(reply(200, { action: null }));
          init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      return new Promise(resolve => { finishMessage = () => resolve(reply(200, { sessionToken: "session", answer: "ok" })); });
    },
  });
  try {
    await client.start();
    const voice = client.setVoiceActive(true);
    const repeated = client.setVoiceActive(true);
    const sending = client.send("Show my cart.");
    await new Promise(setImmediate);
    assert.equal(polls, 1);
    releasePoll();
    await Promise.all([voice, repeated]);
    await new Promise(setImmediate);
    finishMessage();
    await sending;
    t.mock.timers.tick(750);
    await new Promise(setImmediate);
    assert.equal(polls, 2, "voice remains active after the text turn finishes");
    await client.setVoiceActive(false);
    await new Promise(setImmediate);
    assert.equal(pollSignal.aborted, true);
    t.mock.timers.tick(5000);
    await new Promise(setImmediate);
    assert.equal(polls, 2);
  } finally { client.destroy(); t.mock.timers.reset(); }
});

test("reports the product-context failure as that request, not an assistant or GPU network failure", async () => {
  const paths = [];
  const client = createWidgetClient({
    apiBase: "https://platform.example", publicKey: "mzp_test", integration: true,
    productContext: () => ({ externalProductId: "tea", name: "tea", productUrl: "https://shop.example/product/tea",
      sections: [{ title: "Overview", content: "tea" }] }),
    fetchImpl: async url => {
      paths.push(url);
      if (url.endsWith("/connect")) return reply(200, { sessionToken: "session", config: {} });
      throw new TypeError("Failed to fetch");
    },
  });
  try {
    await assert.rejects(client.voiceTicket(), /Product page context could not be synchronized/);
    assert.equal(paths.some(path => path.endsWith("/voice-ticket")), false);
  } finally { client.destroy(); }
});

test("overlapping product refreshes cannot publish stale context after a newer page", async () => {
  let current = "tea", loading = false, release;
  const uploaded = [];
  const client = createWidgetClient({
    apiBase: "https://platform.example", publicKey: "mzp_test", integration: true,
    productContext: async () => {
      const id = current;
      if (loading) { loading = false; await new Promise(resolve => { release = resolve; }); }
      return { externalProductId: id, productUrl: `https://shop.example/product/${id}`, name: id,
        sections: [{ title: "Overview", content: id }] };
    },
    fetchImpl: async (url, init) => {
      if (url.endsWith("/connect")) return reply(200, { sessionToken: "session", config: {} });
      if (url.endsWith("/product-context")) uploaded.push(JSON.parse(init.body).externalProductId);
      if (url.endsWith("/message")) return reply(200, { sessionToken: "session", answer: "ok" });
      if (url.endsWith("/voice-ticket")) return reply(200, { ticket: "ticket" });
      return reply(200, {});
    },
  });
  try {
    await client.start();
    current = "coffee"; loading = true;
    const text = client.send("Explain coffee.");
    current = "juice";
    const voice = client.voiceTicket();
    release();
    await Promise.all([text, voice]);
    assert.deepEqual(uploaded, ["tea", "coffee", "juice"]);
  } finally { client.destroy(); }
});

test("destroying during a product API load prevents a late upload", async () => {
  let release;
  const calls = [];
  const client = createWidgetClient({
    apiBase: "https://platform.example", publicKey: "mzp_test", integration: true,
    productContext: () => new Promise(resolve => { release = resolve; }),
    fetchImpl: async url => { calls.push(url); return reply(200, { sessionToken: "session", config: {} }); },
  });
  const start = client.start();
  await new Promise(resolve => setImmediate(resolve));
  client.destroy();
  release({ externalProductId: "tea", productUrl: "https://shop.example/product/tea", name: "tea",
    sections: [{ title: "Overview", content: "tea" }] });
  await start;
  assert.equal(calls.length, 1);
});

test("product context is refreshed before text and voice and keeps dynamically supplied sections", async () => {
  const calls = [];
  let sections = [{ title: "Overview", content: "Recorded description." }];
  const client = createWidgetClient({
    apiBase: "https://platform.example", publicKey: "mzp_test", integration: true,
    productContext: async () => ({
      externalProductId: "tea", productUrl: "https://shop.example/product/tea", name: "Tea", sections,
    }),
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
      if (url.endsWith("/connect")) return reply(200, { sessionToken: "session", config: {} });
      if (url.endsWith("/message")) return reply(200, { sessionToken: "rotated", answer: "ok" });
      if (url.endsWith("/voice-ticket")) return reply(200, { ticket: "ticket" });
      return reply(200, { accepted: true });
    },
  });
  try {
    await client.start();
    sections = [...sections, { title: "Ingredients", content: "Lazy loaded tea ingredients." }];
    await client.send("What is inside?");
    await client.voiceTicket();
    const uploads = calls.filter(call => call.url.endsWith("/product-context"));
    assert.equal(uploads.length, 2);
    assert.equal(uploads[1].body.sections.length, 2);
    assert.equal(calls[2].url.endsWith("/product-context"), true);
    assert.equal(calls[3].url.endsWith("/message"), true);
    assert.ok(uploads.every(call => call.auth));
  } finally { client.destroy(); }
});

test("merchant cart waits for an actual adapter result and retries acknowledgement without repeating the write", async () => {
  const action = { id: "a".repeat(64), operation: "add_to_cart", productId: "tea", quantity: 2 };
  const cart = { items: [{ productId: "tea", quantity: 2 }], itemCount: 2, total: 24, currency: "INR", cartPath: "/cart" };
  let writes = 0, acknowledgements = 0, finished;
  const done = new Promise(resolve => { finished = resolve; });
  const errors = [];
  const client = createWidgetClient({
    apiBase: "https://platform.example", publicKey: "mzp_test", integration: true,
    onCartError: message => errors.push(message),
    cartAdapter: { execute: async received => {
      if (received.operation !== "get_cart") { assert.deepEqual(received, action); writes++; }
      else assert.notEqual(received.id, action.id);
      return cart;
    } },
    fetchImpl: async (url, init) => {
      if (url.endsWith("/connect")) return reply(200, { sessionToken: "guest-session", config: {} });
      assert.equal(init.credentials, "omit");
      if (url.endsWith("/cart/poll")) return reply(200, { action });
      const result = JSON.parse(init.body);
      assert.deepEqual(result, { id: action.id, success: true, cart });
      acknowledgements++;
      if (acknowledgements === 1) throw new TypeError("Lost result response");
      finished();
      return reply(200, { acknowledged: true });
    },
  });
  try {
    await client.start();
    await client.setVoiceActive(true);
    await done;
    assert.equal(writes, 1);
    assert.equal(acknowledgements, 2);
    assert.equal(errors.length, 1);
  } finally { client.destroy(); }
});

for (const scenario of ["opened", "navigation failure", "missing navigation"]) {
  test(`merchant open-cart acknowledgement follows ${scenario}`, async () => {
    const action = { id: "c".repeat(64), operation: "open_cart" };
    const cart = { items: [], itemCount: 0, total: 0, currency: "INR", cartPath: "/cart" };
    let opened = false;
    let acknowledgement, openedAtAcknowledgement;
    const client = createWidgetClient({
      apiBase: "https://platform.example", publicKey: "mzp_test", integration: true,
      cartAdapter: {
        execute: async () => cart,
        ...(scenario !== "missing navigation" ? { openCart: async () => {
          if (scenario === "navigation failure") throw new Error("Merchant navigation failed.");
          opened = true;
        } } : {}),
      },
      fetchImpl: async (url, init) => {
        if (url.endsWith("/connect")) return reply(200, { sessionToken: "guest-session", config: {} });
        if (url.endsWith("/cart/poll")) return reply(200, { action });
        acknowledgement = JSON.parse(init.body);
        openedAtAcknowledgement = opened;
        return reply(200, { acknowledged: true });
      },
    });
    try {
      await client.start();
      await client.setVoiceActive(true);
      assert.equal(acknowledgement.success, true);
      assert.equal(openedAtAcknowledgement, false, "navigation must wait for backend read-back verification");
    } finally { client.destroy(); }
  });
}

test("merchant write failure is acknowledged as failure, never cart success", async () => {
  const action = { id: "b".repeat(64), operation: "add_to_cart", productId: "missing", quantity: 1 };
  let finished;
  const done = new Promise(resolve => { finished = resolve; });
  const client = createWidgetClient({
    apiBase: "https://platform.example", publicKey: "mzp_test", integration: true,
    cartAdapter: { execute: async () => { throw new Error("Product is out of stock."); } },
    fetchImpl: async (url, init) => {
      if (url.endsWith("/connect")) return reply(200, { sessionToken: "guest-session", config: {} });
      if (url.endsWith("/cart/poll")) return reply(200, { action });
      assert.deepEqual(JSON.parse(init.body), { id: action.id, success: false, error: "Product is out of stock." });
      finished();
      return reply(200, { acknowledged: true });
    },
  });
  try { await client.start(); await client.setVoiceActive(true); await done; } finally { client.destroy(); }
});

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });

test("text preserves backend verified cart navigation without accepting a client destination", async () => {
  const navigationAction = { id: "a".repeat(64), type: "OPEN_CHECKOUT", url: "https://shop.example/checkout" };
  const cartOperation = { operation: "add_to_cart", cartVerified: true, checkoutUrl: navigationAction.url };
  const client = createWidgetClient({
    apiBase: "https://platform.example", publicKey: "mzp_test",
    fetchImpl: async url => reply(200, url.endsWith("/session")
      ? { sessionToken: "guest-session", config: {} }
      : { sessionToken: "rotated", success: true, answer: "Added.", cartOperation, navigationAction }),
  });
  try {
    await client.start();
    const response = await client.send("Add ZENAGE.");
    assert.deepEqual(response.cartOperation, cartOperation);
    assert.deepEqual(response.navigationAction, navigationAction);
  } finally { client.destroy(); }
});

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

test("website SDK uses the public integration key, scoped session, and page-view route", async () => {
  const calls = [];
  const responses = [
    reply(200, { sessionToken: "site-session", config: { languages: ["en"] } }),
    reply(200, { success: true, answer: "answer", sessionToken: "next-session" }),
    reply(200, {}),
  ];
  const previousLocation = globalThis.location;
  const previousDocument = globalThis.document;
  globalThis.location = { href: "https://shop.example/products/1?campaign=private" };
  globalThis.document = { title: "Product", referrer: "https://search.example/?query=private" };
  const client = createWidgetClient({
    apiBase: "https://mczen.example",
    publicKey: "mzp_" + "A".repeat(43),
    assistantId: "01974a11-3270-7da8-a3fc-c6a06fe90df0",
    integration: true,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return responses.shift(); },
  });

  try {
    await client.start("en");
    await client.send("hello", "en");
    await client.trackPageView();
    assert.equal(calls[0].url, "https://mczen.example/api/website-integrations/connect");
    assert.equal(JSON.parse(calls[0].init.body).publicKey, "mzp_" + "A".repeat(43));
    assert.equal(calls[1].url, "https://mczen.example/api/website-integrations/message");
    assert.equal(calls[1].init.headers.Authorization, "Bearer site-session");
    assert.equal(calls[2].url, "https://mczen.example/api/website-ingestion/page-view");
    assert.equal(calls[2].init.headers.Authorization, "Bearer next-session");
    assert.equal(JSON.parse(calls[2].init.body).pageUrl, "https://shop.example/products/1?campaign=private");
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("message responses expose structured product cards supplied by the agent", async () => {
  const { client } = harness([
    reply(200, { sessionToken: "t1", config: {} }),
    reply(200, {
      success: true,
      answer: "Tea is available.",
      products: [{ name: "Tea", productUrl: "https://shop.example/tea", images: ["https://shop.example/tea.jpg"] }],
      sessionToken: "t2",
    }),
  ]);
  await client.start();
  const result = await client.send("Find tea");
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].name, "Tea");
});
