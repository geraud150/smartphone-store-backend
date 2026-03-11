require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const db = require('./db');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET; 
 
// Cache la colonne prix des details pour compatibilite schema
let detailsPriceColumnCache = null;
async function resolveDetailsPriceColumn(executor) {
  if (detailsPriceColumnCache) return detailsPriceColumnCache;

  const [cols] = await executor.execute('SHOW COLUMNS FROM details_commandes');
  const fields = cols.map(c => c.Field);

  if (fields.includes('prix_a_la_commande')) {
    detailsPriceColumnCache = 'prix_a_la_commande';
  } else if (fields.includes('prix_unitaire')) {
    detailsPriceColumnCache = 'prix_unitaire';
  } else {
    detailsPriceColumnCache = null;
  }

  return detailsPriceColumnCache;
}

// --- MIDDLEWARES ---
app.use(cors()); // Utilisation du module cors standard (plus propre)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


// --- MIDDLEWARE D'AUTHENTIFICATION ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Accès refusé. Veuillez vous connecter.' });
    }

    const token = authHeader.split(' ')[1];
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Session expirée. Veuillez vous reconnecter.' });
        }
        req.user = user; 
        next();
    });
};
// --- MIDDLEWARE D'ADMINISTRATEUR ---
const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next(); // L'utilisateur est admin, on continue
    } else {
        return res.status(403).json({ 
            message: "Accès refusé : Droits administrateur requis." 
        });
    }
};
// --- CONFIGURATION CLOUDINARY ---

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configuration du nouveau moteur de stockage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'smartphone_images', // Nom du dossier qui sera créé sur Cloudinary
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
  },
});

const upload = multer({ storage: storage });
// ----------------------------------------------------
// ROUTES UTILISATEURS (INSCRIPTION / CONNEXION)
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
        res.status(201).json({ message: 'Inscription réussie !' });
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de l'inscription." });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [rows] = await db.execute('SELECT id_utilisateur, nom_complet, mot_de_passe_hache, role FROM utilisateurs WHERE email = ?', [email]);
        const user = rows[0];
        if (!user || !(await bcrypt.compare(password, user.mot_de_passe_hache))) {
            return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
        }
        const token = jwt.sign({ id: user.id_utilisateur, name: user.nom_complet, role: user.role }, JWT_SECRET, { expiresIn: '10h' });
        res.json({ token, user: { id: user.id_utilisateur, name: user.nom_complet, role: user.role } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur de connexion." });
    }
});

// ----------------------------------------------------
// ROUTES PRODUITS
// ----------------------------------------------------

