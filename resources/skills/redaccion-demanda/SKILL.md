---
name: redaccion-demanda
description: Redacta una demanda civil (o un escrito procesal análogo: contestación, reconvención) con la estructura de la LEC, verificando antes competencia, procedimiento y plazos con las fuentes y guardando el resultado en Word. Úsala cuando el usuario pida "redacta la demanda", "prepara un escrito de contestación", "borrador de recurso".
---

# Redacción de demanda

## Antes de escribir
1. Lee `EXPEDIENTE.md` y los documentos del expediente que fundamentan los hechos (contratos, burofaxes, informes). Extrae partes, fechas, cuantías y pretensiones.
2. Llama a `research` con una descripción del asunto y la pretensión. Verifica en los bloques:
   - competencia objetiva y territorial (arts. 45 y ss., 50 y ss. LEC);
   - procedimiento adecuado por materia o cuantía (arts. 248-250 LEC) y cómo se determina la cuantía (arts. 251-255 LEC);
   - requisitos de la demanda (art. 399 LEC) y documentos que deben acompañarla (arts. 264-265 LEC);
   - postulación (arts. 23 y 31 LEC) y, si procede, vías previas obligatorias.
3. Si falta un dato esencial (Comunidad Autónoma, cuantía, fecha de los hechos), pregúntalo antes de redactar.

## Estructura obligatoria
- **Encabezamiento**: "AL TRIBUNAL DE INSTANCIA DE [LOCALIDAD]" (denominación vigente tras la reforma de 2025) o al órgano competente; procurador y abogado; identificación de las partes.
- **HECHOS**: numerados (PRIMERO, SEGUNDO…), cronológicos, cada uno con el documento que lo acredita ("Documento nº X: **nombre del fichero**").
- **FUNDAMENTOS DE DERECHO**: I. Jurídico-procesales (jurisdicción y competencia, capacidad y legitimación, postulación, procedimiento, cuantía); II. Jurídico-materiales (normas sustantivas con su enlace tal cual lo devuelven las fuentes, jurisprudencia con Roj/ECLI y fecha); III. Costas (art. 394 LEC).
- **SUPLICO**: pretensión principal y subsidiarias, claras y ejecutables.
- **OTROSÍ DIGO**: prueba, cuantía, intereses, medidas cautelares si procede.
- Lugar, fecha y firmas.

## Reglas de redacción
- Placeholders en mayúsculas entre corchetes para lo que no conste: [NOMBRE_CLIENTE], [DNI], [DOMICILIO], [CUANTÍA].
- Cita el articulado con el enlace servido por las fuentes; nunca inventes números de artículo.
- Si una norma aparece DEROGADA o MODIFICADA en la línea "Vigencia:", aplica las reglas del sistema (advertencia expresa, norma sustituta).

## Entrega
- Guarda con `write_docx` en el expediente (p. ej. `Demanda_[CLIENTE]_borrador.docx`).
- Resume al usuario: estructura, fundamentos clave, documentos a aportar y placeholders pendientes.
