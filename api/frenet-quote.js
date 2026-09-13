// api/frenet-quote.js
// Proxy server-side para a API de cotação da Frenet.
// Resolve o bloqueio de CORS e mantém o token da Frenet fora do navegador.

module.exports = async function handler(req, res) {
  // Libera o CORS apenas para o domínio da sua loja
  const ALLOWED_ORIGIN = 'https://esterocasa.com.br/';

  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    // Requisição de "preflight" do navegador — só confirma que o CORS está liberado
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
    // Mesmo em erro, os headers de CORS já foram definidos acima,
    // então o navegador consegue ler esta resposta de erro.
    res.status(500).json({ error: 'Erro no proxy', details: err.message });
  }
};
