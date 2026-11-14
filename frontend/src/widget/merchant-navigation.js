export function createMerchantNavigation({
  merchantOrigin,
  navigate = url => window.location.assign(url),
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
      onFallback({ url: url.href, label, id: action.id });
      try {
        navigate(url.href);
      } catch {
        onError("Automatic navigation failed. Use the merchant navigation link.");
      }
      return true;
    },
  };
}
