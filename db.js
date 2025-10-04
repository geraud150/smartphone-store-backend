const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'Smartphone_Store_DB',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

pool.getConnection()
    .then(connection => {
        console.log('✅ Pool de connexion MySQL créé.');
        connection.release();
    })
    .catch(err => {
        console.error('❌ Erreur de connexion MySQL:', err.message);
    });

module.exports = pool;