# Rocko's Intelligence V5.1 — Vinculación SKU

## Corrección principal
- La columna **SKU** del Excel es la única llave usada para vincular costos.
- El stock del Excel continúa ignorándose; el stock siempre se toma de Mercado Libre.
- Mercado Libre puede devolver el SKU en varios campos. La aplicación ahora revisa:
  - `seller_custom_field`
  - `seller_sku`
  - atributo `SELLER_SKU`
  - SKU de cada variación de la publicación
- Las publicaciones con variaciones exponen todos sus SKU para que el Excel pueda vincularlos.
- Se distingue internamente entre una publicación sin SKU en Mercado Libre y un SKU que no existe en el Excel.

## Después de publicar
Volver a subir el Excel desde **Productos y costos** y pulsar **Actualizar datos**.
