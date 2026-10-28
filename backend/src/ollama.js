const base = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const model = process.env.OLLAMA_MODEL || "qwen2.5:3b";
const langs = {en:"English",te:"Telugu",hi:"Hindi"};

export async function chatWithOllama({message, language="en", history=[]}) {
  const system = [
    "You are McZEN AI, a helpful shopping and product-information voice assistant.",
    `Respond in ${langs[language] || "the user's language"}. Keep answers natural and concise for speech.`,
    "Never invent McZEN product names, prices, stock, ingredients, discounts or medical claims.",
    "If verified product data is not provided, say that you need to check the product catalogue.",
    "Never claim to have changed a cart, placed an order or made a payment unless a verified backend tool did it.",
    "Do not diagnose medical conditions or promise treatment outcomes."
  ].join(" ");
  const messages = [{role:"system",content:system}, ...history, {role:"user",content:message}];
  const r = await fetch(`${base}/api/chat`, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model,messages,stream:false})
  });
  if (!r.ok) throw new Error(`Ollama returned ${r.status}`);
  const data = await r.json();
  if (!data?.message?.content?.trim()) throw new Error("Empty Ollama response");
  return data.message.content.trim();
}
