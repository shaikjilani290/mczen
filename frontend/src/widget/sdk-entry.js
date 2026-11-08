import { mountWidget } from "./widget.js";
import { resolveApiBase } from "./client.js";

(function install() {
  const script = document.currentScript;
  if (!script) return;
  const apiBase = resolveApiBase(script.src, script.getAttribute("data-api-base"), location.origin);
  let instance = null;

  window.McZEN = Object.freeze({
    init(options = {}) {
      const integrationKey = options.integrationKey;
      const assistantId = options.assistantId;
      if (typeof integrationKey !== "string" || !/^mzp_[A-Za-z0-9_-]{43}$/.test(integrationKey)) {
        throw new TypeError("McZEN.init requires a valid integrationKey.");
      }
      if (typeof assistantId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(assistantId)) {
        throw new TypeError("McZEN.init requires a valid assistantId.");
      }
      if (instance) instance.destroy();
      if (options.cartAdapter && typeof options.cartAdapter.execute !== "function") {
        throw new TypeError("cartAdapter.execute must be a merchant-owned cart function.");
      }
      if (options.productContext !== undefined && typeof options.productContext !== "function") {
        throw new TypeError("productContext must be a merchant product-data loader.");
      }
      instance = mountWidget({
        publicKey: integrationKey, assistantId, apiBase, integration: true,
        cartAdapter: options.cartAdapter, productContext: options.productContext,
      });
      return instance ? Object.freeze({ trackPage: instance.trackPage, destroy: instance.destroy }) : null;
    },
  });
})();
