# Rocko’s Intelligence V5.2 — Diagnóstico de SKU y variaciones

- La vinculación continúa siendo exclusivamente por la columna SKU del Excel.
- Normaliza espacios, guiones, acentos y caracteres invisibles sólo durante la comparación.
- Lee SKU principal, atributos SELLER_SKU y SKU de todas las variaciones.
- Consulta el detalle individual de publicaciones que no vinculan en la respuesta masiva de Mercado Libre.
- Usa el SKU visto en órdenes como respaldo diagnóstico cuando Mercado Libre no lo expone en la publicación.
- Agrega columnas “SKU detectado ML” y “Origen” para saber si la coincidencia provino de la publicación, una variación o una venta.
- No modifica ningún SKU ni vincula por nombre.
