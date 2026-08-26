export default async (request) => {
  if (request.method !== "POST") {
    return new Response(
      "Endpoint de notificaciones de Mercado Libre activo.",
      {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" }
      }
    );
  }

  let payload = null;

  try {
    payload = await request.json();
  } catch {
    // Mercado Libre espera una respuesta rápida. Aunque el cuerpo no sea JSON,
    // confirmamos la recepción para evitar reintentos innecesarios.
  }

  // En la siguiente etapa guardaremos estos eventos en una base de datos.
  console.log("Notificación recibida:", payload);

  return new Response("OK", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
};
