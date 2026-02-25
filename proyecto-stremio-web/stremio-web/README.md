# Stremio Web — Fork con Skip Intro

Fork de [Stremio Web](https://github.com/Stremio/stremio-web) que añade **Skip Intro**: botón para saltar intros y créditos iniciales en series/películas usando marcadores compartidos.

## Qué incluye este fork

- **Skip Intro**: durante la reproducción aparece un botón para saltar la intro cuando hay marcadores disponibles.
- **API pública**: el frontend usa la API desplegada en **https://apistremio-skip-intro.org** (no necesitas levantar backend en local para probar).
- Misma base que Stremio: descubrir, ver y organizar contenido con addons.

## Requisitos

- **Node.js** 16 o superior
- **npm** o **pnpm**
- Repo clonado con **git** (el build usa el commit actual para cache)

## Instalación y desarrollo

```bash
npm install
npm start
```

El servidor de desarrollo arranca (puerto 8081 por defecto) y las peticiones a `/api` se redirigen a la API en la VPS.

## Build de producción

```bash
npm run build
```

La salida queda en la carpeta `build/`. Puedes servirla con cualquier servidor estático (Nginx, Vercel, Netlify, GitHub Pages, etc.).

## Configuración opcional

- **Otra API**: para apuntar a otra URL de la API Skip Intro, define antes del build:
  ```bash
  set REACT_APP_API_URL=https://tu-api.com
  npm run build
  ```
- En desarrollo, el proxy en `webpack.config.js` redirige `/api` a la API pública; si quieres usar una API local, cambia ahí el `target` del proxy.

## Publicar el frontend

1. **Build**: `npm run build`.
2. **Subir el contenido de `build/`** a tu hosting (por ejemplo GitHub Pages, Vercel o Netlify).
3. Asegúrate de que el proyecto sea un repositorio git antes de hacer el build (el script usa `git rev-parse HEAD`).

No hace falta base de datos ni backend propio: el frontend usa la API en https://apistremio-skip-intro.org.

## APK para Android

Puedes generar una app Android (APK) con **Capacitor** para usarla en móvil o Android TV. La app es el mismo frontend en un WebView, conectado a la API desplegada.

1. `npm install`
2. `npx cap add android` (solo la primera vez)
3. `npm run build:android`
4. `npm run android` (abre Android Studio) → Build APK o Run

Detalles y requisitos (Android Studio, APK firmado): ver **[BUILD-APK.md](BUILD-APK.md)**.

## Licencia

Stremio es copyright 2017-2023 Smart Code OOD y se distribuye bajo GPLv2. Ver [LICENSE](/LICENSE.md).
