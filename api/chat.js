import { IncomingForm } from "formidable";
import fs from "fs/promises";
import crypto from "crypto";

// ──────────────────────────────────────────────────────────────
//  pages/api/chat.js (Next.js)
//  • Acepta JSON y multipart/form-data (adjuntos)
//  • Mantiene intacto tu prompt original
//  • Limita historial a 20 mensajes para evitar bucles
// ──────────────────────────────────────────────────────────────

export const config = {
  api: { bodyParser: false }, // deshabilita el bodyParser nativo
};

const sessions = {};
const MAX_HISTORY = 20;
const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  "https://7d1aa337-1e5b-45da-afab-b5bafdbb1e69.lovableproject.com";

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Helpers
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

function getSessionId(req) {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  const ua = req.headers["user-agent"] || "";
  return crypto.createHash("sha256").update(ip + ua).digest("hex");
}

function prune(history) {
  return history.length > MAX_HISTORY
    ? history.slice(-MAX_HISTORY)
    : history;
}

async function parseJSONBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Handler
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Requested-With"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  // Parse body & archivos
  const contentType = req.headers["content-type"] || "";
  let fields = {}, files = {};

  try {
    if (contentType.startsWith("multipart/form-data")) {
      const form = new IncomingForm({
        multiples: true,
        maxFileSize: 25 * 1024 * 1024, // 25MB
      });
      await new Promise((resolve, reject) => {
        form.parse(req, (err, flds, fls) => {
          if (err) reject(err);
          else {
            fields = flds;
            files = fls;
            resolve();
          }
        });
      });
    } else if (contentType.includes("application/json")) {
      fields = await parseJSONBody(req);
    } else {
      return res
        .status(400)
        .json({ error: "Unsupported content-type" });
    }
  } catch (err) {
    console.error("Body parse error", err);
    return res
      .status(400)
      .json({ error: "Malformed request body" });
  }

  const message = (fields.message || "").toString().trim();
  const hasFiles = Object.keys(files).length > 0;
  if (!message && !hasFiles)
    return res
      .status(400)
      .json({ error: "No message or file provided" });

  // Sesión
  const sid = getSessionId(req);
  if (!sessions[sid]) {
    sessions[sid] = [
      {
        role: "system",
        content: `Actúas como el CFO digital de Pop-Up CFO. Tu función es ayudar a empresas (PYMEs, autónomos, startups) a preparar un informe financiero para acceder a financiación bancaria.

Tu tono es profesional, claro, cercano y estratégico.

Estructura la conversación por fases. No repitas preguntas ya respondidas. Si ya se te ha dado una respuesta, no la vuelvas a pedir.

Cuando el usuario responde, guarda mentalmente esa información para no volver a preguntarla.

No inicies desde cero si ya has empezado a preguntar. Retoma desde donde lo dejaste.

⚠️ La conversación tiene tres fases:  
1. Cuestionario guiado  
2. Validación con contraseña generada  
3. Informe completo detallado

**El nombre de la empresa introducido en la PRIMERA RESPUESTA será la base para generar y validar la contraseña. Si el usuario no la introduce correctamente, no debes continuar.**

--- (continúa con TODO tu prompt original aquí sin modificar)`
      },
    ];
  }

  // Construye el historial y añade el nuevo mensaje
  const history = sessions[sid];
  if (message) history.push({ role: "user", content: message });

  if (hasFiles) {
    // reporta al bot los nombres de los archivos adjuntos
    const names = Object.values(files)
      .map((f) => f.originalFilename || f.newFilename)
      .join(", ");
    history.push({
      role: "user",
      content: `He adjuntado estos archivos: ${names}`,
    });
  }

  // recorta para evitar bucles
  sessions[sid] = prune(history);

  // Llamada a OpenAI
  try {
    const completion = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: sessions[sid],
          temperature: 0.7,
        }),
      }
    );

    const data = await completion.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) throw new Error("No valid response from OpenAI");

    // guarda la respuesta en sesión
    sessions[sid].push({ role: "assistant", content: reply });

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("OpenAI error", err);
    return res
      .status(500)
      .json({ error: "Error al procesar la solicitud" });
  } finally {
    // limpia ficheros temporales
    for (const f of Object.values(files)) {
      try {
        await fs.unlink(f.filepath || f.file);
      } catch (e) {
        // no hacemos nada
      }
    }
  }
}
