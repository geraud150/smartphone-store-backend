// Fichier : api/server.js
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const db = require('./db');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'votre_cle_secrete_tres_longue_et_securisee'; 

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*"); 
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization"); 
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// Middleware pour protéger les routes
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.error("Accès refusé: Token manquant ou mal formaté.");
        return res.status(401).json({ message: 'Accès refusé. Veuillez vous connecter.' });
    }

    const token = authHeader.split(' ')[1];
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error("Token invalide ou expiré:", err.message);
            return res.status(403).json({ message: 'Session expirée. Veuillez vous reconnecter.' });
        }
        
        req.user = user; 
        next();
    });
};

// ----------------------------------------------------
// ENDPOINT D'INSCRIPTION
// ----------------------------------------------------
app.post('/api/register', async (req, res) => {
    const { full_name, email, password } = req.body;

    if (!full_name || !email || !password) {
        return res.status(400).json({ message: 'Tous les champs sont requis.' });
    }

    try {
        const [existing] = await db.execute('SELECT email FROM utilisateurs WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(409).json({ message: 'Cet email est déjà enregistré.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const sql = 'INSERT INTO utilisateurs (nom_complet, email, mot_de_passe_hache) VALUES (?, ?, ?)';
        await db.execute(sql, [full_name, email, hashedPassword]);

        res.status(201).json({ message: 'Inscription réussie ! Vous pouvez maintenant vous connecter.' });

    } catch (error) {
        console.error("Erreur d'inscription MySQL:", error);
        res.status(500).json({ message: "Erreur serveur lors de l'inscription." });
    }
});

// ----------------------------------------------------
// ENDPOINT DE CONNEXION
// ----------------------------------------------------
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ message: 'Veuillez saisir votre email et mot de passe.' });
    }

    try {
        const [rows] = await db.execute('SELECT id_utilisateur, nom_complet, mot_de_passe_hache FROM utilisateurs WHERE email = ?', [email]);
        const user = rows[0];

        if (!user) {
            return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
        }

        const match = await bcrypt.compare(password, user.mot_de_passe_hache);

        if (!match) {
            return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
        }

        const token = jwt.sign(
            { id: user.id_utilisateur, name: user.nom_complet }, 
            JWT_SECRET, 
            { expiresIn: '10h' }
        );

        res.json({ 
            message: 'Connexion réussie !', 
            token: token,
            user: { id: user.id_utilisateur, name: user.nom_complet }
        });

    } catch (error) {
        console.error("Erreur de connexion MySQL:", error);
        res.status(500).json({ message: "Erreur serveur lors de la connexion." });
    }
});

// ----------------------------------------------------
// ENDPOINT CATALOGUE PRODUITS
// ----------------------------------------------------
app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM produits');
        res.json(rows);
    } catch (error) {
        console.error("Erreur lors de la récupération des produits:", error);
        res.status(500).json({ message: "Erreur serveur lors du chargement des produits." });
    }
});

// ----------------------------------------------------
// ENDPOINT POUR PASSER UNE COMMANDE
// ----------------------------------------------------
app.post('/api/orders', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { items } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ message: "Le panier est vide ou mal formaté." });
    }

    let connection;

    try {
        connection = await db.getConnection(); 
        await connection.beginTransaction();

        const dateCommande = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const [orderResult] = await connection.execute(
            'INSERT INTO commandes (id_utilisateur, date_commande, statut) VALUES (?, ?, ?)',
            [userId, dateCommande, 'En attente']
        );
        const idCommande = orderResult.insertId;

        const detailQueries = items.map(item => {
            const prixALaCommande = item.price_at_order; 
            const sql = `
                INSERT INTO details_commandes (id_commande, id_produit, quantite, prix_a_la_commande) 
                VALUES (?, ?, ?, ?)
            `;
            return connection.execute(sql, [idCommande, item.product_id, item.quantity, prixALaCommande]);
        });

        await Promise.all(detailQueries);
        
        await connection.commit(); 

        console.log(`✅ Commande #${idCommande} enregistrée pour l'utilisateur #${userId}`);

        res.status(201).json({ 
            message: "Commande enregistrée avec succès dans la base de données.", 
            orderId: idCommande
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error(`❌ Erreur lors de l'enregistrement de la commande (User ID: ${userId}):`, error);
        res.status(500).json({ message: "Erreur serveur : Échec de l'enregistrement de la commande." });

    } finally {
        if (connection) {
             connection.release();
        }
    }
});

