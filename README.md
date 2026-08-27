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


## V5.5
Incluye las dos rentabilidades, semáforo, consejos y simulador de impacto de precio.

## V5.6 — conciliación de envíos

El costo de envío del vendedor se obtiene exclusivamente desde `senders[].cost` en `/shipments/{id}/costs`, evitando usar costos logísticos brutos que distorsionaban la rentabilidad.

## V5.7 — Regla financiera

La pantalla Productos y costos replica la estructura financiera del Excel importado. La API de Mercado Libre se usa para unidades, operaciones, stock y publicaciones; no para reconstruir cargos financieros que puedan duplicarse o clasificarse incorrectamente.


## V5.8
Ver `CHANGELOG-V5.8.md` para la búsqueda SEO hasta 150 resultados y la base de rentabilidad de 60 días.

## V5.9
Corrige la búsqueda SEO autenticada y recupera SKU históricos desde publicaciones/variaciones para la base de costos de los últimos dos meses.
