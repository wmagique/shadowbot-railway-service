const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration CORS
app.use(cors());
app.use(express.json());

// Configuration de la base de données
const dbConfig = {
    host: process.env.MYSQLHOST || process.env.DB_HOST || 'mysql.railway.internal',
    user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
    password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || 'GImTHJeRg1pSzdHVvgSgxDliQtndjEPd',
    database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'railway',
    port: process.env.MYSQLPORT || process.env.DB_PORT || 3306
};

// Debug: Afficher la configuration (sans le mot de passe)
console.log('🔧 Configuration DB:', {
    host: dbConfig.host,
    user: dbConfig.user,
    database: dbConfig.database,
    port: dbConfig.port
});

// Map pour stocker les bots actifs
const activeBots = new Map();

// Connexion à la base de données
async function getDatabaseConnection() {
    try {
        const connection = await mysql.createConnection(dbConfig);
        
        // Créer les tables si elles n'existent pas
        await createTables(connection);
        
        return connection;
    } catch (error) {
        console.error('❌ Erreur de connexion à la base de données:', error);
        throw error;
    }
}

// Créer les tables nécessaires
async function createTables(connection) {
    try {
        // Table des licences
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS shadowbot_licenses (
                id INT AUTO_INCREMENT PRIMARY KEY,
                discord_id VARCHAR(20) NOT NULL,
                license_type VARCHAR(50) NOT NULL,
                status ENUM('active', 'expired', 'cancelled') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                duration VARCHAR(20) NOT NULL,
                UNIQUE KEY unique_user_license (discord_id, license_type)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        
        // Table des tokens de bots
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS user_bot_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                discord_id VARCHAR(20) NOT NULL,
                license_type VARCHAR(50) NOT NULL,
                bot_token TEXT NOT NULL,
                status ENUM('active', 'inactive') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_user_bot (discord_id, license_type)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        
        console.log('✅ Tables créées/vérifiées avec succès');
        
    } catch (error) {
        console.error('❌ Erreur lors de la création des tables:', error);
    }
}

// Classe pour gérer un bot Discord
class DiscordBot {
    constructor(discordId, licenseType, botToken) {
        this.discordId = discordId;
        this.licenseType = licenseType;
        this.botToken = botToken;
        this.client = null;
        this.isRunning = false;
    }

    async start() {
        try {
            const { Client, GatewayIntentBits } = require('discord.js');
            
            this.client = new Client({
                intents: [
                    GatewayIntentBits.Guilds,
                    GatewayIntentBits.GuildMessages,
                    GatewayIntentBits.GuildMembers,
                    GatewayIntentBits.MessageContent
                ]
            });

            // Événement ready
            this.client.once('ready', () => {
                console.log(`✅ Bot connecté: ${this.client.user.tag} (${this.discordId})`);
                console.log(`📊 Nombre de serveurs: ${this.client.guilds.cache.size}`);
                console.log(`🎯 Licence: ${this.licenseType}`);
                
                this.isRunning = true;
                
                // Envoyer un message de confirmation au propriétaire
                this.sendWelcomeMessage();
            });

            // Commandes de base
            this.client.on('messageCreate', (message) => {
                if (message.author.bot) return;
                
                if (message.content === '!ping') {
                    message.reply('🏓 Pong! Bot actif pour ' + this.discordId);
                }
                
                if (message.content === '!status') {
                    message.reply('✅ Bot en ligne - Licence: ' + this.licenseType);
                }
                
                if (message.content === '!info') {
                    message.reply(`🤖 **ShadowBot**\n👤 Propriétaire: <@${this.discordId}>\n📋 Licence: ${this.licenseType}\n🏠 Serveurs: ${this.client.guilds.cache.size}\n⏰ Démarrage: ${new Date().toLocaleString('fr-FR')}`);
                }
            });

            // Événements de serveur
            this.client.on('guildCreate', (guild) => {
                console.log(`➕ Bot ${this.discordId} rejoint le serveur: ${guild.name}`);
            });

            this.client.on('guildDelete', (guild) => {
                console.log(`➖ Bot ${this.discordId} quitté le serveur: ${guild.name}`);
            });

            // Gestion des erreurs
            this.client.on('error', (error) => {
                console.error(`❌ Erreur bot ${this.discordId}:`, error);
            });

            // Connexion
            await this.client.login(this.botToken);
            
            return true;
            
        } catch (error) {
            console.error(`❌ Erreur lors du démarrage du bot ${this.discordId}:`, error);
            return false;
        }
    }

    async stop() {
        try {
            if (this.client) {
                await this.client.destroy();
                this.client = null;
                this.isRunning = false;
                console.log(`🛑 Bot ${this.discordId} arrêté`);
            }
        } catch (error) {
            console.error(`❌ Erreur lors de l'arrêt du bot ${this.discordId}:`, error);
        }
    }

    async sendWelcomeMessage() {
        try {
            const owner = this.client.users.cache.get(this.discordId);
            if (owner) {
                await owner.send(`🤖 **Votre ShadowBot est maintenant en ligne !**\n📋 Licence: ${this.licenseType}\n🏠 Serveurs: ${this.client.guilds.cache.size}\n\n**Commandes disponibles:**\n• \`!ping\` - Test de connexion\n• \`!status\` - Statut du bot\n• \`!info\` - Informations détaillées\n\nVotre bot est maintenant actif et prêt à être utilisé !`);
            }
        } catch (error) {
            console.log(`Impossible d'envoyer un message au propriétaire ${this.discordId}`);
        }
    }
}

// API Routes

// Route de test
app.get('/', (req, res) => {
    res.json({
        message: '🚀 Service ShadowBot en ligne !',
        bots_actifs: activeBots.size,
        timestamp: new Date().toISOString()
    });
});

// Démarrer un bot
app.post('/api/start-bot', async (req, res) => {
    try {
        const { discord_id, license_type, bot_token, api_key } = req.body;
        
        // Vérification de sécurité
        if (api_key !== process.env.API_SECRET_KEY) {
            return res.status(403).json({ success: false, message: 'Clé API invalide' });
        }
        
        if (!discord_id || !license_type || !bot_token) {
            return res.status(400).json({ success: false, message: 'Paramètres manquants' });
        }
        
        const botKey = `${discord_id}_${license_type}`;
        
        // Vérifier si le bot est déjà en cours d'exécution
        if (activeBots.has(botKey)) {
            return res.json({ success: true, message: 'Bot déjà en cours d\'exécution' });
        }
        
        // Vérifier la licence en base de données
        const connection = await getDatabaseConnection();
        const [licenses] = await connection.execute(
            'SELECT COUNT(*) as count FROM shadowbot_licenses WHERE discord_id = ? AND license_type = ? AND status = "active" AND expires_at > NOW()',
            [discord_id, license_type]
        );
        
        if (licenses[0].count === 0) {
            await connection.end();
            return res.status(400).json({ success: false, message: 'Licence non valide ou expirée' });
        }
        
        // Créer et démarrer le bot
        const bot = new DiscordBot(discord_id, license_type, bot_token);
        const started = await bot.start();
        
        if (started) {
            activeBots.set(botKey, bot);
            
            // Sauvegarder le token en base
            await connection.execute(
                'INSERT INTO user_bot_tokens (discord_id, license_type, bot_token, status) VALUES (?, ?, ?, "active") ON DUPLICATE KEY UPDATE bot_token = VALUES(bot_token), status = "active", updated_at = NOW()',
                [discord_id, license_type, bot_token]
            );
            
            await connection.end();
            
            console.log(`🚀 Bot démarré avec succès: ${discord_id} (${license_type})`);
            res.json({ success: true, message: 'Bot démarré avec succès' });
        } else {
            await connection.end();
            res.status(500).json({ success: false, message: 'Erreur lors du démarrage du bot' });
        }
        
    } catch (error) {
        console.error('❌ Erreur API start-bot:', error);
        res.status(500).json({ success: false, message: 'Erreur interne du serveur' });
    }
});

// Arrêter un bot
app.post('/api/stop-bot', async (req, res) => {
    try {
        const { discord_id, license_type, api_key } = req.body;
        
        if (api_key !== process.env.API_SECRET_KEY) {
            return res.status(403).json({ success: false, message: 'Clé API invalide' });
        }
        
        const botKey = `${discord_id}_${license_type}`;
        const bot = activeBots.get(botKey);
        
        if (bot) {
            await bot.stop();
            activeBots.delete(botKey);
            res.json({ success: true, message: 'Bot arrêté avec succès' });
        } else {
            res.json({ success: false, message: 'Bot non trouvé' });
        }
        
    } catch (error) {
        console.error('❌ Erreur API stop-bot:', error);
        res.status(500).json({ success: false, message: 'Erreur interne du serveur' });
    }
});

// Statut des bots
app.get('/api/bots-status', async (req, res) => {
    try {
        const { api_key } = req.query;
        
        if (api_key !== process.env.API_SECRET_KEY) {
            return res.status(403).json({ success: false, message: 'Clé API invalide' });
        }
        
        const botsStatus = [];
        for (const [key, bot] of activeBots) {
            botsStatus.push({
                key: key,
                discord_id: bot.discordId,
                license_type: bot.licenseType,
                is_running: bot.isRunning,
                guilds_count: bot.client ? bot.client.guilds.cache.size : 0
            });
        }
        
        res.json({
            success: true,
            bots_count: activeBots.size,
            bots: botsStatus
        });
        
    } catch (error) {
        console.error('❌ Erreur API bots-status:', error);
        res.status(500).json({ success: false, message: 'Erreur interne du serveur' });
    }
});

// Vérifier et redémarrer les bots expirés
app.post('/api/check-expired-bots', async (req, res) => {
    try {
        const { api_key } = req.body;
        
        if (api_key !== process.env.API_SECRET_KEY) {
            return res.status(403).json({ success: false, message: 'Clé API invalide' });
        }
        
        const connection = await getDatabaseConnection();
        
        // Récupérer les bots avec des licences expirées
        const [expiredBots] = await connection.execute(`
            SELECT DISTINCT ubt.discord_id, ubt.license_type 
            FROM user_bot_tokens ubt 
            LEFT JOIN shadowbot_licenses sl ON ubt.discord_id = sl.discord_id AND ubt.license_type = sl.license_type 
            WHERE (sl.expires_at IS NULL OR sl.expires_at < NOW()) AND ubt.status = 'active'
        `);
        
        let stoppedCount = 0;
        for (const bot of expiredBots) {
            const botKey = `${bot.discord_id}_${bot.license_type}`;
            const activeBot = activeBots.get(botKey);
            
            if (activeBot) {
                await activeBot.stop();
                activeBots.delete(botKey);
                stoppedCount++;
            }
            
            // Marquer comme inactif en base
            await connection.execute(
                'UPDATE user_bot_tokens SET status = "inactive" WHERE discord_id = ? AND license_type = ?',
                [bot.discord_id, bot.license_type]
            );
        }
        
        await connection.end();
        
        res.json({
            success: true,
            message: `${stoppedCount} bots expirés arrêtés`,
            stopped_count: stoppedCount
        });
        
    } catch (error) {
        console.error('❌ Erreur API check-expired-bots:', error);
        res.status(500).json({ success: false, message: 'Erreur interne du serveur' });
    }
});

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`🚀 Serveur ShadowBot démarré sur le port ${PORT}`);
    console.log(`📊 Service prêt à gérer les bots Discord`);
});

// Gestion de l'arrêt propre
process.on('SIGTERM', async () => {
    console.log('🛑 Arrêt du serveur...');
    
    // Arrêter tous les bots
    for (const [key, bot] of activeBots) {
        await bot.stop();
    }
    
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Arrêt du serveur...');
    
    // Arrêter tous les bots
    for (const [key, bot] of activeBots) {
        await bot.stop();
    }
    
    process.exit(0);
}); 