// ----------------------------------------------------
// ENDPOINT POUR RÉCUPÉRER LES COMMANDES
// ----------------------------------------------------
app.get('/api/orders', authenticateToken, async (req, res) => {
    const userId = req.user.id; 

    try {
        console.log(`📦 Récupération des commandes pour l'utilisateur #${userId}`);

        // Requête corrigée avec GROUP BY complet
        const [orders] = await db.execute(`
            SELECT 
                c.id_commande,
                c.date_commande,
                c.statut,
                SUM(dc.quantite * dc.prix_a_la_commande) as total_commande
            FROM commandes c
            JOIN details_commandes dc ON c.id_commande = dc.id_commande
            WHERE c.id_utilisateur = ?
            GROUP BY c.id_commande, c.date_commande, c.statut
            ORDER BY c.date_commande DESC
        `, [userId]);

        console.log(`   Nombre de commandes trouvées: ${orders.length}`);

        for (const order of orders) {
            console.log(`   📋 Commande #${order.id_commande} - Statut: "${order.statut}" - Total: ${order.total_commande}€`);

            const [details] = await db.execute(`
                SELECT 
                    dc.quantite,
                    dc.prix_a_la_commande,
                    p.nom as nom_produit,
                    p.url_image
                FROM details_commandes dc
                JOIN produits p ON dc.id_produit = p.id_produit
                WHERE dc.id_commande = ?
            `, [order.id_commande]);
            
            order.details = details;
            order.total_commande = parseFloat(order.total_commande).toFixed(2);
        }

        res.json(orders);

    } catch (error) {
        console.error('❌ Erreur lors de la récupération des commandes:', error);
        res.status(500).json({ 
            message: 'Erreur lors de la récupération des commandes',
            error: error.message 
        });
    }
});
app.delete('/api/user/delete', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        console.log(`🗑️ Tentative de suppression du compte utilisateur #${userId}`);

        // 1. Supprimer les détails de commandes liés
        await connection.execute(
            'DELETE dc FROM details_commandes dc INNER JOIN commandes c ON dc.id_commande = c.id_commande WHERE c.id_utilisateur = ?',
            [userId]
        );

        // 2. Supprimer les commandes
        await connection.execute(
            'DELETE FROM commandes WHERE id_utilisateur = ?',
            [userId]
        );

        // 3. Supprimer l'utilisateur
        await connection.execute(
            'DELETE FROM utilisateurs WHERE id_utilisateur = ?',
            [userId]
        );

        await connection.commit();

        console.log(`✅ Compte utilisateur #${userId} supprimé avec succès`);

        res.json({ 
            message: 'Votre compte a été supprimé avec succès.' 
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error(`❌ Erreur lors de la suppression du compte #${userId}:`, error);
        res.status(500).json({ 
            message: 'Erreur lors de la suppression du compte.',
            error: error.message 
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// ----------------------------------------------------
// Démarrage du Serveur
// ----------------------------------------------------
app.listen(PORT, () => {
    console.log(`✅ Serveur API démarré sur http://localhost:${PORT}/`);
    console.log(`   Endpoints disponibles:`);
    console.log(`   - POST /api/register`);
    console.log(`   - POST /api/login`);
    console.log(`   - GET  /api/products`);
    console.log(`   - POST /api/orders (protégé)`);
    console.log(`   - GET  /api/orders (protégé)`);
    console.log(`   - DELETE /api/user/delete (protégé)`);
});