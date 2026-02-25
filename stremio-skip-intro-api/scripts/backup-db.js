#!/usr/bin/env node
// Backup de la base de datos SQLite. Uso: npm run backup o node scripts/backup-db.js
// Para cron: 0 2 * * * cd /ruta/api && node scripts/backup-db.js

const fs = require('fs');
const path = require('path');

require('dotenv').config();
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

const date = new Date();
const suffix = date.toISOString().slice(0, 10) + '-' + [
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
].map(n => String(n).padStart(2, '0')).join('') + '.db';
const backupPath = path.join(BACKUP_DIR, 'database.' + suffix);

try {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    fs.copyFileSync(DB_PATH, backupPath);
    console.log('Backup OK:', backupPath);
} catch (err) {
    console.error('Backup error:', err.message);
    process.exit(1);
}
