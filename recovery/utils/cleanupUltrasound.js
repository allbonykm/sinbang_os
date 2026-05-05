const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/ultrasound.json');
const UPLOAD_DIR = path.join(__dirname, '../public/uploads/ultrasound');

function cleanup() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            console.log('No data file found.');
            return;
        }

        const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const originalLength = db.length;

        const newDb = db.filter(item => {
            const filePath = path.join(UPLOAD_DIR, item.filename);
            const exists = fs.existsSync(filePath);
            if (!exists) {
                console.log(`Removing missing file entry: ${item.filename}`);
            }
            return exists;
        });

        if (originalLength !== newDb.length) {
            fs.writeFileSync(DATA_FILE, JSON.stringify(newDb, null, 2));
            console.log(`Cleanup complete. Removed ${originalLength - newDb.length} missing entries.`);
        } else {
            console.log('No missing files found.');
        }

    } catch (e) {
        console.error('Cleanup failed:', e);
    }
}

cleanup();
