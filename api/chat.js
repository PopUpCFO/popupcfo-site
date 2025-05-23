export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Only POST requests allowed" });
  }

  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ message: "Missing message in request body" });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4", // o "gpt-3.5-turbo" si no tienes acceso a gpt-4
        messages: [{ role: "user", content: message }],
      }),
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "Sin respuesta válida";

    return res.status(200).json({ reply });

  } catch (error) {
    console.error("API error:", error);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
}
