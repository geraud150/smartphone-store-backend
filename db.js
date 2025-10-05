// db.js

// 1. Charge les variables du fichier .env dans process.env
// Cela permet au code d'accéder à DB_HOST, DB_USER, DB_PASSWORD, etc.
require('dotenv').config(); 

const mysql = require('mysql');

// 2. Utilise process.env pour obtenir les identifiants de connexion
// Ces valeurs sont lues depuis le fichier .env (qui n'est JAMAIS commit sur Git).
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  
  // 3. Configuration SSL/TLS obligatoire pour la connexion sécurisée à Aiven
  // 'rejectUnauthorized: true' vérifie que le certificat du serveur est valide.
  // C'est la méthode recommandée pour une connexion sécurisée sans fichier de certificat CA.
  ssl: {
    rejectUnauthorized: true, 
  }
});

// 4. Tente d'établir la connexion
connection.connect((err) => {
  if (err) {
    // Affiche l'erreur en cas d'échec
    console.error('Erreur de connexion à la base de données Aiven : ' + err.stack);
    // Dans un vrai serveur, vous pourriez vouloir arrêter l'application ici
    return;
  }
  // Message de succès
  console.log('Connecté à la base de données Aiven avec succès (ID de thread : ' + connection.threadId + ')');
});

// 5. Exporte l'objet de connexion pour qu'il soit utilisable par d'autres fichiers (comme server.js)
module.exports = connection;
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