app.get('/api/products', async (req, res) => {
  try {
   const [rows] = await db.execute('SELECT * FROM produits WHERE actif = 1 ORDER BY id_produit DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Erreur lors du chargement des produits." });
  }
});

app.get('/api/products/:id', async (req, res) => {
    const productId = req.params.id;
    try {
        const [rows] = await db.execute('SELECT * FROM produits WHERE id_produit = ?', [productId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: "Produit non trouvé" });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error("Erreur récupération produit:", error);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

app.post('/api/products', authenticateToken, isAdmin, upload.single('productImage'), async (req, res) => {
  try {
    const { nom, prix, description, ram, stockage, batterie, appareil_photo, ecran, categorie } = req.body;
    if (!nom || !prix || !req.file) {
      return res.status(400).json({ message: 'Nom, prix et image obligatoires.' });
    }

    const imageUrl = req.file.path;
    const sql = `INSERT INTO produits (nom, prix, url_image, description, ram, stockage, batterie, appareil_photo, ecran, categorie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    await db.execute(sql, [nom, prix, imageUrl, description || null, ram || null, stockage || null, batterie || null, appareil_photo || null, ecran || null, categorie || null]);
    res.status(201).json({ message: 'Produit ajouté avec succès.' });
  } catch (error) {
    console.error("Erreur Ajout Produit:", error);
    res.status(500).json({ message: "Échec de l'ajout du produit." });
  }
});

// ----------------------------------------------------
// ENDPOINT ADMIN : SUPPRIMER UN PRODUIT
// ----------------------------------------------------
// --- ROUTE GESTION (Admin) ---
// Ici, on récupère TOUT (actif = 1 ET actif = 0) pour pouvoir gérer l'inventaire
app.get('/api/admin/products', authenticateToken, isAdmin, async (req, res) => {
  try {
    // Note : On retire le "WHERE actif = 1"
    const [rows] = await db.execute('SELECT * FROM produits ORDER BY id_produit DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Erreur lors du chargement complet des produits." });
  }
});

app.delete('/api/products/:id', authenticateToken, isAdmin, async (req, res) => {
    const productId = req.params.id;

    try {
        // 1. On vérifie si le produit existe et on récupère son image pour la supprimer si nécessaire
        const [rows] = await db.execute('SELECT url_image FROM produits WHERE id_produit = ?', [productId]);
        
        if (rows.length === 0) {
            return res.status(404).json({ message: "Produit non trouvé." });
        }

        // 2. Suppression dans la base de données
        await db.execute('DELETE FROM produits WHERE id_produit = ?', [productId]);

        console.log(`🗑️ Produit #${productId} supprimé par l'admin.`);
        res.json({ message: 'Produit supprimé avec succès !' });

    } catch (error) {
        console.error("Erreur suppression produit:", error);
        res.status(500).json({ message: "Erreur serveur lors de la suppression." });

        // ERREUR DE CLÉ ÉTRANGÈRE (Produit lié à une commande existante)
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
             return res.status(400).json({ 
                error: "Impossible de supprimer : ce produit est présent dans des commandes." 
            });
        }

        return res.status(500).json({ message: "Une erreur interne est survenue lors de la suppression." });
    
    }
});

// ----------------------------------------------------
// ENDPOINT ADMIN : MODIFIER UN PRODUIT
// ----------------------------------------------------
app.put('/api/products/:id', authenticateToken, isAdmin, upload.single('productImage'), async (req, res) => {
    const productId = req.params.id;
    const { nom, prix, description, ram, stockage, batterie, appareil_photo, ecran, categorie } = req.body;
    
    try {
        let sql;
        let params;

        // Si une nouvelle image a été téléchargée
        if (req.file) {
            const imageUrl = req.file.path;
            sql = `
                UPDATE produits 
                SET nom=?, prix=?, url_image=?, description=?, ram=?, stockage=?, batterie=?, appareil_photo=?, ecran=?, categorie=? 
                WHERE id_produit=?
            `;
            params = [nom, prix, imageUrl, description, ram, stockage, batterie, appareil_photo, ecran, categorie, productId];
        } else {
            // Si on ne change pas l'image (on garde l'ancienne url_image)
            sql = `
                UPDATE produits 
                SET nom=?, prix=?, description=?, ram=?, stockage=?, batterie=?, appareil_photo=?, ecran=?, categorie=? 
                WHERE id_produit=?
            `;
            params = [nom, prix, description, ram, stockage, batterie, appareil_photo, ecran, categorie, productId];
        }

        const [result] = await db.execute(sql, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Produit non trouvé ou aucune modification apportée." });
        }

        console.log(`📝 Produit #${productId} mis à jour.`);
        res.json({ message: 'Produit mis à jour avec succès !' });

    } catch (error) {
        console.error("Erreur mise à jour produit:", error);
        res.status(500).json({ message: "Erreur serveur lors de la modification." });
    }
});
// PATCH : Changer le statut (Activer/Archiver) - INDISPENSABLE POUR admin.html
app.patch('/api/products/:id/status', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { actif } = req.body; // Reçoit 0 ou 1
    try {
        await db.execute('UPDATE produits SET actif = ? WHERE id_produit = ?', [actif, id]);
        res.json({ message: actif === 1 ? 'Produit activé' : 'Produit archivé' });
    } catch (error) {
        res.status(500).json({ message: "Erreur lors du changement de statut." });
    }
});
// ----------------------------------------------------
// ROUTES COMMANDES
// ----------------------------------------------------

app.post('/api/orders', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    
    // Extraction des données du corps de la requête
    const { 
        items, 
        prenom, 
        nom, 
        email, 
        adresse_livraison, 
        ville, 
        code_postal, 
        mode_paiement 
    } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ message: "Le panier est vide." });
    }

    let connection;

    try {
        connection = await db.getConnection(); 
        await connection.beginTransaction();

        // 1. Calcul du montant total sécurisé (quantité * prix à la commande)
        const montantTotalCalculé = items.reduce((acc, item) => {
            return acc + (parseFloat(item.price_at_order) * parseInt(item.quantity));
        }, 0);

        // 2. Insertion de la commande avec montant_total et les deux statuts
        const sqlCommande = `
            INSERT INTO commandes (
                id_utilisateur, prenom, nom, email, 
                adresse_livraison, ville, code_postal, 
                montant_total, statut, statut_paiement, 
                mode_paiement, date_commande
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;

        // Paramètres : statut par défaut 'En attente', statut_paiement 'Payé'
        const [orderResult] = await connection.execute(sqlCommande, [
            userId, 
            prenom, 
            nom, 
            email, 
            adresse_livraison, 
            ville, 
            code_postal, 
            montantTotalCalculé, 
            'En attente', // Colonne 'statut'
            'payé',       // Colonne 'statut_paiement'
            mode_paiement
        ]);
        
        const idCommande = orderResult.insertId;

        const priceColumn = await resolveDetailsPriceColumn(connection);
        if (!priceColumn) {
            throw new Error('Colonne prix introuvable dans details_commandes.');
        }

        // 3. Boucle sur les articles pour les détails et la mise à jour des stocks
        for (const item of items) {
            // A. Ajout dans details_commandes
            await connection.execute(
                `INSERT INTO details_commandes (id_commande, id_produit, quantite, ${priceColumn}) VALUES (?, ?, ?, ?)`,

                [idCommande, item.product_id, item.quantity, item.price_at_order]
            );

            // B. Vérification et mise à jour du stock
            const [rows] = await connection.execute('SELECT stock_actuel FROM produits WHERE id_produit = ?', [item.product_id]);
            
            if (rows.length === 0) {
                throw new Error(`Produit introuvable (ID: ${item.product_id})`);
            }

            if (rows[0].stock_actuel < item.quantity) {
                throw new Error(`Stock insuffisant pour le produit ID ${item.product_id}`);
            }

            await connection.execute(
                'UPDATE produits SET stock_actuel = stock_actuel - ? WHERE id_produit = ?',
                [item.quantity, item.product_id]
            );
        }

        // Si tout est ok, on valide la transaction
        await connection.commit(); 

        console.log(`✅ Commande #${idCommande} réussie (Total: ${montantTotalCalculé}€)`);
        res.status(201).json({ 
            message: "Commande enregistrée avec succès !", 
            orderId: idCommande 
        });

    } catch (error) {
    if (connection) await connection.rollback();

    console.error("❌ Erreur lors du passage de commande:", error.message);

    if (error.message && error.message.includes("Stock insuffisant")) {
        return res.status(409).json({
            message: "Stock insuffisant pour certains produits.",
            error: error.message
        });
    }

    res.status(500).json({
        message: "Échec de la commande.",
        error: error.message
    });
} finally {

        if (connection) connection.release();
    }
});
app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const [orders] = await db.execute(`
            SELECT c.id_commande, c.date_commande, c.statut, c.montant_total, c.prenom, c.nom, c.adresse_livraison, c.ville, c.code_postal, c.statut_paiement, c.mode_paiement
            FROM commandes c WHERE c.id_utilisateur = ? ORDER BY c.date_commande DESC
        `, [req.user.id]);

        for (const order of orders) {
            const [details] = await db.execute(`
                SELECT dc.quantite, dc.prix_a_la_commande, p.nom as nom_produit, p.url_image
                FROM details_commandes dc JOIN produits p ON dc.id_produit = p.id_produit
                WHERE dc.id_commande = ?
            `, [order.id_commande]);
            order.details = details;
        }
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: "Erreur récupération commandes." });
    }
});

