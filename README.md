# Rocko's Intelligence v4

Primera versión funcional para conectar una cuenta de Mercado Libre con Netlify, visualizar publicaciones, ventas y stock, y consultar los datos mediante OpenAI.

## Incluye

- OAuth real con Mercado Libre y validación de seguridad `state`.
- Renovación automática del access token mediante refresh token.
- Dashboard de publicaciones activas, ventas de 30 días y stock crítico.
- Listado de ventas recientes y ranking por facturación.
- Asistente “Preguntale a Rocko” conectado a OpenAI.
- Recepción y almacenamiento de notificaciones de Mercado Libre.
- Diseño oscuro con el logo de Rocko's Place.
- Modo seguro: no modifica precios, stock ni publicaciones.

## Variables de entorno requeridas en Netlify

- `MELI_CLIENT_ID`
- `MELI_CLIENT_SECRET`
- `MELI_REDIRECT_URI`
- `OPENAI_API_KEY`

Para el sitio configurado actualmente:

- Redirect URI: `https://genuine-malabi-a52dd8.netlify.app/api/mercadolibre/callback`
- Notifications callback: `https://genuine-malabi-a52dd8.netlify.app/api/mercadolibre/notificaciones`

## Publicación

1. Descomprimir este ZIP.
2. En GitHub, abrir el repositorio `mercadolibre-ai`.
3. Elegir **Add file → Upload files**.
4. Arrastrar el contenido de esta carpeta, no el ZIP.
5. Confirmar **Commit changes** en la rama `main`.
6. Netlify desplegará automáticamente.
7. Abrir el sitio y pulsar **Conectar Mercado Libre**.

## Alcance actual

Esta versión lee datos reales de Mercado Libre después de autorizar la cuenta. La comparación con competidores, rentabilidad con costos y automatizaciones quedan para la siguiente etapa.
