interface Env {
  API_ORIGIN: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const origin = env.API_ORIGIN;
  if (!origin) {
    return new Response("Missing API_ORIGIN", { status: 500 });
  }

  const requestUrl = new URL(request.url);
  const upstream = new URL(requestUrl.pathname + requestUrl.search, origin);
  const headers = new Headers(request.headers);
  headers.set("host", upstream.host);

  return fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual"
  });
};
