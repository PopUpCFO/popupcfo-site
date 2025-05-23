export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Only POST requests allowed" });
  }

  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ message: "Missing message in request body" });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "assistants=v1", // ← importante
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: message,
          },
        ],
      }),
    });

    const thread = await response.json();

    const runRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "assistants=v1",
      },
      body: JSON.stringify({
        assistant_id: "g-6814664af0d08191a13f0656565fef61", // 👈 Tu GPT ID aquí
      }),
    });

    const run = await runRes.json();

    // Esperar respuesta (muy simplificado, lo ideal es polling)
    await new Promise((resolve) => setTimeout(resolve, 3000)); // ⚠️ opcional mejorar con polling

    const messagesRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "assistants=v1",
      },
    });

    const messagesData = await messagesRes.json();

    const reply = messagesData.data
      ?.reverse()
      .find((msg) => msg.role === "assistant")?.content[0]?.text?.value;

    if (!reply) {
      throw new Error("No reply from assistant.");
    }

    res.status(200).json({ reply });
  } catch (error) {
    console.error("Assistant API error:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
}
