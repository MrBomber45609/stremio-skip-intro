require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pino = require('pino');
const sqlite3 = require('sqlite3').verbose();
const { RateLimiterSQLite } = require('rate-limiter-flexible');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const PORT = process.env.PORT || 3710;
const DB_PATH = process.env.DB_PATH || './database.db';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const app = express();

app.use(helmet());
app.use(cors({
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '10kb' }));
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        logger.error({ err: err.message }, 'Error al conectar con la base de datos');
        process.exit(1);
    }
    logger.info('Conectado a la base de datos SQLite');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS intros (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        infohash TEXT,
        imdb_id TEXT,
        season INTEGER,
        episode INTEGER,
        duration INTEGER NOT NULL DEFAULT 0,
        skip_type TEXT DEFAULT 'intro',
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        user_id TEXT,
        votes INTEGER DEFAULT 1
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_infohash ON intros (infohash)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_imdb_ep ON intros (imdb_id, season, episode)`);

    db.run(`SELECT duration FROM intros LIMIT 1`, function (err) {
        if (err) {
            db.run(`ALTER TABLE intros ADD COLUMN duration INTEGER NOT NULL DEFAULT 0`);
            logger.info('BD actualizada: añadida columna duration');
        }
        db.run(`CREATE INDEX IF NOT EXISTS idx_imdb_ep_dur ON intros (imdb_id, season, episode, duration)`);
        db.run(`CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            intro_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            vote_type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(intro_id, user_id)
        )`, (err2) => {
            if (!err2) logger.info('Tablas e índices listos');
        });
    });
});

app.get('/', (req, res) => {
    res.send('¡La API de Skip Intro para Stremio está viva!');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Rate limiters
const rateLimiterPost = new RateLimiterSQLite({
    storeClient: db,
    tableName: 'limite_guardar',
    points: 5, // Límite: 5 peticiones
    duration: 60, // Por cada 60 segundos
}, (err) => {
    if (!err) logger.info('Rate limiter POST activado');
});

const rateLimiterGet = new RateLimiterSQLite({
    storeClient: db,
    tableName: 'limite_pedir',
    points: 60, // Límite: 60 peticiones
    duration: 60, // Por cada 60 segundos
}, (err) => {
    if (!err) logger.info('Rate limiter GET activado');
});

const postLimiter = (req, res, next) => {
    rateLimiterPost.consume(req.ip)
        .then(() => next())
        .catch(() => res.status(429).json({ error: 'Demasiadas intros enviadas. Intentelo de nuevo mas tarde' }));
};

const getLimiter = (req, res, next) => {
    rateLimiterGet.consume(req.ip)
        .then(() => next())
        .catch(() => res.status(429).json({ error: 'Demasiadas peticiones al servidor. Intentelo de nuevo mas tarde.' }));
};


// Routes

// POST /api/intro
app.post('/api/intro', postLimiter, (req, res) => {
    const { infohash, imdb_id, season, episode, duration, skip_type, start_time, end_time, user_id } = req.body;

    if (start_time === undefined || end_time === undefined) {
        return res.status(400).json({ error: 'start_time y end_time son obligatorios.' });
    }

    // Comprobamos que sean números reales y no letras camufladas
    if (typeof start_time !== 'number' || typeof end_time !== 'number') {
        return res.status(400).json({ error: 'Los tiempos deben ser números exactos.' });
    }

    // Lógica básica: el final no puede ser antes que el principio
    if (start_time >= end_time) {
        return res.status(400).json({ error: 'El tiempo de inicio no puede ser mayor o igual al final.' });
    }

    // Anti-troll: rechazar intros absurdamente cortas (<5s) o largas (>300s / 5 min)
    const introDuration = end_time - start_time;
    const isCreditsOnlyStart = skip_type === 'credits' && introDuration >= 1 && introDuration <= 10;
    if (!isCreditsOnlyStart && introDuration < 5) {
        return res.status(400).json({ error: 'La intro es demasiado corta (mínimo 5 segundos).' });
    }
    if (introDuration > 300) {
        return res.status(400).json({ error: 'La intro es demasiado larga (máximo 5 minutos).' });
    }

    // Anti-troll: tiempos negativos o absurdamente grandes
    if (start_time < 0 || end_time < 0) {
        return res.status(400).json({ error: 'Los tiempos no pueden ser negativos.' });
    }
    if (start_time > 36000 || end_time > 36000) {
        return res.status(400).json({ error: 'Los tiempos no pueden superar las 10 horas.' });
    }

    // Validar duration: debe ser un número positivo si se envía
    const safeDuration = (typeof duration === 'number' && duration > 0) ? Math.round(duration) : 0;
    // Fusion: merge with existing intro if similar times
    const FUSION_MARGIN = 3; // segundos de margen para considerar "misma intro"

    // Construimos la query de fusión según los datos disponibles
    let fusionSql, fusionParams;
    if (imdb_id && season !== undefined && episode !== undefined) {
        // Búsqueda por IMDB + temporada + episodio (más universal)
        fusionSql = `SELECT id, start_time, end_time, votes FROM intros
            WHERE imdb_id = ? AND season = ? AND episode = ?
            AND ABS(start_time - ?) <= ? AND ABS(end_time - ?) <= ?
            ORDER BY votes DESC LIMIT 1`;
        fusionParams = [imdb_id, season, episode, start_time, FUSION_MARGIN, end_time, FUSION_MARGIN];
    } else if (infohash) {
        // Fallback: búsqueda por infohash exacto
        fusionSql = `SELECT id, start_time, end_time, votes FROM intros
            WHERE infohash = ?
            AND ABS(start_time - ?) <= ? AND ABS(end_time - ?) <= ?
            ORDER BY votes DESC LIMIT 1`;
        fusionParams = [infohash, start_time, FUSION_MARGIN, end_time, FUSION_MARGIN];
    } else {
        fusionSql = null;
    }

    const doInsert = () => {
        const sql = `INSERT INTO intros (infohash, imdb_id, season, episode, duration, skip_type, start_time, end_time, user_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const params = [infohash, imdb_id, season, episode, safeDuration, skip_type || 'intro', start_time, end_time, user_id];
        db.run(sql, params, function (err) {
            if (err) {
                logger.error({ err: err.message }, 'Error al guardar');
                return res.status(500).json({ error: 'Error interno del servidor' });
            }
            logger.info({ introId: this.lastID, duration: safeDuration }, 'Nueva intro guardada');
            res.status(201).json({ message: '¡Intro guardada con éxito!', id: this.lastID, fused: false });
        });
    };

    if (!fusionSql) {
        doInsert();
        return;
    }

    db.get(fusionSql, fusionParams, (err, existing) => {
        if (err) {
            logger.error({ err: err.message }, 'Error en búsqueda de fusión');
            doInsert(); // Si falla la búsqueda, insertamos de todas formas
            return;
        }

        if (existing) {
            // ¡FUSIÓN! Ya existe una intro con tiempos similares → sumamos voto
            db.run(`UPDATE intros SET votes = votes + 1 WHERE id = ?`, [existing.id], function (err2) {
                if (err2) {
                    logger.error({ err: err2.message }, 'Error en fusión (update)');
                    return res.status(500).json({ error: 'Error interno del servidor' });
                }
                logger.info({ introId: existing.id, votes: existing.votes + 1, start_time, end_time, existingStart: existing.start_time, existingEnd: existing.end_time }, 'Fusión: intro existente +1 voto');
                res.status(200).json({ message: 'Intro fusionada con una existente (+1 voto).', id: existing.id, fused: true, votes: existing.votes + 1 });
            });
        } else {
            // No hay intro similar → insertar nueva
            doInsert();
        }
    });
});

