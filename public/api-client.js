window.nextechFetch = async (path, options = {}) => {
  const hosted = location.hostname === 'darkred-viper-694452.hostingersite.com';
  const base = (window.NEXTECH_API_URL || (hosted ? 'https://system-the-leads.onrender.com' : '')).replace(/\/$/, '');
  if (!base && !['localhost', '127.0.0.1', '[::1]', 'system-the-leads.onrender.com'].includes(location.hostname)) {
    throw Error('O endereco do servidor ainda nao foi configurado.');
  }
  if (base && new URL(base).protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Configure uma API HTTPS.');
  const response = await fetch(base + path, { ...options, credentials: 'include' });
  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    throw Error(`O servidor retornou uma resposta inesperada (HTTP ${response.status}). Tente novamente em instantes.`);
  }
  return response;
};
