import formidable from "formidable";
import fs from "fs/promises";
import crypto from "crypto";

// ──────────────────────────────────────────────────────────────
//  Next-JS API route: pages/api/chat.js
//  • Acepta JSON y multipart/form-data (adjuntos)
//  • Mantiene intacto el PROMPT original
//  • Limita historial a 20 mensajes para evitar bucles
// ──────────────────────────────────────────────────────────────

export const config = {
  api: { bodyParser: false }, // necesitamos el stream bruto para formidable
};

// Sesiones en memoria (usa Redis/KV en producción)
const sessions = {};
const MAX_HISTORY = 20;

// Dominio permitido (CORS)
const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  "https://7d1aa337-1e5b-45da-afab-b5bafdbb1e69.lovableproject.com";

// ——— utilidades ————————————————————————————————————————
function getSessionId(req) {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  const ua = req.headers["user-agent"] || "";
  return crypto.createHash("sha256").update(ip + ua).digest("hex");
}

function prune(history) {
  return history.length > MAX_HISTORY ? history.slice(-MAX_HISTORY) : history;
}

async function parseJSONBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

// ——— handler principal ———————————————————————————————
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // BODY PARSING
  const contentType = req.headers["content-type"] || "";
  let fields = {},
    files = {};

  try {
    if (contentType.startsWith("multipart/form-data")) {
      // FormData con adjuntos
      ({ fields, files } = await new Promise((resolve, reject) => {
        formidable({ multiples: true, maxFileSize: 25 * 1024 * 1024 }).parse(
          req,
          (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls }))
        );
      }));
    } else if (contentType.includes("application/json")) {
      // JSON plano
      fields = await parseJSONBody(req);
    } else {
      return res.status(400).json({ error: "Unsupported content-type" });
    }
  } catch (err) {
    console.error("Body parse error", err);
    return res.status(400).json({ error: "Malformed request body" });
  }

  const message = (fields.message || "").toString().trim();
  const hasFiles = Object.keys(files).length > 0;
  if (!message && !hasFiles)
    return res.status(400).json({ error: "No message or file provided" });

  // SESIÓN
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

---

🟢 FASE 1: CUESTIONARIO GUIADO  
Saludo inicial:
> Hola. Soy el CFO digital de Pop-Up CFO. Supongo que estás buscando financiación o quieres optimizar tu situación financiera. No te preocupes, no haremos preguntas inútiles. Solo lo justo para ayudarte de verdad. ¿Te parece bien?

Luego pregunta las siguientes preguntas de una en una sin excepción, nunca preguntes más de una de golpe y no vayas resumiendo las respuestas anteriores (guarda internamente cada respuesta):

1. ¿Cuál es el nombre de tu empresa? *(GUÁRDALO para la clave)*
2. ¿A qué se dedica? ¿Cuántos años lleva operando?
3. ¿Para qué necesitas financiación, cuánto importe buscas y cuánto es la inversión total (si es inversión)?
   - Si es para inmueble:  
     · Precio de compra  
     · Valor estimado  
     · ¿Es hipotecable?
4. Facturación año anterior y estimación actual
5. ¿Generáis beneficios, cubrís gastos o reinvertís?
6. ¿Con cuántos bancos trabajáis y para qué los usáis?
7. ¿Tienes préstamos? ¿Importes, cuotas, vencimientos?
8. ¿Financiación a corto plazo (pólizas, líneas…)? ¿Importes, vencimientos?
9. ¿Inmuebles libres de cargas? ¿Tipo y valor estimado?
10. ¿Cobros/pagos? ¿Contado o a plazo?
11. ¿Actividad estacional? ¿Cómo afecta a la tesorería?
12. ¿Socios? ¿Grupo de empresas?
13. ¿Experiencia previa en financiación? ¿Cómo fue?
14. ¿Algo más relevante que deba saber?

---

🟠 FASE 2: RESUMEN + VALIDACIÓN DE CONTRASEÑA  
Tras completar el cuestionario:

1. Genera un resumen ejecutivo breve, punto por punto, con valoración.

2. Solicita la clave personalizada:
🔐 \`unlock_cfo_total_{X}_{F}_{CNRRT}\`

---

🔵 FASE 3: INFORME DETALLADO (si la clave es válida)
• Introducción  
• Resumen financiero + valoración  
• Análisis de ratios  
• Propuesta financiera  
• Argumentario para el banco  
• Paso a paso  
• Discurso para el banco  
• Cierre final`,
      },
    ];
  }

  // Construir historial
  const history = sessions[sid];
  if (message) history.push({ role: "user", content: message });

  if (hasFiles) {
    const names = Object.keys(files)
      .map((k) => files[k].originalFilename)
      .join(", ");
    history.push({
      role: "user",
      content: `He adjuntado los siguientes archivos: ${names}`,
    });
  }

  sessions[sid] = prune(history);

  // Llamada a OpenAI
  try {
    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
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
    });

    const data = await completion.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) throw new Error("No valid response from OpenAI");

    sessions[sid].push({ role: "assistant", content: reply });
    res.status(200).json({ reply });
  } catch (err) {
    console.error("OpenAI error", err);
    res.status(500).json({ error: "Error al procesar la solicitud" });
  } finally {
    // Limpia temporales
    for (const key of Object.keys(files)) {
      try {
        await fs.unlink(files[key].filepath);
      } catch (e) {
        /* ignore */
      }
    }
  }
}
