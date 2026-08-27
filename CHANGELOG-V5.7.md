# Rocko's Intelligence V5.7 — Modelo financiero del Excel

## Corrección principal

La aplicación deja de reconstruir o adivinar los cargos financieros desde campos dispersos de la API.

Para cada SKU usa exactamente las columnas importadas del Excel:

- Precio Vta neto
- Com MELI
- Cuotas
- Cargo fijo
- Envío
- Pvta - Gastos ML
- Costo + Pack
- Rentabilidad (ganancia en pesos)
- % Rent (rentabilidad sobre costo)

Mercado Libre sigue siendo la fuente para:

- unidades vendidas del período;
- operaciones;
- stock;
- publicaciones.

## Fórmulas

- Costos ML = Comisión + Cuotas + Cargo fijo + Envío
- Neto ML = Precio vendido − Costos ML
- Ganancia = Neto ML − Costo + Pack
- Margen sobre venta = Ganancia ÷ Precio vendido
- Rentabilidad sobre costo = Ganancia ÷ Costo + Pack

## Ejemplo Ocean

- Precio vendido: $24.180
- Costos ML: $8.289
- Neto ML: $15.891
- Costo + Pack: $8.660
- Ganancia: $7.231
- Margen sobre venta: 29,9%
- Rentabilidad sobre costo: 83,5%
