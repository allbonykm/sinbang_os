const pool = require('../config/db');

// Helper to format date for JSON compatibility (if needed)
const formatDate = (date) => {
    if (!date) return null;
    return new Date(date).toISOString();
};

module.exports = {
    pool,
    formatDate
};
