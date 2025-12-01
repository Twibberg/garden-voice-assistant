const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const Airtable = require('airtable');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Root route so Vercel won't show "Cannot GET /"
app.get('/', (req, res) => {
  res.send('🌱 Garden Voice Assistant API is running.');
});


const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// Transcribe audio
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const audioBuffer = req.file.buffer;
    
    const response = await axios.post(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true',
      audioBuffer,
      {
        headers: {
          'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/webm',
        },
      }
    );

    const transcript = response.data.results.channels[0].alternatives[0].transcript;
    res.json({ transcript });
  } catch (error) {
    console.error('Transcription error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

// Search products
app.post('/api/search-products', async (req, res) => {
  try {
    const { query, category, tags } = req.body;
    
    let filterFormula = "AND({in_stock} = TRUE()";
    
    if (category) {
      filterFormula += `, {category} = '${category}'`;
    }
    
    if (tags && tags.length > 0) {
      const tagConditions = tags.map(tag => `FIND('${tag}', {tags})`).join(', ');
      filterFormula += `, OR(${tagConditions})`;
    }
    
    filterFormula += ")";

    const records = await base('Products')
      .select({
        filterByFormula: filterFormula,
        maxRecords: 10,
        sort: [{ field: 'title', direction: 'asc' }]
      })
      .all();

    const products = records.map(record => ({
      id: record.id,
      product_id: record.get('product_id'),
      title: record.get('title'),
      brand: record.get('brand'),
      category: record.get('category'),
      tags: record.get('tags'),
      short_description: record.get('short_description'),
      price: record.get('price'),
      bag_size_cf: record.get('bag-size-cf'),
      in_stock: record.get('in_stock'),
      image_url: record.get('image_url'),
      use_case: record.get('use-case'),
      voice_script_30S: record.get('voice_script_30S')
    }));

    res.json({ products });
  } catch (error) {
    console.error('Airtable error:', error);
    res.status(500).json({ error: 'Product search failed' });
  }
});

// Get AI response
app.post('/api/get-response', async (req, res) => {
  try {
    const { userMessage, conversationHistory, availableProducts } = req.body;

    const systemPrompt = `You are a helpful garden center employee specializing in soil products. 
Your job is to help customers find the right soil products for their needs.

Available products:
${JSON.stringify(availableProducts, null, 2)}

Guidelines:
- Be friendly, warm, and patient (many customers are 55-70 years old)
- Ask clarifying questions if needed (indoor/outdoor, vegetables/flowers, containers/beds)
- Recommend specific products from the available list
- Mention key benefits (drainage, nutrients, organic, etc.)
- Keep responses concise (2-4 sentences)
- If you don't know something, offer to get a staff member

Current customer question: ${userMessage}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: messages,
        temperature: 0.7,
        max_tokens: 300
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const aiResponse = response.data.choices[0].message.content;

    const recommendedProducts = availableProducts.filter(product => 
      aiResponse.toLowerCase().includes(product.title.toLowerCase())
    );

    res.json({ 
      text: aiResponse,
      recommendedProducts: recommendedProducts.slice(0, 3)
    });

  } catch (error) {
    console.error('OpenAI error:', error.response?.data || error.message);
    res.status(500).json({ error: 'AI response failed' });
  }
});

// Text-to-speech
app.post('/api/speak', async (req, res) => {
  try {
    const { text } = req.body;

    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`,
      {
        text: text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      },
      {
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );

    res.set('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(response.data));

  } catch (error) {
    console.error('TTS error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Text-to-speech failed' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});