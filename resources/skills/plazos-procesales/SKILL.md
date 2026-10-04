---
name: plazos-procesales
description: Calcula plazos procesales y administrativos (días hábiles o naturales, meses, agosto, dies a quo, inhábiles) citando la norma de cómputo y usando `date` para no equivocarse con el calendario. Úsala cuando el usuario pregunte "qué plazo tengo", "hasta cuándo puedo", "cómputo del plazo", "vence el".
---

# Plazos procesales

## Método
1. Identifica el orden jurisdiccional o la vía (civil, penal, contencioso, social, administrativa) con la Fase 1 del razonamiento.
2. Localiza con `research` o `search_legal`:
   - la norma que fija la **duración** del plazo (p. ej. art. 404 LEC para contestar en el ordinario: veinte días);
   - la norma de **cómputo**: arts. 130-135 LEC (civil: días hábiles, exclusión de agosto salvo actuaciones urgentes, presentación hasta las 15:00 del día siguiente, art. 135.5), art. 30 LPAC (administrativo: hábiles, excluidos sábados, domingos y festivos; meses de fecha a fecha), arts. 182-185 LOPJ (días inhábiles procesales), LRJS para lo social, LJCA para lo contencioso.
3. Determina el **dies a quo** (día siguiente a la notificación, art. 133.1 LEC; o según la norma) y el **dies ad quem**.
4. Obtén las fechas reales con `bash`: `date -j -f "%Y-%m-%d" "2026-10-04" +%A` (macOS) o `date -d "2026-10-04 +20 days"` (Linux) y enumera los días hábiles uno a uno si el plazo es en días. Ten en cuenta festivos nacionales y, si se conocen, autonómicos y locales; si no constan, adviértelo.
5. Comprueba vías previas obligatorias y suspensiones (p. ej. solicitud de justicia gratuita, art. 16 LAJG).

## Salida
Tabla con: actuación · norma que fija el plazo (enlace) · norma de cómputo (enlace) · dies a quo · días excluidos · fecha límite · forma y lugar de presentación (LexNET, sede electrónica, registro).
Cierra con las advertencias: festivos no verificados, posible variación autonómica, prudencia de presentar con antelación.

## Prohibiciones
- No afirmes "días hábiles" o una fecha sin citar la norma de cómputo.
- No calcules de memoria: usa `date`.
