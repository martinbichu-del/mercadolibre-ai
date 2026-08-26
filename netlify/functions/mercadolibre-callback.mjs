export default async (request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(
      `Mercado Libre devolvió un error de autorización: ${error}`,
      {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" }
      }
    );
  }

  if (!code) {
    return new Response(
      "Callback de Mercado Libre activo. Todavía no se recibió un código de autorización.",
      {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" }
      }
    );
  }

  // En la siguiente etapa este código se intercambiará por access_token
  // usando variables protegidas de Netlify. Por seguridad, no se muestra.
  return new Response(
    "Autorización recibida correctamente. El próximo paso es guardar el token de forma segura.",
    {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    }
  );
};
