# Registro de Cambios - Proyecto Skip Intro Stremio

---

## [v0.4.0] - 2026-02-25 - Fallback de Búsqueda IMDB + Season + Episode

### Problema resuelto
Si el identificador exacto (`infohash` / `videoId`) no encontraba resultados en la base de datos, la API devolvía un 404 sin intentar otras opciones. Esto limitaba la compatibilidad cuando distintas fuentes de stream generaban identificadores diferentes para el mismo episodio.

### Solución: Búsqueda fallback en dos pasos
La **VENTANILLA GET** (`/api/intro/:infohash`) ahora tiene un **Plan B**:
1. **Paso 1**: Busca por `infohash` exacto (comportamiento original, sin cambios).
2. **Paso 2**: Si no hay resultado y el cliente envió `imdb_id`, `season` y `episode` como query params, ejecuta una búsqueda alternativa por esos campos.

### Cambios en server.js

#### GET `/api/intro/:infohash` — Actualizado
- Acepta query params opcionales: `?imdb_id=ttXXXXXXX&season=N&episode=N`
- Si el infohash no encuentra resultado, busca por `imdb_id + season + episode` (usa el índice `idx_imdb_ep` existente)
- La respuesta incluye un nuevo campo `match_type`:
  - `"infohash"` → match exacto por infohash
  - `"imdb"` → match por fallback IMDB
- Mensaje de log diferenciado para cada tipo de match

### Cambios en Player.js

#### Efecto 1 (consulta API) — Actualizado
- Parsea el `videoId` (`tt0877057:1:1`) para extraer `imdb_id`, `season`, `episode`
- Añade automáticamente los query params de fallback a la URL de fetch: `?imdb_id=tt0877057&season=1&episode=1`
- El log ahora muestra el `match_type` de la respuesta (`infohash` o `imdb`)
- Si el videoId no tiene formato IMDB (ej: es un infoHash puro), no añade query params (fallback no aplica)

### Ejemplo de uso
```
GET /api/intro/abc123?imdb_id=tt0877057&season=1&episode=3
```
- Si `abc123` existe → devuelve con `match_type: "infohash"`
- Si no existe, pero hay datos para tt0877057 S1E3 → devuelve con `match_type: "imdb"`
- Si ninguno existe → 404

---

## [v0.3.0] - 2026-02-24 - Compatibilidad Real-Debrid + Identificador Universal

### Problema resuelto
El sistema usaba `infoHash` (hash de torrent) como identificador, pero los streams de **Real-Debrid** y otros servicios de debrid no tienen `infoHash` (son streams HTTP directos). Esto provocaba que `submitIntro` abortara con `infoHash: undefined`.

### Solución: Video ID universal
Se reemplazó el identificador por `videoId` extraído de `player.selected.streamRequest.path.id`, que tiene el formato `tt0877057:1:1` (IMDB ID + temporada + episodio). Esto es **mejor** que el infoHash porque:
- Funciona con **cualquier fuente** (torrents, Real-Debrid, otros debrid, HTTP directo)
- Todos los usuarios comparten los mismos datos de intro para el mismo episodio, independientemente de la fuente del stream
- El videoId se parsea automáticamente en `imdb_id`, `season`, `episode` para la DB

### Cambios en Player.js

#### Nueva función: `getVideoId()`
- Prioridad 1: `player.selected.streamRequest.path.id` (formato: `tt0877057:1:1`)
- Prioridad 2 (fallback): `player.selected.stream.infoHash` (torrents directos)
- Logging: `[SKIP] getVideoId - videoId: X infoHash: Y usando: Z`

#### `submitIntro()` actualizado
- Usa `getVideoId()` en vez de buscar `infoHash` directamente
- Parsea el videoId para enviar `imdb_id`, `season`, `episode` como campos separados
- Estado `'saving'` con feedback visual ("Guardando...")
- Si falla, vuelve a estado `'end'` para reintentar

#### Efecto 1 (consulta API) actualizado
- Usa `getVideoId()` para obtener el identificador
- URL con `encodeURIComponent(id)` para escapar los `:` del videoId

### Cambios en server.js (API)
- Servidor escucha en `0.0.0.0:3710` (antes: solo `localhost:3710`)
- Permite conexiones desde cualquier interfaz de red (necesario para acceso por IP externa)

