import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { chatWithOllama } from "./ollama.js";
dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8080);
const origins = (process.env.FRONTEND_ORIGIN || "http://localhost:5173").split(",").map(x => x.trim());

app.use(cors({ origin(origin, cb) {
  if (!origin || origins.includes(origin)) return cb(null, true);
  return cb(new Error("Origin not allowed by CORS"));
}}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "mczen-ai-agent" }));
app.get("/api/voices", (_req, res) => res.json({
  languages: [{code:"en",label:"English"},{code:"te",label:"Telugu"},{code:"hi",label:"Hindi"}],
  note: "Voice inventory comes from the browser/device in this starter."
}));

app.post("/api/chat", async (req, res) => {
  try {
    const { message, language = "en", history = [] } = req.body || {};
    if (typeof message !== "string" || !message.trim()) return res.status(400).json({error:"message is required"});
    if (message.length > 6000) return res.status(413).json({error:"message is too long"});
    const safeHistory = Array.isArray(history) ? history.slice(-8).filter(m =>
      m && ["user","assistant"].includes(m.role) && typeof m.content === "string"
    ) : [];
    const answer = await chatWithOllama({message:message.trim(), language, history:safeHistory});
    res.json({answer, language, actions:[]});
  } catch (e) {
    console.error("AI error:", e.message);
    res.status(502).json({error:"AI service unavailable. Check Ollama and the selected model."});
  }
});

// Placeholder only. Replace with verified McZEN product catalogue integration.
app.post("/api/products/search", (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query) return res.status(400).json({error:"query is required"});
  res.json({products:[], demo:true, message:"Connect this endpoint to the actual McZEN product API/database."});
});

app.listen(port, "0.0.0.0", () => console.log(`McZEN AI backend listening on ${port}`));
