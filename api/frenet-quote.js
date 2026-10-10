// api/frenet-quote.js
//
// Proxy entre a loja Shopify e a API de cotação da Frenet.
// - Recebe GET: o navegador não precisa fazer a requisição extra de CORS (preflight)
// - Guarda cada cotação no CDN da Vercel por algumas horas: a mesma cotação
//   (mesmo produto, quantidade e CEP) volta na hora para qualquer visitante
// - Limita a espera pela Frenet, para não estourar o tempo da função
//
// Variáveis de ambiente (Vercel > Settings > Environment Variables):
//   FRENET_TOKEN       obrigatória
//   FRENET_CEP_ORIGEM  opcional (usada se a loja não mandar o CEP de origem)
//
// Se o seu arquivo atual usa "module.exports = ...", troque a linha
// "export default async function handler" por
// "module.exports = async function handler" e mantenha o resto.

const FRENET_URL = 'https://api.frenet.com.br/shipping/quote';
const FRENET_TIMEOUT_MS = 12000;
const CDN_CACHE_SECONDS = 6 * 60 * 60;  // 6 horas (um novo deploy limpa o cache)
const CDN_STALE_SECONDS = 24 * 60 * 60; // entrega a versão guardada enquanto atualiza

function onlyDigits(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}

function toNumber(value) {
  const n = parseFloat(String(value == null ? '' : value).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function send(res, status, body, cacheControl) {
  res.setHeader('Cache-Control', cacheControl || 'no-store');
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });

  const q = req.query || {};

  // Aquecimento: só acorda a função, não consulta a Frenet.
  if (q.warmup) return send(res, 200, { ok: true });

  const token = process.env.FRENET_TOKEN;
  if (!token) return send(res, 500, { error: 'missing_token' });

  const origem = onlyDigits(q.origem || process.env.FRENET_CEP_ORIGEM);
  const destino = onlyDigits(q.destino);
  const peso = toNumber(q.peso);               // kg, por unidade
  const altura = toNumber(q.altura);           // cm, por unidade
  const largura = toNumber(q.largura);
  const comprimento = toNumber(q.comprimento);
  const qtd = Math.max(1, parseInt(q.qtd, 10) || 1);
  const valor = toNumber(q.valor);             // R$, total

  if (origem.length !== 8 || destino.length !== 8) {
    return send(res, 400, { error: 'invalid_cep' });
  }
  if (![peso, altura, largura, comprimento].every((n) => n > 0)) {
    return send(res, 400, { error: 'invalid_item' });
  }

  const item = {
    Height: altura,
    Length: comprimento,
    Width: largura,
    Weight: peso,
    Quantity: qtd,
  };
  if (q.sku) item.SKU = String(q.sku);

  const payload = {
    SellerCEP: origem,
    RecipientCEP: destino,
    ShipmentInvoiceValue: valor > 0 ? valor : 1,
    ShippingServiceCode: null,
    ShippingItemArray: [item],
    RecipientCountry: 'BR',
  };

  let data;
  try {
    const response = await fetch(FRENET_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        token,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FRENET_TIMEOUT_MS),
    });
    if (!response.ok) return send(res, 502, { error: 'frenet_http_' + response.status });
    data = await response.json();
  } catch (err) {
    const isTimeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return send(res, isTimeout ? 504 : 502, {
      error: isTimeout ? 'frenet_timeout' : 'frenet_unreachable',
    });
  }

  // A Frenet escreve "ShippingSevicesArray" (sem o "r") mesmo.
  const raw = (data && data.ShippingSevicesArray) || [];

  const services = raw
    .filter((s) => s && !s.Error)
    .map((s) => ({
      carrier: s.Carrier || '',
      service: s.ServiceDescription || '',
      code: s.ServiceCode || '',
      days: parseInt(s.DeliveryTime, 10) || null,
      price: toNumber(s.ShippingPrice),
    }))
    .filter((s) => Number.isFinite(s.price))
    .sort((a, b) => a.price - b.price);

  if (!services.length) {
    // Não guarda no cache: pode ter sido uma falha passageira das transportadoras.
    const errors = raw
      .filter((s) => s && s.Error && s.Msg)
      .map((s) => `${s.Carrier || ''} ${s.ServiceDescription || ''}: ${s.Msg}`.trim());
    return send(res, 200, { services: [], errors });
  }

  return send(
    res,
    200,
    { services },
    `public, s-maxage=${CDN_CACHE_SECONDS}, stale-while-revalidate=${CDN_STALE_SECONDS}`
  );
}