### Cambios en UI de marcado
- Posición movida a `bottom: 140px` (antes: `top: 20px`)
- z-index subido a `99999` para estar encima de todas las capas del reproductor
- Todos los eventos blindados (`stopPropagation` + `preventDefault` en `onClick`, `onMouseDown`, `onPointerDown`, `onDoubleClick`)
- `pointerEvents: 'auto'` explícito en todos los elementos interactivos
- Estado `'saving'` muestra "Guardando..." y oculta el botón de acción

---

## [v0.2.0] - 2026-02-24 - UI de Marcado de Intros

### Frontend - Player.js

#### Nuevos estados React
- `markingMode` — Controla la fase del marcado (`false` | `'start'` | `'end'` | `'saving'`)
- `introStart` — Almacena el segundo de inicio capturado

#### Flujo del usuario (cuando NO hay datos de intro)
1. Aparece boton discreto **"Marcar Intro"** (esquina inferior derecha)
2. Al hacer clic, entra en modo marcado con instruccion: *"Reproduce hasta el INICIO de la intro"*
3. Usuario pulsa **"Marcar Inicio"** (azul) para capturar segundo actual
4. Panel cambia: muestra `Inicio en M:SS` y boton **"Marcar Fin"** (verde)
5. Usuario pulsa **"Marcar Fin"** para enviar POST a la API
6. Si exito, el boton "Saltar Intro" funciona automaticamente para ese video
7. **"Cancelar"** disponible en todo momento

#### Comportamiento automatico
- Al cambiar de video: resetea `markingMode` e `introStart`
- El boton "Marcar Intro" solo aparece si `introData` es `null`
- Una vez enviados los datos, `introData` se actualiza inmediatamente

---

## [v0.1.0] - 2026-02-24 - Base Funcional

### Backend - API REST (`stremio-skip-intro-api/`)

#### Archivos creados
- **`server.js`** — Servidor Express en puerto 3710
- **`database.db`** — Base de datos SQLite (auto-generada)
- **`package.json`** — Dependencias del proyecto

#### Funcionalidades implementadas
- **Base de datos SQLite** con tabla `intros`:
  - Campos: `id`, `infohash` (TEXT - acepta videoId o hash de torrent), `imdb_id`, `season`, `episode`, `skip_type`, `start_time`, `end_time`, `user_id`, `votes`
  - Indices en `infohash` e `imdb_id` para busquedas rapidas
- **POST `/api/intro`** — Guardar datos de intro con validacion:
  - `start_time` y `end_time` obligatorios y numericos
  - `start_time` < `end_time`
- **GET `/api/intro/:infohash`** — Buscar intro por identificador (devuelve la mas votada)
- **Rate Limiting persistente** (SQLite):
  - POST: 5 peticiones / 60 segundos por IP
  - GET: 60 peticiones / 60 segundos por IP
- **Seguridad**: Helmet (cabeceras HTTP) + CORS (origin: '*')

### Frontend - Stremio Web (`proyecto-stremio-web/stremio-web/`)

#### Cambios en Player.js
1. **Estados React**: `introData`, `showSkipButton`, `markingMode`, `introStart`
2. **`getVideoId()`**: Identificador universal (videoId > infoHash)
3. **Efecto 1**: Consulta API al cambiar de video
4. **Efecto 2**: Monitor de tiempo para mostrar/ocultar boton "Saltar Intro"
5. **Boton "SALTAR INTRO"**: `bottom: 150px, right: 50px`, salta a `end_time`
6. **UI de marcado**: Panel con "Marcar Inicio" / "Marcar Fin" / "Cancelar"

#### Cambios en webpack.config.js
- **Proxy del DevServer**: `/api/*` redirige a `http://localhost:3710`

---

## Esquema de Base de Datos

