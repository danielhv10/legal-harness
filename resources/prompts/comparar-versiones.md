---
description: Compara dos versiones de un documento (contrato, escrito) cláusula a cláusula
argument-hint: "<fichero_a> <fichero_b>"
---
Compara los documentos $1 y $2.

Léelos con la herramienta adecuada (`read_docx` para Word, `read_pdf` para PDF, `read` para texto). Devuelve una tabla con una fila por cláusula o apartado modificado: texto anterior (resumido), texto nuevo (resumido), tipo de cambio (añadido / suprimido / modificado) e impacto jurídico para mi cliente (favorable / desfavorable / neutro, con una frase de motivo). Cierra con las tres diferencias más relevantes y lo que convendría negociar o verificar en las fuentes antes de firmar.
