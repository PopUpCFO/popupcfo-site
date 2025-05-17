const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require('openai');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).send({ error: 'No message provided' });
  }

  try {
    const completion = await openai.createChatCompletion({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content:
            'Eres Popito CFO, un asesor financiero digital para pymes españolas. Ofrece análisis claros y recomendaciones útiles en tono profesional y accesible.',
        },
        { role: 'user', content: message },
      ],
    });

    const response = completion.data.choices[0].message.content;
    res.send({ response });
  } catch (error) {
    console.error('Error al llamar a OpenAI:', error.message);
    res.status(500).send({ error: 'Error con la API de OpenAI' });
  }
});

app.listen(port, () => {
  console.log(`Servidor en marcha en el puerto ${port}`);
});
