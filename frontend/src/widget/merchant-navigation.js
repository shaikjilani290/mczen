export function createMerchantNavigation({
  merchantOrigin,
  openWindow = (...args) => window.open(...args),
  onFallback = () => {},
  onError = message => console.error("[McZEN:navigation]", message),
}) {
  const completed = new Set();
  return {
    handle(response) {
      const action = response?.navigationAction;
      if (!action) return false;
      const operation = response.cartOperation;
      let url;
      try { url = new URL(action.url); } catch {
        onError("The merchant navigation URL is invalid.");
        return false;
      }
      if (!merchantOrigin || response.success !== true || operation?.cartVerified !== true ||
          !["add_to_cart", "get_cart", "open_cart"].includes(operation.operation) ||
          !/^[a-f0-9]{64}$/.test(action.id || "") ||
          !["OPEN_CHECKOUT", "OPEN_CART"].includes(action.type) ||
          (action.type === "OPEN_CHECKOUT" && operation.operation !== "add_to_cart") ||
          url.origin !== merchantOrigin || action.merchantOrigin !== merchantOrigin ||
          url.username || url.password || !["https:", "http:"].includes(url.protocol) ||
          action.url !== (action.type === "OPEN_CHECKOUT" ? operation.checkoutUrl : operation.cartUrl)) {
        onError("The merchant navigation instruction could not be verified.");
        return false;
      }
      if (completed.has(action.id)) return false;
      completed.add(action.id);
      const label = action.type === "OPEN_CHECKOUT" ? "Open Checkout" : "Open Cart";
      // Keep a usable link even when a browser returns null for a noopener window.
      onFallback({ url: url.href, label, id: action.id });
      try {
        openWindow(url.href, "_blank", "noopener,noreferrer");
      } catch {
        onError("Automatic navigation was blocked. Use the merchant navigation link.");
      }
      return true;
    },
  };
}
