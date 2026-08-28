# Rocko's Intelligence V8 — Resultados mensuales conciliados

## Cambios

- Comisiones, cuotas, cargos fijos, envíos y otros descuentos se obtienen de las liquidaciones de pagos de Mercado Libre.
- El total descontado por Mercado Libre se reconcilia contra el neto recibido para evitar sumar cargos dos veces.
- Mercadería y packaging continúan viniendo del Excel por SKU.
- Publicidad, alquiler, sueldos, servicios, contador, software, gastos bancarios, logística externa, retenciones, impuestos y otros gastos son editables manualmente por mes.
- Se agregó la fila **Neto después de Mercado Libre**.
- Se muestra cuántas liquidaciones fueron conciliadas y cuántos pagos quedaron con datos parciales.

## Fórmula

Resultado neto = Neto recibido de Mercado Libre − costo de mercadería y packaging − gastos externos manuales − retenciones − impuestos.
