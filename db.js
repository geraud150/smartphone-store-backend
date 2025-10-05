// db.js
// Configuration de la connexion à la base de données via un Pool pour de meilleures performances.

// 1. Charge les variables du fichier .env
require('dotenv').config();

// Nous utilisons le package 'mysql2/promise' pour la gestion moderne des requêtes via des Promises.
const mysql = require('mysql2/promise'); 

// 2. Création du pool de connexions
// Le pool gère un ensemble de connexions prêtes à l'emploi, ce qui est essentiel
// pour les applications web qui reçoivent beaucoup de requêtes simultanées.
const pool = mysql.createPool({
    // Ces valeurs seront lues à partir du fichier .env
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    
    // Configuration SSL/TLS obligatoire pour la connexion sécurisée (Aiven)
    ssl: {
        rejectUnauthorized: false, 
    },

    // Paramètres du Pool
    waitForConnections: true, // Attendre si toutes les connexions sont utilisées
    connectionLimit: 10,      // Nombre maximum de connexions dans le pool
    queueLimit: 0             // Nombre maximum de requêtes en attente (0 = illimité)
});

// 3. Test de la connexion (Vérifie que le pool peut établir au moins une connexion)
pool.getConnection()
    .then(connection => {
        // Si la connexion réussit, la relâcher immédiatement
        connection.release();
        console.log('✅ Pool de connexion MySQL créé et connexion testée avec succès.');
    })
    .catch(err => {
        // Si la connexion échoue (mauvais identifiants, BDD non démarrée, etc.)
        console.error('❌ Erreur critique : Impossible de se connecter à la base de données MySQL. Détails:', err.message);
        // Vous pouvez choisir d'arrêter l'application ici si la BDD est essentielle
        // process.exit(1); 
    });

// 4. Exporte le pool pour qu'il soit utilisable dans les autres fichiers (ex: server.js)
module.exports = pool;