// VENTANILLA 2: PEDIR UNA INTRO (GET) — Solo intro, no créditos. Con fallback IMDB + duration clustering.
// Para intro + créditos usar GET /api/markers/:infohash
app.get('/api/intro/:infohash', getLimiter, (req, res) => {
    const infohash = req.params.infohash;
    const { imdb_id, season, episode, duration } = req.query;

    const sql = `SELECT * FROM intros WHERE infohash = ? AND (skip_type = 'intro' OR skip_type IS NULL) ORDER BY votes DESC LIMIT 1`;

    db.get(sql, [infohash], (err, row) => {
        if (err) {
            logger.error({ err: err.message }, 'Error al buscar intro');
            return res.status(500).json({ error: 'Error interno del servidor' });
        }

        // Caso 1: Match exacto por infohash
        if (row) {
            logger.info({ infohash }, 'Intro enviada (infohash)');
            return res.json({ ...row, match_type: 'infohash' });
        }

        // Caso 2: Fallback por IMDB + Season + Episode (+ Duration Clustering)
        if (imdb_id && season !== undefined && episode !== undefined) {
            const parsedDuration = duration ? parseInt(duration) : null;

            // Si tenemos duración, filtramos por clúster (± 2 segundos)
            if (parsedDuration && parsedDuration > 0) {
                const fallbackSql = `SELECT * FROM intros 
                    WHERE imdb_id = ? AND season = ? AND episode = ? 
                    AND (skip_type = 'intro' OR skip_type IS NULL)
                    AND duration BETWEEN ? AND ?
                    ORDER BY votes DESC LIMIT 1`;
                const durMin = parsedDuration - 2;
                const durMax = parsedDuration + 2;
                db.get(fallbackSql, [imdb_id, parseInt(season), parseInt(episode), durMin, durMax], (err2, fallbackRow) => {
                    if (err2) {
                        logger.error({ err: err2.message }, 'Error búsqueda fallback con duración');
                        return res.status(500).json({ error: 'Error interno del servidor' });
                    }
                    if (!fallbackRow) {
                        // Si no hay match con duración, intentamos sin duración (compatibilidad con intros antiguas sin duration)
                        const fallbackNoDurSql = `SELECT * FROM intros WHERE imdb_id = ? AND season = ? AND episode = ? AND (skip_type = 'intro' OR skip_type IS NULL) ORDER BY votes DESC LIMIT 1`;
                        db.get(fallbackNoDurSql, [imdb_id, parseInt(season), parseInt(episode)], (err3, fallbackRow2) => {
                            if (err3) {
                                logger.error({ err: err3.message }, 'Error búsqueda fallback sin duración');
                                return res.status(500).json({ error: 'Error interno del servidor' });
                            }
                            if (!fallbackRow2) {
                                return res.status(404).json({ message: 'No hay intros registradas para este contenido' });
                            }
                            logger.info({ imdb_id, season, episode }, 'Intro enviada por fallback IMDB sin duración');
                            return res.json({ ...fallbackRow2, match_type: 'imdb_no_duration' });
                        });
                        return;
                    }
                    logger.info({ imdb_id, season, episode, duration: parsedDuration }, 'Intro enviada por fallback IMDB+duration');
                    return res.json({ ...fallbackRow, match_type: 'imdb_duration' });
                });
            } else {
                // Sin duración: búsqueda clásica
                const fallbackSql = `SELECT * FROM intros WHERE imdb_id = ? AND season = ? AND episode = ? AND (skip_type = 'intro' OR skip_type IS NULL) ORDER BY votes DESC LIMIT 1`;
                db.get(fallbackSql, [imdb_id, parseInt(season), parseInt(episode)], (err2, fallbackRow) => {
                    if (err2) {
                        logger.error({ err: err2.message }, 'Error búsqueda fallback');
                        return res.status(500).json({ error: 'Error interno del servidor' });
                    }
                    if (!fallbackRow) {
                        return res.status(404).json({ message: 'No hay intros registradas para este contenido' });
                    }
                    logger.info({ imdb_id, season, episode }, 'Intro enviada por fallback IMDB');
                    return res.json({ ...fallbackRow, match_type: 'imdb' });
                });
            }
        } else {
            // Caso 3: Sin match y sin datos de fallback
            return res.status(404).json({ message: 'No hay intros registradas para este archivo' });
        }
    });
});

