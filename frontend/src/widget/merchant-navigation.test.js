import test from "node:test";
import assert from "node:assert/strict";
import { createMerchantNavigation } from "./merchant-navigation.js";

const origin = "https://merchant.example";
const response = (type = "OPEN_CHECKOUT", operation = "add_to_cart") => ({
  success: true,
  cartOperation: { operation, cartVerified: true, cartUrl: `${origin}/cart`, checkoutUrl: `${origin}/checkout` },
  navigationAction: { id: "a".repeat(64), type, url: type === "OPEN_CHECKOUT" ? `${origin}/checkout` : `${origin}/cart`, merchantOrigin: origin },
});

test("verified addition opens checkout once across repeated text and voice responses", () => {
  const opened = [], links = [], errors = [];
  const handler = createMerchantNavigation({
    merchantOrigin: origin, openWindow: (...args) => opened.push(args),
    onFallback: link => links.push(link), onError: error => errors.push(error),
  });
  assert.equal(handler.handle(response()), true);
  assert.equal(handler.handle(response()), false);
  assert.deepEqual(opened, [[`${origin}/checkout`, "_blank", "noopener,noreferrer"]]);
  assert.equal(links[0].label, "Open Checkout");
  assert.deepEqual(errors, []);
});

test("verified view cart opens cart, and cart-only add uses cart", () => {
  for (const operation of ["get_cart", "open_cart", "add_to_cart"]) {
    const opened = [];
    const handler = createMerchantNavigation({ merchantOrigin: origin, openWindow: url => opened.push(url) });
    assert.equal(handler.handle(response("OPEN_CART", operation)), true);
    assert.deepEqual(opened, [`${origin}/cart`]);
  }
});

test("older repeated navigation events remain deduplicated for the widget lifetime", () => {
  let opened = 0;
  const handler = createMerchantNavigation({ merchantOrigin: origin, openWindow: () => opened++ });
  for (let index = 0; index < 110; index++) {
    const item = response();
    item.navigationAction.id = index.toString(16).padStart(64, "0");
    assert.equal(handler.handle(item), true);
  }
  const replay = response();
  replay.navigationAction.id = "0".repeat(64);
  assert.equal(handler.handle(replay), false);
  assert.equal(opened, 110);
});

test("popup blocking leaves a usable fallback checkout link", () => {
  for (const openWindow of [() => null, () => { throw new Error("Blocked"); }]) {
    const links = [], errors = [];
    const handler = createMerchantNavigation({
      merchantOrigin: origin, openWindow, onFallback: link => links.push(link), onError: error => errors.push(error),
    });
    assert.equal(handler.handle(response()), true);
    assert.equal(links[0].url, `${origin}/checkout`);
    assert.equal(links[0].label, "Open Checkout");
  }
});

test("failed, unverified, cross-origin, unsafe and non-navigation operations never open", () => {
  const invalid = [
    { ...response(), success: false },
    { ...response(), cartOperation: { ...response().cartOperation, cartVerified: false } },
    response("OPEN_CHECKOUT", "remove_cart_item"),
    response("OPEN_CART", "update_cart_item"),
    response("OPEN_CHECKOUT", "get_cart"),
    { ...response(), navigationAction: { ...response().navigationAction, url: "https://evil.example/checkout" } },
    { ...response(), navigationAction: { ...response().navigationAction, url: "javascript:alert(1)" } },
    { ...response(), navigationAction: { ...response().navigationAction, url: "https://user:password@merchant.example/checkout" } },
    { ...response(), navigationAction: { ...response().navigationAction, url: `${origin}/unapproved` } },
    { success: true, answer: "Opening checkout" },
  ];
  for (const item of invalid) {
    const opened = [];
    const handler = createMerchantNavigation({ merchantOrigin: origin, openWindow: url => opened.push(url), onError: () => {} });
    assert.equal(handler.handle(item), false);
    assert.deepEqual(opened, []);
  }
});

test("dashboard without a connected permitted merchant origin fails closed", () => {
  const opened = [];
  const handler = createMerchantNavigation({ openWindow: url => opened.push(url), onError: () => {} });
  assert.equal(handler.handle(response()), false);
  assert.deepEqual(opened, []);
});