// 1. Route pour récupérer tous les produits (nécessaire pour l'affichage du tableau)
app.get('/api/products/:id/stock-info', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.execute(
            'SELECT id_produit, nom, stock_actuel, seuil_alerte FROM produits WHERE id_produit = ?',
            [id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: "Produit non trouvé." });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error("Erreur récupération produit spécifique:", error);
        res.status(500).json({ error: "Erreur lors de la récupération du produit." });
    }
});
// Route pour ajouter du stock manuellement (Réapprovisionnement)
app.post('/api/products/:id/add-stock', authenticateToken, isAdmin, async (req, res) => {
    const productId = req.params.id;
    const { quantite } = req.body;
    const adminId = req.user.id;

    if (!quantite || quantite <= 0) {
        return res.status(400).json({ error: "La quantité doit être supérieure à 0." });
    }

    const connection = await db.getConnection(); // Utilisation d'une transaction pour la sécurité
    try {
        await connection.beginTransaction();

        // 1. Enregistrer le mouvement dans l'historique (ENTREE)
        await connection.execute(
            `INSERT INTO mouvements_stock (id_produit, id_utilisateur, type_mouvement, quantite, date_mouvement) 
             VALUES (?, ?, 'ENTREE', ?, NOW())`,
            [productId, adminId , quantite]
        );

        // 2. Mettre à jour le stock_actuel dans la table produits
        await connection.execute(
            `UPDATE produits SET stock_actuel = stock_actuel + ? WHERE id_produit = ?`,
            [quantite, productId]
        );
// Récupérer le nouveau stock pour le renvoyer au front
const [updatedProduct] = await connection.execute(
    'SELECT stock_actuel FROM produits WHERE id_produit = ?',
    [productId]
);

await connection.commit();
res.json({ 
    message: "Stock mis à jour avec succès !", 
    nouveauStock: updatedProduct[0].stock_actuel 
});

    } catch (error) {
        await connection.rollback();
        console.error("Erreur lors du réapprovisionnement:", error);
        res.status(500).json({ error: "Erreur lors de la mise à jour du stock." });
    } finally {
        connection.release();
    }
});

// ----------------------------------------------------
// SUPPRESSION DE COMPTE
// ----------------------------------------------------

app.delete('/api/user/delete', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        await connection.execute('DELETE dc FROM details_commandes dc INNER JOIN commandes c ON dc.id_commande = c.id_commande WHERE c.id_utilisateur = ?', [userId]);
        await connection.execute('DELETE FROM commandes WHERE id_utilisateur = ?', [userId]);
        await connection.execute('DELETE FROM utilisateurs WHERE id_utilisateur = ?', [userId]);
        await connection.commit();
        res.json({ message: 'Compte supprimé.' });
    } catch (error) {
        if (connection) await connection.rollback();
        res.status(500).json({ message: 'Erreur suppression compte.' });
    } finally {
        if (connection) connection.release();
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