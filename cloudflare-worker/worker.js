/**
 * Cloudflare Worker — Generic POST proxy
 *
 * يستقبل: POST https://<your-worker>.workers.dev/?target=<encodedURL>
 *   - target: الرابط الكامل المُراد إعادة توجيه الطلب إليه (مُشفّر بـ encodeURIComponent).
 *   - Body: يُمرَّر كما هو إلى target.
 *   - Content-Type يُمرَّر من الطلب الأصلي.
 *
 * يعيد: نفس استجابة target (status + headers + body) مع CORS مفتوح.
 *
 * الحماية: يقبل فقط نطاقات في ALLOWED_HOSTS (لمنع إساءة استخدام الـ Worker كبروكسي مفتوح).
 * أضف نطاقاتك هنا — كل نطاق جديد لموقع SMM يُضاف للقائمة.
 *
 * (اختياري) ضع متغير بيئة PROXY_SECRET في Cloudflare ثم أرسل header:
 *   x-proxy-secret: <SAME_VALUE>
 * لضمان أن خادم Railway فقط هو من يستخدم الـ Worker.
 */

const ALLOWED_HOSTS = [
  'followers-store.com',
  // أضف هنا أي موقع SMM آخر مستقبلاً، مثل:
  // 'another-smm-site.com',
];

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    // (اختياري) حماية بمفتاح
    if (env.PROXY_SECRET) {
      const provided = request.headers.get('x-proxy-secret');
      if (provided !== env.PROXY_SECRET) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    const url = new URL(request.url);
    const target = url.searchParams.get('target');
    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing ?target=<url>' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid target URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!ALLOWED_HOSTS.some((h) => targetUrl.hostname === h || targetUrl.hostname.endsWith('.' + h))) {
      return new Response(JSON.stringify({ error: 'Host not allowed', host: targetUrl.hostname }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ابنِ طلبًا متصفّحيًا نظيفًا
    const forwardHeaders = new Headers();
    const ct = request.headers.get('content-type');
    if (ct) forwardHeaders.set('Content-Type', ct);
    forwardHeaders.set('Accept', 'application/json, text/plain, */*');
    forwardHeaders.set('Accept-Language', 'en-US,en;q=0.9,ar;q=0.8');
    forwardHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
    forwardHeaders.set('Origin', `${targetUrl.protocol}//${targetUrl.hostname}`);
    forwardHeaders.set('Referer', `${targetUrl.protocol}//${targetUrl.hostname}/`);

    const body = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer();

    const upstream = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: forwardHeaders,
      body,
      redirect: 'follow',
    });

    const respHeaders = new Headers(upstream.headers);
    respHeaders.set('Access-Control-Allow-Origin', '*');
    respHeaders.delete('content-encoding'); // Cloudflare يفك الضغط تلقائياً

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  },
};
