const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

let mainWindow;
let stremioServer;

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

    // En desarrollo cargamos del webpack dev server, en producción del build local
    const isDev = !app.isPackaged;
    if (isDev) {
        mainWindow.loadURL('http://localhost:8081');
    } else {
        mainWindow.loadFile(path.join(__dirname, 'build', 'index.html'));
    }
}

function setupCORSBypass() {
    // Inyectamos headers CORS en todas las respuestas del servidor de streaming
    // para que el frontend pueda comunicarse sin restricciones
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = Object.assign({}, details.responseHeaders);
        responseHeaders['Access-Control-Allow-Origin'] = ['*'];
        responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
        responseHeaders['Access-Control-Allow-Headers'] = ['Content-Type, Authorization'];
        callback({ responseHeaders });
    });

    // Interceptamos preflight OPTIONS requests
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        callback({ requestHeaders: details.requestHeaders });
    });
}

function checkServerRunning() {
    return new Promise((resolve) => {
        const req = http.get('http://127.0.0.1:11470/settings', (res) => {
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
    // Primero verificamos si ya hay un servidor corriendo
    const alreadyRunning = await checkServerRunning();
    if (alreadyRunning) {
        console.log('Stremio server ya está corriendo en el puerto 11470');
        return;
    }

    // Ruta al motor oficial de Stremio en Windows
    const serverPath = path.join(
        process.env.LOCALAPPDATA,
        'Programs',
        'Stremio',
        'server.js'
    );

    console.log('Encendiendo motor de Stremio en:', serverPath);

    // Añadimos la carpeta de Stremio al PATH para que encuentre ffmpeg/ffprobe
    const stremioDir = path.dirname(serverPath);
    const env = Object.assign({}, process.env, {
        PATH: stremioDir + path.delimiter + process.env.PATH
    });

    // Usamos stremio-runtime.exe (Node v18 empaquetado con Stremio) para compatibilidad
    const runtime = path.join(stremioDir, 'stremio-runtime.exe');

    // Encendemos el motor en segundo plano
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
        console.error('Error al iniciar el motor. ¿Está bien la ruta?', err);
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
                    console.log('Stremio server listo en puerto 11470');
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

app.whenReady().then(async () => {
    setupCORSBypass();
    await startStremioServer();
    await waitForServer();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Matar el motor cuando se cierre la app
app.on('quit', () => {
    if (stremioServer) {
        stremioServer.kill();
        console.log('Motor de Stremio apagado.');
    }
});