// VENTANILLA 2B: PEDIR TODOS LOS MARKERS (intro + credits) — GET
app.get('/api/markers/:infohash', getLimiter, (req, res) => {
    const infohash = req.params.infohash;
    const { imdb_id, season, episode, duration } = req.query;
    const parsedDuration = duration ? parseInt(duration) : null;

    // Helper: buscar el mejor marker por tipo
    const findMarker = (skipType, callback) => {
        // Paso 1: infohash exacto
        db.get(`SELECT * FROM intros WHERE infohash = ? AND skip_type = ? ORDER BY votes DESC LIMIT 1`,
            [infohash, skipType], (err, row) => {
                if (err) return callback(err, null);
                if (row) return callback(null, { ...row, match_type: 'infohash' });

                // Paso 2: fallback IMDB
                if (imdb_id && season !== undefined && episode !== undefined) {
                    if (parsedDuration && parsedDuration > 0) {
                        db.get(`SELECT * FROM intros WHERE imdb_id = ? AND season = ? AND episode = ? AND skip_type = ? AND duration BETWEEN ? AND ? ORDER BY votes DESC LIMIT 1`,
                            [imdb_id, parseInt(season), parseInt(episode), skipType, parsedDuration - 2, parsedDuration + 2], (err2, r2) => {
                                if (err2) return callback(err2, null);
                                if (r2) return callback(null, { ...r2, match_type: 'imdb_duration' });
                                // Sin filtro duration
                                db.get(`SELECT * FROM intros WHERE imdb_id = ? AND season = ? AND episode = ? AND skip_type = ? ORDER BY votes DESC LIMIT 1`,
                                    [imdb_id, parseInt(season), parseInt(episode), skipType], (err3, r3) => {
                                        if (err3) return callback(err3, null);
                                        callback(null, r3 ? { ...r3, match_type: 'imdb_no_duration' } : null);
                                    });
                            });
                    } else {
                        db.get(`SELECT * FROM intros WHERE imdb_id = ? AND season = ? AND episode = ? AND skip_type = ? ORDER BY votes DESC LIMIT 1`,
                            [imdb_id, parseInt(season), parseInt(episode), skipType], (err2, r2) => {
                                if (err2) return callback(err2, null);
                                callback(null, r2 ? { ...r2, match_type: 'imdb' } : null);
                            });
                    }
                } else {
                    callback(null, null);
                }
            });
    };

    // Buscar intro y credits en paralelo
    findMarker('intro', (errI, intro) => {
        if (errI) {
            logger.error({ err: errI.message }, 'Error buscando intro');
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        findMarker('credits', (errC, credits) => {
            if (errC) {
                logger.error({ err: errC.message }, 'Error buscando credits');
                return res.status(500).json({ error: 'Error interno del servidor' });
            }
            if (!intro && !credits) {
                return res.status(404).json({ message: 'No hay markers registrados para este contenido' });
            }
            logger.info({ hasIntro: !!intro, hasCredits: !!credits }, 'Markers enviados');
            res.json({ intro: intro || null, credits: credits || null });
        });
    });
});

// POST /api/intro/:id/upvote
app.post('/api/intro/:id/upvote', postLimiter, (req, res) => {
    const introId = parseInt(req.params.id);
    if (isNaN(introId)) {
        return res.status(400).json({ error: 'ID de intro inválido.' });
    }

    const userId = req.body?.user_id;

    if (userId) {
        db.get(`SELECT id FROM votes WHERE intro_id = ? AND user_id = ?`, [introId, userId], (err, existing) => {
            if (err) {
                logger.error({ err: err.message }, 'Error verificando voto duplicado');
            }
            if (existing) {
                return res.status(409).json({ error: 'Ya has votado esta intro.' });
            }
            // INSERT y UPDATE en secuencia: si UPDATE falla, no quedamos con voto huérfano
            db.serialize(() => {
                db.run(`INSERT INTO votes (intro_id, user_id, vote_type, created_at) VALUES (?, ?, 'up', ?)`,
                    [introId, userId, Date.now()], function (err2) {
                        if (err2 && err2.message.includes('UNIQUE')) {
                            return res.status(409).json({ error: 'Ya has votado esta intro.' });
                        }
                        if (err2) {
                            logger.error({ err: err2.message }, 'Error al registrar voto');
                            return res.status(500).json({ error: 'Error interno del servidor' });
                        }
                    });
                db.run(`UPDATE intros SET votes = votes + 1 WHERE id = ?`, [introId], function (err3) {
                    if (err3) {
                        logger.error({ err: err3.message }, 'Error al votar');
                        return res.status(500).json({ error: 'Error interno del servidor' });
                    }
                    if (this.changes === 0) {
                        return res.status(404).json({ error: 'Intro no encontrada.' });
                    }
                    logger.info({ introId, userId }, 'Upvote');
                    res.json({ message: 'Voto positivo registrado.', id: introId });
                });
            });
        });
    } else {
        db.run(`UPDATE intros SET votes = votes + 1 WHERE id = ?`, [introId], function (err) {
            if (err) {
                logger.error({ err: err.message }, 'Error al votar');
                return res.status(500).json({ error: 'Error interno del servidor' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Intro no encontrada.' });
            }
            logger.info({ introId }, 'Upvote (sin user_id)');
            res.json({ message: 'Voto positivo registrado.', id: introId });
        });
    }
});

// VENTANILLA 4: VOTAR NEGATIVO (DOWNVOTE) — Anti-duplicado + Auto-borrado a -5 + secuencia atómica
app.post('/api/intro/:id/downvote', postLimiter, (req, res) => {
    const introId = parseInt(req.params.id);
    if (isNaN(introId)) {
        return res.status(400).json({ error: 'ID de intro inválido.' });
    }

    const userId = req.body?.user_id;

    const doDownvote = () => {
        db.serialize(() => {
            db.run(`UPDATE intros SET votes = votes - 1 WHERE id = ?`, [introId], function (err) {
                if (err) {
                    logger.error({ err: err.message }, 'Error al votar');
                    return res.status(500).json({ error: 'Error interno del servidor' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Intro no encontrada.' });
                }
                db.get(`SELECT votes FROM intros WHERE id = ?`, [introId], (err2, row) => {
                    if (err2) {
                        logger.error({ err: err2.message }, 'Error al comprobar votos');
                        return res.json({ message: 'Voto negativo registrado.', id: introId });
                    }
                    if (row && row.votes <= -5) {
                        db.run(`DELETE FROM votes WHERE intro_id = ?`, [introId]);
                        db.run(`DELETE FROM intros WHERE id = ?`, [introId]);
                        logger.info({ introId }, 'Intro eliminada por -5 votos (troll)');
                        return res.json({ message: 'Intro eliminada por votos negativos.', id: introId, deleted: true });
                    }
                    logger.info({ introId, votes: row.votes }, 'Downvote');
                    res.json({ message: 'Voto negativo registrado.', id: introId, votes: row.votes });
                });
            });
        });
    };

    if (userId) {
        db.get(`SELECT id FROM votes WHERE intro_id = ? AND user_id = ?`, [introId, userId], (err, existing) => {
            if (existing) {
                return res.status(409).json({ error: 'Ya has votado esta intro.' });
            }
            db.run(`INSERT INTO votes (intro_id, user_id, vote_type, created_at) VALUES (?, ?, 'down', ?)`,
                [introId, userId, Date.now()], (err2) => {
                    if (err2 && err2.message.includes('UNIQUE')) {
                        return res.status(409).json({ error: 'Ya has votado esta intro.' });
                    }
                    doDownvote();
                });
        });
    } else {
        doDownvote();
    }
});

// 6. Encendemos el servidor
const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT }, 'Servidor corriendo');
});

// Graceful shutdown
const SHUTDOWN_TIMEOUT_MS = 10000; // 10 s: si la BD no cierra a tiempo, forzar salida

const shutdown = () => {
    logger.info('Señal de apagado recibida');
    const forceExit = () => {
        logger.warn('Timeout de cierre: forzando salida');
        process.exit(1);
    };
    const timeout = setTimeout(forceExit, SHUTDOWN_TIMEOUT_MS);

    server.close(() => {
        db.close((err) => {
            clearTimeout(timeout);
            if (err) {
                logger.error({ err: err.message }, 'Error al cerrar la base de datos');
                process.exit(1);
            }
            logger.info('Base de datos cerrada');
            process.exit(0);
        });
    });
};

process.on('SIGTERM', shutdown); // VPS / Docker / systemd
process.on('SIGINT', shutdown);  // Ctrl+C