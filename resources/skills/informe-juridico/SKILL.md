---
name: informe-juridico
description: "Elabora un informe o dictamen jurídico estructurado (antecedentes, cuestiones, normativa aplicable y vigencia, análisis, conclusiones) sobre una cuestión del expediente, con citas verificadas. Úsala cuando el usuario pida \"dictamen\", \"informe\", \"nota jurídica\", \"análisis de viabilidad\" o \"qué opciones tenemos\"."
---

# Informe jurídico

## Preparación
1. Delimita la cuestión con el usuario si es ambigua (una o dos preguntas como máximo).
2. Lee los documentos del expediente relevantes y anota hechos y fechas con su documento fuente.
3. Llama a `research`. Para cada norma relevante lee la línea "Vigencia:"; si necesitas el texto íntegro de un artículo o sentencia, usa `get_document`.
4. Si la cuestión depende de una Comunidad Autónoma, verifica la normativa autonómica con `search_legal` (colecciones `kb_extra` y `boe`).

## Estructura
### I. Antecedentes
Hechos relevantes numerados, con el documento que los acredita en **negrita**.
### II. Cuestiones planteadas
Lista cerrada de preguntas a responder.
### III. Normativa y jurisprudencia aplicables
Por niveles (UE, estatal, autonómica). Cada norma con su enlace tal cual lo devuelven las fuentes y su estado de vigencia; cada sentencia con fecha, órgano (denominación vigente) y Roj/ECLI.
### IV. Análisis
Aplicación de las tres fases (materia → normativa vigente → cauce). Argumenta a favor y en contra; señala riesgos y lagunas probatorias.
### V. Conclusiones
Respuesta directa a cada cuestión de II, con grado de certeza y qué dato o fuente adicional la reforzaría.
### VI. Recomendaciones y próximos pasos
Actuaciones, plazos (con norma de cómputo) y documentos a recabar.

## Reglas
- Toda afirmación jurídica con su fuente servida; lo no verificado, marcado como "pendiente de verificar".
- Sin encabezados de nivel 1 ni 2 en la respuesta de chat; en el Word usa títulos normales.
- Extensión: la propia de un dictamen; no telegráfico.

## Entrega
Si el usuario lo pide en Word: `write_docx` en el expediente (`Informe_[ASUNTO]_[AAAA-MM-DD].docx`).
