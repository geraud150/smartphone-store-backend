const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const db = require('./db');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'votre_cle_secrete_tres_longue_et_securisee'; 

// --- CONFIGURATION DU DOSSIER UPLOADS (Logique Render/Production) ---
// Utilisation de path.resolve pour garantir que le dossier est à la racine du projet
const uploadDir = path.resolve(process.cwd(), 'uploads');

// Création du dossier au démarrage s'il n'existe pas
if (!fs.existsSync(uploadDir)) {
    console.log("📁 Création du dossier uploads...");
    fs.mkdirSync(uploadDir, { recursive: true });
}

// --- MIDDLEWARES ---
app.use(cors()); // Utilisation du module cors standard (plus propre)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rendre le dossier uploads accessible publiquement
app.use('/uploads', express.static(uploadDir));

// --- MIDDLEWARE D'AUTHENTIFICATION ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
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

// --- CONFIGURATION MULTER ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // On vérifie l'existence avant chaque upload
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // Limite à 5 Mo
});

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
        const [rows] = await db.execute('SELECT id_utilisateur, nom_complet, mot_de_passe_hache FROM utilisateurs WHERE email = ?', [email]);
        const user = rows[0];
        if (!user || !(await bcrypt.compare(password, user.mot_de_passe_hache))) {
            return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
        }
        const token = jwt.sign({ id: user.id_utilisateur, name: user.nom_complet }, JWT_SECRET, { expiresIn: '10h' });
        res.json({ token, user: { id: user.id_utilisateur, name: user.nom_complet } });
    } catch (error) {
        res.status(500).json({ message: "Erreur de connexion." });
    }
});

// ----------------------------------------------------
// ROUTES PRODUITS
// ----------------------------------------------------

app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM produits');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Erreur lors du chargement des produits." });
  }
});

app.post('/api/products', authenticateToken, upload.single('productImage'), async (req, res) => {
  try {
    const { nom, prix, description, ram, stockage, batterie, appareil_photo, ecran, categorie } = req.body;
    if (!nom || !prix || !req.file) {
      return res.status(400).json({ message: 'Nom, prix et image obligatoires.' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    const sql = `INSERT INTO produits (nom, prix, url_image, description, ram, stockage, batterie, appareil_photo, ecran, categorie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    await db.execute(sql, [nom, prix, imageUrl, description || null, ram || null, stockage || null, batterie || null, appareil_photo || null, ecran || null, categorie || null]);
    res.status(201).json({ message: 'Produit ajouté avec succès.' });
  } catch (error) {
    console.error("Erreur Ajout Produit:", error);
    res.status(500).json({ message: "Échec de l'ajout du produit." });
  }
});

// ----------------------------------------------------
// ROUTES COMMANDES
// ----------------------------------------------------

app.post('/api/orders', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { items } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ message: "Panier vide." });

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        let total = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price_at_order)), 0);
        const dateCommande = new Date().toISOString().slice(0, 19).replace('T', ' ');

        const [orderResult] = await connection.execute(
            'INSERT INTO commandes (id_utilisateur, date_commande, statut, montant_total) VALUES (?, ?, ?, ?)',
            [userId, dateCommande, 'En attente', total]
        );
        const idCommande = orderResult.insertId;

        const detailQueries = items.map(item => connection.execute(
            'INSERT INTO details_commandes (id_commande, id_produit, quantite, prix_a_la_commande) VALUES (?, ?, ?, ?)',
            [idCommande, item.product_id, item.quantity, item.price_at_order]
        ));
        await Promise.all(detailQueries);
        await connection.commit();

        res.status(201).json({ message: "Commande validée.", orderId: idCommande });
    } catch (error) {
        if (connection) await connection.rollback();
        res.status(500).json({ message: "Erreur lors de la commande." });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const [orders] = await db.execute(`
            SELECT c.id_commande, c.date_commande, c.statut, c.montant_total
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