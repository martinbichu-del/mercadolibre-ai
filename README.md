# Rocko's Intelligence V5.1

Versión funcional para Netlify con:

- Dashboard por mes calendario.
- Comparación contra el mismo período del mes anterior.
- Gráficos diarios y semanales.
- Proyección de cierre usando promedio móvil de 7 días.
- Histórico de 6 meses.
- Publicaciones, stock real de Mercado Libre y ventas del período.
- Importación de Excel de costos; el stock del Excel se ignora.
- Compras inteligentes con lead time configurable (20 días por defecto) y stock de seguridad.
- Comparador público de publicaciones competidoras.
- Preguntale a Rocko con OpenAI.
- Estructura visual del módulo Mercado Ads preparada.

## Importante

El módulo de Publicidad no muestra métricas inventadas. Para traer ROAS, ACOS, clics, impresiones e inversión falta completar la integración específica con Mercado Ads y el advertiser de la cuenta.

## Variables de Netlify

- `MELI_CLIENT_ID`
- `MELI_CLIENT_SECRET`
- `MELI_REDIRECT_URI`
- `OPENAI_API_KEY`

No hace falta agregar variables nuevas para esta versión.


## Vinculación de costos
La vinculación se realiza exclusivamente con la columna SKU del Excel. El stock se toma siempre de Mercado Libre.
