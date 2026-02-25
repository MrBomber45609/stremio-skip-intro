# Generar APK (Android)

El proyecto usa **Capacitor** para empaquetar el frontend web como app Android. La app es un WebView que carga el mismo código que la web y se conecta a la API en https://apistremio-skip-intro.org.

## Requisitos

- **Node.js** 16+
- **Android Studio** (o SDK de Android + Gradle) para compilar el APK
- Repositorio **git** inicializado (el build de webpack lo usa)

## Pasos

### 1. Instalar dependencias

```bash
npm install
```

### 2. Añadir la plataforma Android (solo la primera vez)

```bash
npx cap add android
```

Se crea la carpeta `android/` con el proyecto nativo.

### 3. Build web y sincronizar con Android

```bash
npm run build:android
```

Esto hace el build de webpack y copia el contenido de `build/` al proyecto Android.

(Si ya tienes el build: `npm run cap:sync`.)

### 4. Abrir en Android Studio y generar el APK

```bash
npm run android
```

Se abre Android Studio. Luego:

- **Probar en emulador o dispositivo**: Run (▶).
- **Generar APK para instalar**: *Build → Build Bundle(s) / APK(s) → Build APK(s)*. El APK queda en `android/app/build/outputs/apk/debug/` (debug) o *Build → Generate Signed Bundle / APK* para release.

Para un **APK firmado (release)** que puedas publicar o instalar en otros dispositivos: *Build → Generate Signed Bundle / APK*, crea un keystore si no tienes y elige APK.

## Configuración

- **Nombre e ID de la app**: en `capacitor.config.json` (`appName`, `appId`). El `appId` debe ser único (ej. `org.stremio.skipintro.web`).
- **URL de la API**: la app usa la misma API que la web (configurada en webpack/Player.js). No hace falta cambiar nada para la API desplegada.

## Notas

- La app funciona como la web: addons, reproductor, Skip Intro y marcar intros/créditos.
- En Android TV / Google TV puedes usar la misma APK si instalas en el dispositivo; el mando debería poder enfocar los botones (estilos de foco ya añadidos).
