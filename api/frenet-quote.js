// api/frenet-quote.js
// Proxy server-side para a API de cotação da Frenet.
// Resolve o bloqueio de CORS de forma dinâmica e mantém o token seguro.

module.exports = async function handler(req, res) {
  // Pega dinamicamente a origem de onde veio a requisição (sua loja Shopify)
  const origin = req.headers.origin || '*';

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    // Requisição de "preflight" do navegador
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido' });
      return;
    }

    if (!process.env.FRENET_TOKEN) {
      res.status(500).json({ error: 'FRENET_TOKEN não configurado nas variáveis de ambiente da Vercel' });
      return;
    }

    const frenetResponse = await fetch('https://api.frenet.com.br/shipping/quote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        token: process.env.FRENET_TOKEN,
      },
      body: JSON.stringify(req.body),
    });

    const data = await frenetResponse.json();
    res.status(frenetResponse.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro no proxy', details: err.message });
  }
};