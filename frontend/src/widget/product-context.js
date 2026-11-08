function plainText(element) {
  if (!element) return "";
  const copy = element.cloneNode(true);
  copy.querySelectorAll("script,style,form,input,textarea,select,button,nav").forEach(node => node.remove());
  copy.querySelectorAll("p,li,h1,h2,h3,h4,br,tr").forEach(node => node.append("\n"));
  return (copy.textContent || "").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Read hidden panels too; innerText drops inactive tabs. Never click merchant controls.
export function captureProductContext(doc = globalThis.document, page = globalThis.location) {
  if (!doc?.querySelector || !page?.href) return null;
  const url = new URL(page.href);
  const match = url.pathname.match(/^\/products?\/([^/]+)\/?$/);
  const root = doc.querySelector("[data-mczen-product], .product-page, [itemtype$='/Product']");
  if (!match || !root) return null;
  const name = plainText(root.querySelector("[itemprop='name'], h1"));
  if (!name) return null;
  url.search = "";
  url.hash = "";
  const sections = [];
  const add = (title, node) => {
    const content = plainText(node);
    if (!content || sections.some(section => section.content === content)) return;
    if (content.length > 12000 || sections.length >= 24) {
      throw new Error("The product page exceeds the assistant's section limit.");
    }
    sections.push({ title: title.trim().slice(0, 200) || "Product information", content });
  };
  root.querySelectorAll("[role='tabpanel']").forEach(panel => {
    const label = doc.getElementById(panel.getAttribute("aria-labelledby"))?.textContent;
    add(label || "Product information", panel);
  });
  root.querySelectorAll("details").forEach(detail => add(detail.querySelector("summary")?.textContent || "Details", detail));
  root.querySelectorAll("[data-product-section], [itemprop='description'], .product-specs, .product-specifications, .specification-section, .product-reviews, .product-faqs")
    .forEach(node => add(node.getAttribute("data-product-section") || node.querySelector("h2,h3")?.textContent || "Product details", node));
  if (!sections.length) return null;
  const context = {
    externalProductId: decodeURIComponent(match[1]),
    productUrl: url.href,
    name,
    sections,
  };
  if (JSON.stringify(context).length > 48000) {
    throw new Error("The product page exceeds the assistant's context limit.");
  }
  return context;
}
