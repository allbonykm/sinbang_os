const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '../public/uploads/ultrasound');
const DATA_FILE = path.join(__dirname, '../data/ultrasound.json');

// Ensure data directory and file exist
if (!fs.existsSync(path.dirname(DATA_FILE))) fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

// Helper to read/write DB
const getDb = () => {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
};

const saveDb = (data) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

let isWatcherRunning = false;

// Recursive file walker
const getAllFiles = (dirPath, arrayOfFiles) => {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];

    files.forEach((file) => {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else {
            // Keep path relative to UPLOAD_DIR
            const relativePath = path.relative(UPLOAD_DIR, fullPath);
            arrayOfFiles.push(relativePath);
        }
    });

    return arrayOfFiles;
};

const startWatcher = () => {
    if (isWatcherRunning) return;

    if (!fs.existsSync(UPLOAD_DIR)) {
        console.log('[ImageWatcher] Upload directory does not exist, creating:', UPLOAD_DIR);
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    console.log('[ImageWatcher] Starting recursive watch on:', UPLOAD_DIR);
    isWatcherRunning = true;

    let fsWait = false;
    // Recursive watch enabled for Windows
    fs.watch(UPLOAD_DIR, { recursive: true }, (eventType, filename) => {
        if (filename && !fsWait) {
            fsWait = true;
            setTimeout(() => { fsWait = false; }, 1000); // 1 sec debounce

            const filePath = path.join(UPLOAD_DIR, filename);
            if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
                processNewFile(filename);
            }
        }
    });
};

const processNewFile = (relPath) => {
    // Filter non-image/video files or temp files
    if (!relPath.match(/\.(jpg|jpeg|png|bmp|avi|mp4|mov|wmv)$/i)) return;

    // Use forward slashes for URL paths
    const normalizedPath = relPath.replace(/\\/g, '/');
    const filename = path.basename(relPath);

    console.log('[ImageWatcher] New file detected:', normalizedPath);

    const db = getDb();

    // Avoid duplicates by normalized path
    if (db.find(item => item.filename === normalizedPath)) return;

    // Fix: Use unique ID
    const uniqueId = Date.now().toString() + '_' + normalizedPath.replace(/\W/g, '');

    const newItem = {
        id: uniqueId,
        filename: normalizedPath, // Store relative path as "filename" for route compatibility
        path: `/uploads/ultrasound/${normalizedPath}`,
        createdAt: new Date().toISOString(),
        patientName: null,
        chartNo: null,
        isChecked: false
    };

    db.unshift(newItem);
    saveDb(db);
    console.log('[ImageWatcher] Saved to DB:', newItem.id);
};

const initialScan = () => {
    if (!fs.existsSync(UPLOAD_DIR)) return;
    console.log('[ImageWatcher] Performing initial recursive scan...');
    const files = getAllFiles(UPLOAD_DIR);
    const db = getDb();
    let changed = false;

    files.forEach(relPath => {
        if (!relPath.match(/\.(jpg|jpeg|png|bmp|avi|mp4|mov|wmv)$/i)) return;
        const normalizedPath = relPath.replace(/\\/g, '/');

        if (!db.find(item => item.filename === normalizedPath)) {
            const stats = fs.statSync(path.join(UPLOAD_DIR, relPath));
            const uniqueId = stats.birthtimeMs.toFixed(0) + '_' + normalizedPath.replace(/\W/g, '');

            db.unshift({
                id: uniqueId,
                filename: normalizedPath,
                path: `/uploads/ultrasound/${normalizedPath}`,
                createdAt: stats.birthtime.toISOString(),
                patientName: null,
                chartNo: null,
                isChecked: false
            });
            changed = true;
        }
    });

    if (changed) {
        db.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        saveDb(db);
        console.log('[ImageWatcher] Initial scan updated DB.');
    }
};

module.exports = {
    start: () => {
        initialScan();
        startWatcher();

        console.log('[ImageWatcher] Starting recursive polling fallback (5s interval)');
        setInterval(() => {
            if (fs.existsSync(UPLOAD_DIR)) {
                const files = getAllFiles(UPLOAD_DIR);
                let db = getDb();
                let changed = false;

                // 1. Detect New Files
                files.forEach(relPath => {
                    if (!relPath.match(/\.(jpg|jpeg|png|bmp|avi|mp4|mov|wmv)$/i)) return;
                    const normalizedPath = relPath.replace(/\\/g, '/');
                    if (!db.find(item => item.filename === normalizedPath)) {
                        console.log('[ImageWatcher] Polling detected new file:', normalizedPath);
                        processNewFile(relPath);
                        db = getDb(); // Refresh DB after processing
                    }
                });

                // 2. Cleanup Missing Files
                const initialLen = db.length;
                db = db.filter(item => {
                    const filePath = path.join(UPLOAD_DIR, item.filename);
                    return fs.existsSync(filePath);
                });

                if (db.length !== initialLen) {
                    console.log(`[ImageWatcher] Polling cleaned up ${initialLen - db.length} missing files.`);
                    saveDb(db);
                }
            }
        }, 5000);
    }
};
