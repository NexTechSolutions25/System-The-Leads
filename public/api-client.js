window.nextechFetch = (path, options = {}) => {
  const base = (window.NEXTECH_API_URL || '').replace(/\/$/, '');
  if (base && new URL(base).protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Configure uma API HTTPS.');
  return fetch(base + path, { ...options, credentials: 'include' });
};
