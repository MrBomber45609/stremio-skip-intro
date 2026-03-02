const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

let mainWindow;
let stremioServer;
let localServer;

const STREMIO_PORT = 11470;
const LOCAL_UI_PORT = 8089; // Puerto único para evitar conflictos con webpack (8081)

// --- MIME types ---
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
    '.txt': 'text/plain'
};

// --- Servidor HTTP local para servir el build en producción ---
function startLocalServer(buildPath) {
    return new Promise((resolve, reject) => {
        localServer = http.createServer((req, res) => {
            let urlPath = decodeURIComponent(req.url.split('?')[0]);
            if (urlPath === '/') urlPath = '/index.html';

            // Resolver ruta real del archivo (fuera del asar si es necesario)
            const filePath = path.join(buildPath, urlPath);
            const ext = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';

            fs.readFile(filePath, (err, data) => {
                if (!err) {
                    res.writeHead(200, {
                        'Content-Type': contentType,
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(data);
                    return;
                }

                // SPA fallback
                fs.readFile(path.join(buildPath, 'index.html'), (err2, fallback) => {
                    if (err2) {
                        res.writeHead(404);
                        res.end('Not found: ' + urlPath);
                    } else {
                        res.writeHead(200, {
                            'Content-Type': 'text/html',
                            'Access-Control-Allow-Origin': '*'
                        });
                        res.end(fallback);
                    }
                });
            });
        });

        localServer.listen(LOCAL_UI_PORT, '127.0.0.1', () => {
            console.log(`[UI Server] Servidor local en http://127.0.0.1:${LOCAL_UI_PORT}`);
            console.log(`[UI Server] Sirviendo archivos desde: ${buildPath}`);
            resolve(true);
        });

        localServer.on('error', (err) => {
            console.error('[UI Server] Error:', err.message);
            resolve(false);
        });
    });
}

// --- Ventana principal ---
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'assets', 'favicons', 'favicon.ico'),
        title: 'Stremio Skip Intro',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false
        }
    });

    const isDev = !app.isPackaged;
    const loadUrl = isDev
        ? 'http://localhost:8081'
        : `http://127.0.0.1:${LOCAL_UI_PORT}`;

    console.log(`[Window] Cargando: ${loadUrl} (isDev: ${isDev})`);
    mainWindow.loadURL(loadUrl);

    // Abrir DevTools en desarrollo para depuración
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
}

// --- CORS bypass ---
function setupCORSBypass() {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = Object.assign({}, details.responseHeaders);
        responseHeaders['Access-Control-Allow-Origin'] = ['*'];
        responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
        responseHeaders['Access-Control-Allow-Headers'] = ['Content-Type, Authorization'];
        callback({ responseHeaders });
    });

    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        callback({ requestHeaders: details.requestHeaders });
    });
}

// --- Servidor de streaming Stremio ---
function checkServerRunning() {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${STREMIO_PORT}/settings`, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

// Verifica si el servidor corriendo tiene ffmpeg funcional
function checkServerHasFFmpeg() {
    return new Promise((resolve) => {
        const testUrl = `http://127.0.0.1:${STREMIO_PORT}/hlsv2/probe?m=http://test.local/test.mkv`;
        const req = http.get(testUrl, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    // Si el error menciona "no ffmpeg" o "locateExecutables", no tiene ffmpeg
                    const errMsg = json.error && json.error.message || '';
                    if (errMsg.includes('no ffmpeg') || errMsg.includes('locateExecutables')) {
                        console.log('[Stremio] Server corriendo SIN ffmpeg:', errMsg);
                        resolve(false);
                    } else {
                        // Cualquier otro error (como "Probe process exited") significa que ffmpeg SÍ está
                        console.log('[Stremio] Server corriendo CON ffmpeg OK');
                        resolve(true);
                    }
                } catch (e) {
                    resolve(true); // Si no podemos parsear, asumimos que está bien
                }
            });
        });
        req.on('error', () => resolve(true));
        req.setTimeout(3000, () => {
            req.destroy();
            resolve(true);
        });
    });
}

// Mata el proceso del servidor en el puerto de Stremio
function killExistingServer() {
    return new Promise((resolve) => {
        const { exec } = require('child_process');
        exec(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${STREMIO_PORT} ^| findstr LISTENING') do taskkill /PID %a /F`, { shell: 'cmd.exe' }, (err) => {
            if (err) console.log('[Stremio] No se pudo matar servidor existente (puede que ya murió)');
            else console.log('[Stremio] Servidor existente terminado para reiniciar con ffmpeg');
            // Esperar un momento para que el puerto se libere
            setTimeout(() => resolve(), 1500);
        });
    });
}

function findStremioServer() {
    const localAppData = process.env.LOCALAPPDATA;
    // Buscar server.js en las ubicaciones conocidas de Stremio
    const candidates = [
        path.join(localAppData, 'Programs', 'LNV', 'Stremio-4', 'server.js'),
        path.join(localAppData, 'Programs', 'LNV', 'Stremio', 'server', 'server.js'),
        path.join(localAppData, 'Programs', 'Stremio', 'server.js'),
        path.join('C:', 'Program Files', 'Stremio', 'server.js'),
        path.join('C:', 'Program Files (x86)', 'Stremio', 'server.js'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            console.log('[Stremio] server.js encontrado en:', candidate);
            return candidate;
        }
    }

    console.error('[Stremio] No se encontró server.js en ninguna ubicación conocida:');
    candidates.forEach(c => console.error('  -', c));
    return null;
}

