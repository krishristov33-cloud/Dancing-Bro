// Minimal CORS proxy for JSR radio files, so the hosted game (GitHub Pages) can analyse the audio.
// Deploy: Cloudflare dashboard -> Workers -> Create -> paste this -> Deploy.
// Then open the game with ?proxy=https://<your-worker>.workers.dev (remembered in localStorage).
// Only /radio/stations/* is forwarded; responses are cached at the edge to spare jetsetradio.live bandwidth.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!url.pathname.startsWith('/radio/stations/')) return new Response('not found', { status: 404, headers: cors });
    const upstream = await fetch('https://jetsetradio.live' + url.pathname, { cf: { cacheTtl: 86400, cacheEverything: true } });
    const res = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};
