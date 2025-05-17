// api/chat.js
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const messages = req.body.messages;

  const chat = await openai.chat.completions.create({
    model: "gpt-4",
    messages,
  });

  res.status(200).json({ reply: chat.choices[0].message.content });
}
