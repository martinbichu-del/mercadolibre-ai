# Rocko's Intelligence V9 — Estado de resultados conciliado

- Agrega Ventas totales, Anulaciones/devoluciones y Ventas netas como rubros separados.
- Agrega KPIs superiores de ventas totales, anulaciones, ventas netas, costos ML, neto después de ML y resultado neto.
- Recupera comisiones desde pagos y utiliza `order_items.sale_fee` como respaldo cuando Mercado Libre no expone el detalle del pago.
- Consulta el costo real de envío a cargo del vendedor desde `/shipments/{id}/costs` y `senders[].cost`.
- Evita duplicar comisiones y otros cargos al conciliar el total descontado.
- Mantiene editables únicamente los gastos externos a Mercado Libre.
