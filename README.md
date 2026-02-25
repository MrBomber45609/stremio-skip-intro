# Stremio Skip Intro

Fork de Stremio que añade **Skip Intro**: saltar intros y créditos en series/películas usando marcadores compartidos por la comunidad.

Este repositorio contiene:

| Carpeta | Descripción |
|--------|-------------|
| **proyecto-stremio-web/stremio-web/** | Frontend web (Stremio Web + botón Skip Intro, marcar inicio/fin intro). Ver [README del frontend](proyecto-stremio-web/stremio-web/README.md). |
| **stremio-skip-intro-api/** | API REST (Node.js + Express + SQLite) para guardar y consultar marcadores de intros/créditos. |

## Uso rápido

- **Solo usar**: la API está desplegada en **https://apistremio-skip-intro.org**. Abre el frontend (web o APK) y ya usará esa API.
- **Desarrollar frontend**: `cd proyecto-stremio-web/stremio-web && npm install && npm start`
- **Build frontend**: `cd proyecto-stremio-web/stremio-web && npm run build`
- **APK Android**: ver [BUILD-APK.md](proyecto-stremio-web/stremio-web/BUILD-APK.md) en el frontend.
- **API local**: `cd stremio-skip-intro-api && npm install && cp .env.example .env && npm start` (puerto 3710).

## Licencia

- Frontend: GPLv2 (Stremio – Smart Code OOD).
- API: ISC.
