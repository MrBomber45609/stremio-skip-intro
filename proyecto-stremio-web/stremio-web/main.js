const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

let mainWindow;
let stremioServer;
let localServer;

const STREMIO_PORT = 11470;
const LOCAL_UI_PORT = 8081;

// --- Servidor HTTP local para servir el build en producción ---
// Necesario porque el core WASM y Web Workers no funcionan con file://

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
    '.map': 'application/json'
};

function startLocalServer(buildPath) {
    return new Promise((resolve) => {
        localServer = http.createServer((req, res) => {
            let urlPath = req.url.split('?')[0];
            if (urlPath === '/') urlPath = '/index.html';

            const filePath = path.join(buildPath, urlPath);
            const ext = path.extname(filePath);
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    // SPA fallback: si no encuentra el archivo, sirve index.html
                    fs.readFile(path.join(buildPath, 'index.html'), (err2, fallback) => {
                        if (err2) {
                            res.writeHead(404);
                            res.end('Not found');
                        } else {
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(fallback);
                        }
                    });
                } else {
                    res.writeHead(200, { 'Content-Type': contentType });
                    res.end(data);
                }
            });
        });

        localServer.listen(LOCAL_UI_PORT, '127.0.0.1', () => {
            console.log(`Servidor UI local en http://127.0.0.1:${LOCAL_UI_PORT}`);
            resolve();
        });

        localServer.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                // Puerto ya en uso (webpack dev server corriendo), no pasa nada
                console.log(`Puerto ${LOCAL_UI_PORT} ya en uso (probablemente webpack dev server)`);
                resolve();
            } else {
                console.error('Error al iniciar servidor UI local:', err);
                resolve();
            }
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

    // Siempre cargamos desde http:// para que el WASM y Workers funcionen
    mainWindow.loadURL(`http://127.0.0.1:${LOCAL_UI_PORT}`);
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

async function startStremioServer() {
    const alreadyRunning = await checkServerRunning();
    if (alreadyRunning) {
        console.log('Stremio server ya está corriendo en el puerto', STREMIO_PORT);
        return;
    }

    const serverPath = path.join(
        process.env.LOCALAPPDATA,
        'Programs',
        'Stremio',
        'server.js'
    );

    console.log('Encendiendo motor de Stremio en:', serverPath);

    const stremioDir = path.dirname(serverPath);
    const env = Object.assign({}, process.env, {
        PATH: stremioDir + path.delimiter + process.env.PATH
    });

    const runtime = path.join(stremioDir, 'stremio-runtime.exe');

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
        console.error('Error al iniciar el motor:', err);
    });

    stremioServer.on('exit', (code) => {
        console.log('Stremio server exited with code:', code);
    });
}

function waitForServer(maxRetries = 10) {
    return new Promise((resolve) => {
        let retries = 0;
        const check = () => {
            checkServerRunning().then((running) => {
                if (running) {
                    console.log('Stremio server listo en puerto', STREMIO_PORT);
                    resolve(true);
                } else if (retries < maxRetries) {
                    retries++;
                    setTimeout(check, 1000);
                } else {
                    console.error('Stremio server no respondió después de', maxRetries, 'intentos');
                    resolve(false);
                }
            });
        };
        check();
    });
}

// --- Inicio de la app ---

app.whenReady().then(async () => {
    setupCORSBypass();

    // En producción servimos el build desde un HTTP server local
    // En desarrollo, webpack dev server ya está corriendo en el mismo puerto
    if (app.isPackaged) {
        const buildPath = path.join(__dirname, 'build');
        await startLocalServer(buildPath);
    }

    await startStremioServer();
    await waitForServer();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
    if (stremioServer) {
        stremioServer.kill();
        console.log('Motor de Stremio apagado.');
    }
    if (localServer) {
        localServer.close();
    }
});
