# Rocko's Intelligence V10

- Corrige anulaciones: solo considera órdenes que tuvieron pago capturado y resta únicamente importes efectivamente reintegrados. Las cancelaciones previas al pago ya no inflan el estado de resultados.
- Intenta recuperar el detalle de pagos por varias rutas compatibles y combina esos datos con `sale_fee`, sin duplicar cargos.
- Amplía la clasificación de comisión, financiación/cuotas, cargo fijo, envío y otros cargos.
- Mantiene el costo real de envío a cargo del remitente.
- Convierte **Editar gastos mensuales** en una ventana modal visible y desplazable, con guardado por año.
- Cambia la clave de caché para forzar una conciliación nueva al instalar esta versión.
