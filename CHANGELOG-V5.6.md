# Rocko's Intelligence V5.6

## Corrección de rentabilidad real

- Corrige el costo de envío atribuido al vendedor.
- La aplicación usa únicamente `senders[].cost` del endpoint de costos del envío.
- Deja de usar `sender.cost`, `gross_amount` y otros importes logísticos brutos que podían inflar los costos de Mercado Libre.
- Mantiene las dos métricas:
  - Margen sobre venta = ganancia / precio vendido.
  - Rentabilidad sobre costo = ganancia / costo + pack.

### Ejemplo esperado — TempladoTitanio

- Precio vendido aproximado: $22.160.
- Neto luego de Mercado Libre: aproximadamente $15.325.
- Costo + pack: $8.285.
- Ganancia: aproximadamente $7.040.
- Rentabilidad sobre costo: aproximadamente 85%.
