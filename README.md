# Stremio Skip Intro

A Stremio fork that adds a **Skip Intro** feature: skip intros and credits in TV shows/movies using community-shared markers.

This repository contains:

| Folder | Description |
|--------|-------------|
| **proyecto-stremio-web/stremio-web/** | Web frontend (Stremio Web + Skip Intro button, mark intro start/end). See the [frontend README](proyecto-stremio-web/stremio-web/README.md). |
| **stremio-skip-intro-api/** | REST API (Node.js + Express + SQLite) to save and query intro/credits markers. |

## Quick Start

- **Just use it**: the API is deployed at **https://apistremio-skip-intro.org**. Open the frontend (web or APK) and it will automatically use this API.
- **Develop frontend**: `cd proyecto-stremio-web/stremio-web && npm install && npm start`
- **Build frontend**: `cd proyecto-stremio-web/stremio-web && npm run build`
- **Android APK**: see [BUILD-APK.md](proyecto-stremio-web/stremio-web/BUILD-APK.md) in the frontend folder.
- **Local API**: `cd stremio-skip-intro-api && npm install && cp .env.example .env && npm start` (port 3710).

## License

- Frontend: GPLv2 (Stremio – Smart Code OOD).
- API: ISC.