```sql
CREATE TABLE intros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    infohash TEXT,          -- videoId (tt0877057:1:1) o infoHash de torrent
    imdb_id TEXT,           -- tt0877057 (extraido del videoId)
    season INTEGER,         -- 1 (extraido del videoId)
    episode INTEGER,        -- 1 (extraido del videoId)
    skip_type TEXT,         -- 'intro' por defecto
    start_time INTEGER NOT NULL,  -- segundo de inicio
    end_time INTEGER NOT NULL,    -- segundo de fin
    user_id TEXT,           -- identificador del usuario (futuro)
    votes INTEGER DEFAULT 1 -- sistema de votos (futuro)
);

-- Indices
CREATE INDEX idx_infohash ON intros (infohash);
CREATE INDEX idx_imdb_ep ON intros (imdb_id, season, episode);
```

**Compatibilidad del campo `infohash`:**
| Fuente del stream | Valor almacenado en `infohash` | Ejemplo |
|---|---|---|
| Real-Debrid / Debrid | videoId | `tt0877057:1:1` |
| Torrent directo (con videoId) | videoId | `tt0877057:1:1` |
| Torrent directo (sin videoId) | infoHash | `a1b2c3d4e5...` |

---

## Arquitectura Actual

```
┌─────────────────────────────────────────────────┐
│              Navegador                           │
│  ┌───────────────────────────────────────────┐  │
│  │   Stremio Web (Player.js modificado)      │  │
│  │                                           │  │
│  │   getVideoId()                            │  │
│  │     -> player.selected.streamRequest      │  │
│  │        .path.id (tt0877057:1:1)           │  │
│  │     -> player.selected.stream.infoHash    │  │
│  │                                           │  │
│  │   fetch('/api/intro/{videoId}')           │  │
│  └──────────────┬────────────────────────────┘  │
└─────────────────┼───────────────────────────────┘
                  │ (ruta relativa via proxy)
                  ▼
┌─────────────────────────────────────────────────┐
│  Webpack Dev Server (:8081 en 0.0.0.0)          │
│  Proxy: /api/* -> localhost:3710                │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  API Skip Intro (:3710 en 0.0.0.0)              │
│  Express + SQLite + Helmet + CORS + RateLimiter │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  database.db (SQLite)                            │
│  Tabla: intros                                   │
│  Busqueda por: infohash (videoId o hash)        │
└─────────────────────────────────────────────────┘
```

---

## Problemas Resueltos

| Problema | Causa | Solucion |
|---|---|---|
| Mixed Content (HTTPS/HTTP) | Navegador bloquea HTTP desde HTTPS | Proxy de Webpack redirige `/api` |
| Private Network Access | Acceso desde IP externa a localhost | Proxy server-side (no cross-origin) |
| `infoHash: undefined` con Real-Debrid | Streams debrid no tienen infoHash | Usar `videoId` de `streamRequest.path.id` |
| Botones no responden a clics | Eventos capturados por el reproductor | `stopPropagation` + `preventDefault` en todos los eventos |
| API inaccesible desde IP externa | `server.listen` solo en localhost | Cambio a `0.0.0.0` |

---

## Pendiente de Implementar

### Prioridad Media
- [ ] **Sistema de votos** — Permitir que usuarios confirmen/rechacen intros existentes
- [ ] **Proxy para produccion** — Configurar URL de la API dinamicamente (no solo proxy de dev)
- [x] **Busqueda alternativa por IMDB** — Si no hay datos por videoId exacto, buscar por `imdb_id + season + episode` (v0.4.0)

### Prioridad Baja
- [ ] **HTTPS para la API** — Certificado SSL para entornos de produccion
- [ ] **Panel de administracion** — Ver/editar/eliminar intros desde interfaz web
- [ ] **Limpieza de logs** — Eliminar `console.log('[SKIP]...')` de debug en produccion

---

## Notas Tecnicas

- El puerto **11470** es el servidor local de **Stremio Desktop** (no es nuestro). Debe estar corriendo para que Stremio Web funcione.
- Acceder via `http://localhost:8081` para evitar bloqueos de Private Network Access de Chrome. Desde IPs externas, el proxy de Webpack sigue funcionando pero los servicios de Stremio (puerto 11470) pueden fallar.
- La API solo funciona en desarrollo con el proxy de Webpack. Para produccion se necesitara una solucion diferente (reverse proxy, mismo dominio, etc.).
- El campo `infohash` en la DB es generico (TEXT) y almacena el identificador mas apropiado segun la fuente del stream.
