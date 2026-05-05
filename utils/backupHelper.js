const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

// MariaDB Configuration (from environment or defaults)
const DB_USER = process.env.DB_USER || 'root';
const DB_PASS = process.env.DB_PASS || 'sinbang@100';
const DB_NAME = process.env.DB_NAME || 'sinbang_db';
const DB_PORT = process.env.DB_PORT || '3333';
const MYSQLDUMP_PATH = process.env.MYSQLDUMP_PATH || `"C:\\Program Files\\MariaDB 11.4\\bin\\mariadb-dump.exe"`;

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
            // 0. Skip frequent auto-startup backups (1 hour threshold)
            if (note === 'auto-startup') {
                const backups = fs.readdirSync(BACKUP_DIR);
                const recentAuto = backups.filter(f => f.includes('auto-startup')).sort().reverse()[0];
                if (recentAuto) {
                    const stats = fs.statSync(path.join(BACKUP_DIR, recentAuto));
                    const diffHours = (new Date() - stats.mtime) / (1000 * 60 * 60);
                    if (diffHours < 1) {
                        console.log(`[Backup] Skipping auto-startup backup (Last one was ${Math.round(diffHours * 60)} mins ago)`);
                        return { success: true, skipped: true };
                    }
                }
            }

            const timestamp = getTimestamp();
            const folderName = note ? `${timestamp}_${note}` : timestamp;
            const targetDir = path.join(BACKUP_DIR, folderName);

            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

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

            await new Promise((resolve) => {
                exec(dumpCmd, (error) => {
                    if (error) {
                        console.error(`[Backup] DB Backup Error (Check MYSQLDUMP_PATH in .env):`, error.message);
                        resolve(false);
                    } else {
                        console.log(`[Backup] DB Backup successful: ${path.basename(sqlFile)}`);
                        resolve(true);
                    }
                });
            });

            // 3. Compression (Zip the whole folder)
            const zip = new AdmZip();
            zip.addLocalFolder(targetDir);
            const zipPath = `${targetDir}.zip`;
            zip.writeZip(zipPath);

            // Cleanup the temporary folder
            fs.rmSync(targetDir, { recursive: true, force: true });

            console.log(`[Backup] Full compressed backup created at ${path.basename(zipPath)}`);
            return { success: true, path: zipPath, count };
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

            backups.forEach(file => {
                // Skip the code_backups directory
                if (file === 'code_backups') return;

                const filePath = path.join(BACKUP_DIR, file);
                const stats = fs.statSync(filePath);

                const diffTime = Math.abs(now - stats.mtime);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays > retentionDays) {
                    try {
                        if (stats.isDirectory()) {
                            fs.rmSync(filePath, { recursive: true, force: true });
                        } else {
                            fs.unlinkSync(filePath);
                        }
                        console.log(`[Backup] Deleted old backup: ${file}`);
                        deletedCount++;
                    } catch (e) {
                        console.error(`[Backup] Failed to delete ${file}:`, e.message);
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
                .filter(file => file !== 'code_backups')
                .map(file => {
                    const stats = fs.statSync(path.join(BACKUP_DIR, file));
                    return {
                        name: file,
                        created: stats.mtime,
                        size: stats.size,
                        path: path.join(BACKUP_DIR, file)
                    };
                })
                .sort((a, b) => b.created - a.created);

            return { success: true, list: backups };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Full Code Backup (server.js, routes/, utils/)
    backupCode: () => {
        try {
            const CODE_BACKUP_DIR = path.join(BACKUP_DIR, 'code_backups');
            if (!fs.existsSync(CODE_BACKUP_DIR)) {
                fs.mkdirSync(CODE_BACKUP_DIR, { recursive: true });
            }

            const timestamp = getTimestamp();
            const zipName = `code_backup_${timestamp}.zip`;
            const zipPath = path.join(CODE_BACKUP_DIR, zipName);

            const zip = new AdmZip();
            
            // Add root files
            const rootFiles = ['server.js', 'package.json', '.env', 'prisma/schema.prisma'];
            rootFiles.forEach(file => {
                const fullPath = path.join(__dirname, '..', file);
                if (fs.existsSync(fullPath)) {
                    zip.addLocalFile(fullPath);
                }
            });

            // Add directories
            const dirs = ['routes', 'utils', 'api', 'services', 'config'];
            dirs.forEach(dir => {
                const fullPath = path.join(__dirname, '..', dir);
                if (fs.existsSync(fullPath)) {
                    zip.addLocalFolder(fullPath, dir);
                }
            });

            zip.writeZip(zipPath);
            console.log(`[Backup] Full code backup created: ${zipName}`);
            
            // Cleanup old code backups (Keep last 10)
            const oldCodeBackups = fs.readdirSync(CODE_BACKUP_DIR)
                .map(f => ({ name: f, time: fs.statSync(path.join(CODE_BACKUP_DIR, f)).mtime }))
                .sort((a, b) => b.time - a.time);

            if (oldCodeBackups.length > 10) {
                oldCodeBackups.slice(10).forEach(f => {
                    fs.unlinkSync(path.join(CODE_BACKUP_DIR, f.name));
                    console.log(`[Backup] Removed old code backup: ${f.name}`);
                });
            }

            return { success: true, path: zipPath };
        } catch (error) {
            console.error('[Backup] Failed to backup code:', error);
            return { success: false, error: error.message };
        }
    },

    // Legacy support (redirects to backupCode)
    backupServerFile: () => backupHelper.backupCode(),

    // Backup specific files with timestamp
    backupSpecificFiles: (fileNames = []) => {
        try {
            const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            let count = 0;

            fileNames.forEach(filename => {
                const src = path.join(DATA_DIR, filename);
                if (fs.existsSync(src)) {
                    const dest = path.join(BACKUP_DIR, `${filename.replace('.json', '')}_${timestamp}.json`);
                    fs.copyFileSync(src, dest);
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
