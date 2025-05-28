import formidable from "formidable";
import fs from "fs/promises";
import crypto from "crypto";

// Disable Next.js default body parsing so we can stream multipart data with formidable
export const config = {
  api: {
    bodyParser: false,
  },
};

// In‑memory session store (consider Redis for production)
const sessions = {};
const MAX_HISTORY = 20; // keep last 20 messages to avoid loops / token overflow

// Allowed front‑end origin (fallback to env var for easier staging)
const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  "https://7d1aa337-1e5b-45da-afab-b5bafdbb1e69.lovableproject.com";

function getSessionId(req) {
  // Hash IP + user‑agent (simple & stateless). Replace with a signed cookie for production.
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  const ua = req.headers["user-agent"] || "";
  return crypto.createHash("sha256").update(ip + ua).digest("hex");
}

function pruneHistory(history) {
  return history.length > MAX_HISTORY
    ? history.slice(history.length - MAX_HISTORY)
    : history;
}

export default async function handler(req, res) {
  // ─────────────── CORS PRE‑FLIGHT ───────────────
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  // ─────────────── PARSE MULTIPART ───────────────
  let fields, files;
  try {
    ({ fields, files } = await new Promise((resolve, reject) => {
      const form = formidable({ multiples: true, maxFileSize: 25 * 1024 * 1024 }); // 25 MB
      form.parse(req, (err, fld, fls) => (err ? reject(err) : resolve({ fields: fld, files: fls })));
    }));
  } catch (err) {
    console.error("Formidable error", err);
    return res.status(400).json({ error: "Invalid form data" });
  }

  const message = (fields.message || "").toString().trim();
  if (!message && !files)
    return res.status(400).json({ error: "No message or file provided" });

  // ─────────────── SESSION BOOTSTRAP ───────────────
  const sessionId = getSessionId(req);
  if (!sessions[sessionId]) {
    sessions[sessionId] = [
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

Luego pregunta las siguientes preguntas de una en una sin excepción, nunca preguntes mas de una de golpe y no vayas resumiendo las respuestas anteriores. (y guarda internamente cada respuesta):

1. ¿Cuál es el nombre de tu empresa? *(GUÁRDALO para la clave)*
2. ¿A qué se dedica? ¿Cuántos años lleva operando?
3. ¿Para qué necesitas financiación, cuanto importe buscas y cuanto es la inversión total (si es inversión)?
   - Si es para inmueble:
     - Precio de compra
     - Valor estimado
     - ¿Es hipotecable?
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

1. Genera un resumen ejecutivo breve, punto por punto, con valoración:

Ejemplo:
- **Sector y actividad:** Discoteca con 50 años. 🟢 Muy sólida trayectoria.
- **Facturación:** 15 M€ año anterior. 🟢 Alta capacidad de generación de ingresos.
- **Beneficios:** Estables. 🟢 Excelente base para justificar retorno.
- **Destino de financiación:** DJs internacionales. 🟡 Riesgo controlado si se demuestra retorno.
- **Deuda:** ICO asumibles, cuota 15.000€/mes. 🟢 Bien gestionado.
- **Tesorería:** Estacional. 🔴 Requiere cobertura específica.
- **Patrimonio:** 1,5 M€ en inmuebles. 🟢 Alto poder de aval.
- **Bancos:** Trabajan con 3. 🟢 Relación diversificada.
- **Historial financiación:** Positiva. 🟢 Buen precedente.

2. Lanza la solicitud de clave:

🔐 Para desbloquear tu informe completo, introduce tu contraseña personalizada:

\`unlock_cfo_total_{X}_{F}_{CNRRT}\`

Donde:
- X = Día del año – día del mes  
- F = Letra por franja horaria actual  
- CNRRT = Letras en posiciones impares del nombre de empresa (en mayúsculas, sin espacios)

Si la clave es incorrecta:
> 🔒 Por favor, introduce la contraseña correcta para acceder a tu informe personalizado.

---

🔵 FASE 3: INFORME DETALLADO (si la clave es válida)

Solicita documentos si hay.

Genera informe con estas secciones:

🔹 1. INTRODUCCIÓN  
- Qué es el informe, por qué se genera, cómo usarlo ante el banco.

🔹 2. RESUMEN FINANCIERO + VALORACIÓN  
- Usa 🟢🟡🔴 según el punto. Explica cada resultado y aporta pool bancario sencillo.

🔹 3. ANÁLISIS DE RATIOS  
- Explica cada ratio (ej: liquidez, ROE, endeudamiento, PMC/PMP)
- Muestra si es bueno o malo con texto claro y benchmarks

🔹 4. PROPUESTA FINANCIERA  
- Qué producto usar (préstamo, leasing…)
- Cómo estructurarlo (plazo, garantías, importe)
- Qué mejorar si no está preparado
- Busca la SGR de su comunidad autonoma y recomiendasela si crees que el perfil encaja.

🔹 5. ARGUMENTARIO PARA EL BANCO  
A. Fortalezas financieras  
B. Fortalezas operativas  
C. Cómo mitigar riesgos  
D. Cómo presentarse (narrativa para convencer)

🔹 6. PASO A PASO  
- Prepara PyG, adjunta informe, contacta bancos, justifica y negocia

🔹 7. DISCURSO PARA EL BANCO  
Texto como si el cliente hablara con el director de riesgos:

> “Buenas tardes. Mi empresa, [NOMBRE], lleva [X años] operando...”

🔹 8. CIERRE FINAL  
> ✅ Muchas gracias por usar Pop-Up CFO. Puedes descargar tu informe en www.popupcfo.com

Si el usuario escribe después:
> “Gracias, el informe ya ha sido generado. Para nuevas consultas, visita www.popupcfo.com.”`,
      },
    ];
  }

  // ─────────────── BUILD CONVERSATION ───────────────
  const history = sessions[sessionId];

  if (message) {
    history.push({ role: "user", content: message });
  }

  // Append artificial message describing attachments (the model cannot see binaries)
  const fileKeys = Object.keys(files || {});
  if (fileKeys.length) {
    const names = fileKeys.map((k) => files[k].originalFilename).join(", ");
    history.push({
      role: "user",
      content: `He adjuntado los siguientes archivos: ${names}`,
    });
  }

  sessions[sessionId] = pruneHistory(history);

  // ─────────────── OPENAI CALL ───────────────
  try {
    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: sessions[sessionId],
        temperature: 0.7,
      }),
    });

    const data = await completion.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) throw new Error("No valid response from OpenAI");

    sessions[sessionId].push({ role: "assistant", content: reply });
    return res.status(200).json({ reply });
  } catch (err) {
    console.error("OpenAI error", err);
    return res.status(500).json({ error: "Error al procesar la solicitud" });
  } finally {
    // Cleanup tmp uploads
    for (const key of Object.keys(files || {})) {
      try {
        await fs.unlink(files[key].filepath);
      } catch {}
    }
  }
}
