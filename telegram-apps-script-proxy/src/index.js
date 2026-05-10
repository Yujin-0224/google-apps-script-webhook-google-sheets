export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      return json({
        ok: true,
        service: 'telegram-apps-script-proxy',
        health: 'alive',
      });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method_not_allowed' }, 405);
    }

    const body = await request.text();
    let update;

    try {
      update = JSON.parse(body);
    } catch (err) {
      return json({ ok: false, error: 'invalid_json' }, 400);
    }

    const targetUrl = buildAppsScriptUrl(env);
    ctx.waitUntil(forwardToAppsScript(targetUrl, body, update));

    return json({
      ok: true,
      accepted: true,
      update_id: update.update_id ?? null,
      path: url.pathname,
    });
  },
};

function buildAppsScriptUrl(env) {
  if (!env.APPS_SCRIPT_URL) {
    throw new Error('Missing APPS_SCRIPT_URL');
  }

  const target = new URL(env.APPS_SCRIPT_URL);
  if (env.WEBHOOK_SECRET) {
    target.searchParams.set('secret', env.WEBHOOK_SECRET);
  }

  return target.toString();
}

async function forwardToAppsScript(targetUrl, body, update) {
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-update-id': String(update.update_id ?? ''),
    },
    body,
    redirect: 'follow',
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(`Apps Script failed: ${response.status} ${response.statusText} ${responseText.slice(0, 500)}`);
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
