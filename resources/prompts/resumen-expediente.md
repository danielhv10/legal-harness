---
description: Resume el estado del expediente a partir de sus documentos
argument-hint: "[directorio]"
---
Haz un resumen del expediente en ${1:-el directorio de trabajo actual}.

1. Lista los documentos con `ls`/`find` (PDF, Word, texto) y lee los relevantes con `read_pdf` / `read_docx` / `read`. Si alguno no se puede leer, dilo.
2. Extrae: partes y posición procesal, hechos esenciales con fechas, estado procesal actual, órgano y procedimiento, plazos próximos o vencidos, cuantías, pruebas disponibles y riesgos.
3. Presenta el resultado en secciones (###) con los documentos citados en **negrita**.
4. Si no existe `EXPEDIENTE.md`, propón crearlo con `/expediente init` y ofrece un borrador con lo extraído.
