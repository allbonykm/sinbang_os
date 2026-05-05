const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

// MariaDB Configuration (from environment or defaults)
const DB_USER = process.env.DB_USER || 'SINGBANG';
const DB_PASS = process.env.DB_PASS || '1754';
const DB_NAME = process.env.DB_NAME || 'sinbang_db';
const DB_PORT = process.env.DB_PORT || '3333';
const MYSQLDUMP_PATH = `"C:\\Program Files\\MariaDB 11.4\\bin\\mariadb-dump.exe"`;

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

const backupHelper = {
    // Create a backup of all JSON files and the database
    createBackup: async (note = '') => {
        try {
            const timestamp = getTimestamp();
            const folderName = note ? `${timestamp}_${note}` : timestamp;
            const targetDir = path.join(BACKUP_DIR, folderName);

            fs.mkdirSync(targetDir, { recursive: true });

            // 1. JSON Files Backup
            const files = fs.readdirSync(DATA_DIR);
            let count = 0;
            files.forEach(file => {
                if (file.endsWith('.json')) {
                    const srcPath = path.join(DATA_DIR, file);
                    const destPath = path.join(targetDir, file);
                    fs.copyFileSync(srcPath, destPath);
                    count++;
                }
            });

            // 2. Database Backup (MariaDB)
            console.log(`[Backup] Starting MariaDB backup for ${DB_NAME}...`);
            const sqlFile = path.join(targetDir, `${DB_NAME}_backup.sql`);
            const dumpCmd = `${MYSQLDUMP_PATH} -h${process.env.DB_HOST || 'localhost'} -P${DB_PORT} -u${DB_USER} -p${DB_PASS} ${DB_NAME} > "${sqlFile}"`;

            await new Promise((resolve, reject) => {
                exec(dumpCmd, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`[Backup] DB Backup Error:`, error);
                        // We don't fail the whole backup if DB fails, but we log it
                        resolve(false);
                    } else {
                        console.log(`[Backup] DB Backup successful: ${path.basename(sqlFile)}`);
                        resolve(true);
                    }
                });
            });

            console.log(`[Backup] Created full backup at ${folderName} (${count} files + DB)`);
            return { success: true, path: targetDir, count };
        } catch (error) {
            console.error('[Backup] Failed to create backup:', error);
            return { success: false, error: error.message };
        }
    },

    // Delete backups older than retentionDays (default 7)
    cleanOldBackups: (retentionDays = 7) => {
        try {
            const backups = fs.readdirSync(BACKUP_DIR);
            const now = new Date();
            let deletedCount = 0;

            backups.forEach(folder => {
                const folderPath = path.join(BACKUP_DIR, folder);
                const stats = fs.statSync(folderPath);

                if (stats.isDirectory()) {
                    const diffTime = Math.abs(now - stats.mtime);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays > retentionDays) {
                        try {
                            fs.rmSync(folderPath, { recursive: true, force: true });
                            console.log(`[Backup] Deleted old backup: ${folder}`);
                            deletedCount++;
                        } catch (e) {
                            console.error(`[Backup] Failed to delete ${folder}:`, e.message);
                        }
                    }
                }
            });
            return { success: true, deletedCount };
        } catch (error) {
            console.error('[Backup] Failed to clean old backups:', error);
            return { success: false, error: error.message };
        }
    },

    // List all available backups
    listBackups: () => {
        try {
            const backups = fs.readdirSync(BACKUP_DIR)
                .filter(file => {
                    const fullPath = path.join(BACKUP_DIR, file);
                    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
                })
                .map(folder => {
                    const stats = fs.statSync(path.join(BACKUP_DIR, folder));
                    return {
                        name: folder,
                        created: stats.mtime,
                        path: path.join(BACKUP_DIR, folder)
                    };
                })
                .sort((a, b) => b.created - a.created);

            return { success: true, list: backups };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Server file backup (server.js -> Backup/server_backup_YYMMDD.js)
    backupServerFile: () => {
        try {
            const SERVER_BACKUP_DIR = path.join(__dirname, '..', 'Backup');
            if (!fs.existsSync(SERVER_BACKUP_DIR)) {
                fs.mkdirSync(SERVER_BACKUP_DIR, { recursive: true });
            }

            const now = new Date();
            const year = String(now.getFullYear()).slice(2);
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const dateStr = `${year}${month}${day}`;

            const srcPath = path.join(__dirname, '..', 'server.js');
            const destPath = path.join(SERVER_BACKUP_DIR, `server_backup_${dateStr}.js`);

            fs.copyFileSync(srcPath, destPath);
            console.log(`[Backup] Server file backed up to: ${destPath}`);
            return { success: true, path: destPath };
        } catch (error) {
            console.error('[Backup] Failed to backup server.js:', error);
            return { success: false, error: error.message };
        }
    },

    // Backup specific files with timestamp
    backupSpecificFiles: (fileNames = []) => {
        try {
            if (!fs.existsSync(BACKUP_DIR)) {
                fs.mkdirSync(BACKUP_DIR, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            let count = 0;

            fileNames.forEach(filename => {
                const src = path.join(DATA_DIR, filename);
                if (fs.existsSync(src)) {
                    const dest = path.join(BACKUP_DIR, `${filename.replace('.json', '')}_${timestamp}.json`);
                    fs.copyFileSync(src, dest);
                    console.log(`[Backup] Specific file backed up: ${path.basename(dest)}`);
                    count++;
                }
            });
            return { success: true, count };
        } catch (error) {
            console.error('[Backup] Failed to backup specific files:', error);
            return { success: false, error: error.message };
        }
    }
};

module.exports = backupHelper;