async function startStremioServer() {
    const alreadyRunning = await checkServerRunning();
    if (alreadyRunning) {
        console.log('[Stremio] Server ya corriendo en puerto', STREMIO_PORT);
        // Verificar si tiene ffmpeg, si no, matar y reiniciar
        const hasFFmpeg = await checkServerHasFFmpeg();
        if (hasFFmpeg) {
            console.log('[Stremio] Server existente tiene ffmpeg, usándolo tal cual');
            return;
        }
        console.log('[Stremio] Server existente NO tiene ffmpeg, reiniciando...');
        await killExistingServer();
    }

    const serverPath = findStremioServer();
    if (!serverPath) return;

    const stremioDir = path.dirname(serverPath);

    // Buscar runtime: stremio-runtime.exe (Node empaquetado) o node del sistema
    // stremio-runtime puede estar en un directorio diferente al server.js
    const runtimeCandidates = [
        path.join(stremioDir, 'stremio-runtime.exe'),
        path.join(process.env.LOCALAPPDATA, 'Programs', 'Stremio', 'stremio-runtime.exe'),
        path.join(process.env.LOCALAPPDATA, 'Programs', 'LNV', 'Stremio-4', 'stremio-runtime.exe'),
    ];
    const runtimePath = runtimeCandidates.find(r => fs.existsSync(r));
    const runtime = runtimePath || 'node';

    console.log('[Stremio] Encendiendo motor en:', serverPath);
    console.log('[Stremio] Runtime:', runtime);

    // Buscar ffmpeg/ffprobe en el directorio del server y en el del runtime
    const searchDirs = [stremioDir];
    if (runtimePath) searchDirs.push(path.dirname(runtimePath));

    let ffmpegBin = null;
    let ffprobeBin = null;
    for (const dir of searchDirs) {
        if (!ffmpegBin && fs.existsSync(path.join(dir, 'ffmpeg.exe'))) ffmpegBin = path.join(dir, 'ffmpeg.exe');
        if (!ffprobeBin && fs.existsSync(path.join(dir, 'ffprobe.exe'))) ffprobeBin = path.join(dir, 'ffprobe.exe');
    }

    const env = Object.assign({}, process.env, {
        PATH: stremioDir + path.delimiter + (runtimePath ? path.dirname(runtimePath) + path.delimiter : '') + process.env.PATH,
        FFMPEG_BIN: ffmpegBin || undefined,
        FFPROBE_BIN: ffprobeBin || undefined
    });

    console.log('[Stremio] FFMPEG_BIN:', env.FFMPEG_BIN || '(not set, relying on PATH)');
    console.log('[Stremio] FFPROBE_BIN:', env.FFPROBE_BIN || '(not set, relying on PATH)');

    stremioServer = spawn(runtime, [serverPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        cwd: stremioDir,
        env: env
    });

    stremioServer.stdout.on('data', (data) => {
        console.log('[Stremio Server]', data.toString().trim());
    });

    stremioServer.stderr.on('data', (data) => {
        console.error('[Stremio Server Error]', data.toString().trim());
    });

    stremioServer.on('error', (err) => {
        console.error('[Stremio] Error al iniciar:', err);
    });

    stremioServer.on('exit', (code) => {
        console.log('[Stremio] Server exited with code:', code);
    });
}

function waitForServer(maxRetries = 15) {
    return new Promise((resolve) => {
        let retries = 0;
        const check = () => {
            checkServerRunning().then((running) => {
                if (running) {
                    console.log('[Stremio] Server listo en puerto', STREMIO_PORT);
                    resolve(true);
                } else if (retries < maxRetries) {
                    retries++;
                    console.log(`[Stremio] Esperando servidor... intento ${retries}/${maxRetries}`);
                    setTimeout(check, 1000);
                } else {
                    console.error('[Stremio] Server no respondió después de', maxRetries, 'intentos');
                    resolve(false);
                }
            });
        };
        check();
    });
}

// Activar NVENC (GPU) para transcodificación más rápida
function enableNVENC() {
    const postData = JSON.stringify({ transcodeProfile: 'nvenc-win', transcodeHardwareAccel: true });
    const req = http.request({
        hostname: '127.0.0.1',
        port: STREMIO_PORT,
        path: '/settings',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            console.log('[Stremio] NVENC activado:', data);
        });
    });
    req.on('error', (err) => {
        console.log('[Stremio] No se pudo activar NVENC:', err.message);
    });
    req.write(postData);
    req.end();
}

// --- Inicio de la app ---
app.whenReady().then(async () => {
    console.log('[App] isPackaged:', app.isPackaged);
    console.log('[App] __dirname:', __dirname);
    console.log('[App] LOCALAPPDATA:', process.env.LOCALAPPDATA);

    setupCORSBypass();

    // En producción servimos el build desde un HTTP server local
    if (app.isPackaged) {
        const buildPath = path.join(__dirname, 'build');
        console.log('[App] Build path:', buildPath);
        console.log('[App] Build exists:', fs.existsSync(buildPath));

        const serverStarted = await startLocalServer(buildPath);
        if (!serverStarted) {
            console.error('[App] Falló el servidor UI local, intentando en puerto alternativo...');
        }
    }

    await startStremioServer();
    const serverReady = await waitForServer();
    if (serverReady) {
        enableNVENC(); // Activar transcodificación por GPU (RTX)
    }
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
    if (stremioServer) {
        stremioServer.kill();
        console.log('[App] Motor de Stremio apagado.');
    }
    if (localServer) {
        localServer.close();
    }
});
