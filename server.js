const path = require('path');
const fs = require('fs');

try {
    require('dotenv').config();
} catch (e) {
    try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            const lines = fs.readFileSync(envPath, 'utf8').split('\n');
            lines.forEach(l => {
                const trimmed = l.trim();
                if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                    const idx = trimmed.indexOf('=');
                    const k = trimmed.slice(0, idx).trim();
                    const v = trimmed.slice(idx + 1).trim();
                    if (!process.env[k]) process.env[k] = v;
                }
            });
        }
    } catch (err) {}
}

const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
const announcer = require('./discord_announcer');

// เสิร์ฟไฟล์ Static (HTML, CSS, JS) ในโฟลเดอร์ปัจจุบัน
app.use(express.static(path.join(__dirname)));

// Route สำหรับหน้าแรกและหน้าต่างๆ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});
app.get('/members', (req, res) => {
    res.sendFile(path.join(__dirname, 'members.html'));
});
app.get('/party', (req, res) => {
    res.sendFile(path.join(__dirname, 'party.html'));
});
app.get('/auction', (req, res) => {
    res.sendFile(path.join(__dirname, 'auction.html'));
});

// รายชื่อ Discord Username พื้นฐานที่อนุญาตให้เข้าถึง (Fallback)
const crypto = require('crypto');
const AUTH_SECRET = process.env.DISCORD_CLIENT_SECRET || 'rooc_guild_secure_auth_secret_2026';

function generateAuthToken(user) {
    const payload = {
        u: (user.username || '').trim(),
        id: String(user.id || '').trim(),
        t: Date.now()
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
    return `${payloadB64}.${sig}`;
}

function verifyAuthToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
    if (sig !== expectedSig) return null;

    try {
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 วัน
        if (!payload.u || !payload.t || (Date.now() - payload.t > maxAge)) {
            return null;
        }
        return payload;
    } catch(e) {
        return null;
    }
}

// Endpoint สำหรับให้หน้าบ้านตรวจสอบความถูกต้องของ Token
app.get('/auth/verify', (req, res) => {
    const token = req.query.token;
    const verified = verifyAuthToken(token);
    if (verified) {
        return res.json({ valid: true, username: verified.u, id: verified.id });
    }
    return res.status(401).json({ valid: false, error: 'Unauthorized or invalid token' });
});

// รายชื่อ Discord Username พื้นฐานที่อนุญาตให้เข้าถึง (Fallback)
const ALLOWED_USERS = [
    'admin_user',
    'daffodil2693',
    'amooma_aom',
    'zinchess',
    'nestcafe7297',
    'guild_leader',
    'player123'
];

// Route: สำหรับกดเข้าสู่ระบบผ่าน Discord (prompt=consent เพื่อให้ยืนยันผ่าน Discord ทุกรอบ)
app.get('/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
    // prompt=consent บังคับให้ Discord แสดงหน้าต่างยืนยันตัวตนทุกรอบ ป้องกันการสวมรอย
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify&prompt=consent`;
    res.redirect(discordAuthUrl);
});

// Route: Callback ที่ Discord จะส่งข้อมูลกลับมาหลังจาก User กดยืนยัน
app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    
    // ถ้าไม่มี Code กลับมา แปลว่า User กดยกเลิก
    if (!code) {
        return res.redirect('/?error=access_denied');
    }

    try {
        // 1. นำ Code ไปแลกเป็น Access Token
        const params = new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI
        });

        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const accessToken = tokenResponse.data.access_token;

        // 2. ใช้ Access Token เพื่อดึงข้อมูล User
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: {
                authorization: `Bearer ${accessToken}`
            }
        });

        const discordUser = userResponse.data;
        const rawUsername = (discordUser.username || '').trim();
        const username = rawUsername.toLowerCase();
        const globalName = (discordUser.global_name || '').trim().toLowerCase();
        const userId = String(discordUser.id || '').trim();
        const userTag = (discordUser.discriminator && discordUser.discriminator !== '0') ? `${username}#${discordUser.discriminator}` : username;

        const candidateNames = [
            username,
            username.replace(/\./g, ''),
            globalName,
            globalName.replace(/\./g, ''),
            userTag,
            userId
        ].filter(Boolean);

        // 3. ตรวจสอบว่าชื่อ Username อยู่ในรายชื่ออนุญาตหรือไม่ (ตรวจสอบทั้งจาก Firebase Realtime Database และ Fallback)
        let isAllowed = (username === 'daffodil2693') || ALLOWED_USERS.some(u => {
            const cleanAllowed = String(u).trim().toLowerCase();
            return candidateNames.includes(cleanAllowed) || candidateNames.includes(cleanAllowed.replace(/\./g, ''));
        });

        if (!isAllowed) {
            try {
                const fbRes = await axios.get('https://rooc-guild-default-rtdb.asia-southeast1.firebasedatabase.app/whitelist.json');
                const whitelistData = fbRes.data;
                if (whitelistData) {
                    const allowedList = new Set();
                    if (Array.isArray(whitelistData)) {
                        whitelistData.forEach(u => {
                            if (u) {
                                const s = String(u).trim().toLowerCase();
                                allowedList.add(s);
                                allowedList.add(s.replace(/__dot__/g, '.'));
                                allowedList.add(s.replace(/__dot__/g, ''));
                            }
                        });
                    } else if (typeof whitelistData === 'object') {
                        for (let k in whitelistData) {
                            const cleanKey = String(k).trim().toLowerCase();
                            allowedList.add(cleanKey);
                            allowedList.add(cleanKey.replace(/__dot__/g, '.'));
                            allowedList.add(cleanKey.replace(/__dot__/g, ''));

                            const item = whitelistData[k];
                            if (item && item.username) {
                                const cleanU = String(item.username).trim().toLowerCase();
                                allowedList.add(cleanU);
                                allowedList.add(cleanU.replace(/__dot__/g, '.'));
                                allowedList.add(cleanU.replace(/__dot__/g, ''));
                            }
                        }
                    }

                    isAllowed = candidateNames.some(c => allowedList.has(c));
                }
            } catch (fbErr) {
                console.warn('Firebase whitelist check fallback:', fbErr.message);
            }
        }

        if (isAllowed) {
            // สร้าง Cryptographic Signed Token เพื่อความปลอดภัย ป้องกันการเปลี่ยน query param สวมรอย
            const authToken = generateAuthToken(discordUser);
            // ส่งต่อไปยังหน้า Dashboard พร้อม Token และลบการพึ่งพา ?user= แบบลอยๆ
            res.redirect(`/dashboard.html?auth_token=${encodeURIComponent(authToken)}&user=${encodeURIComponent(discordUser.username)}`);
        } else {
            // ไม่มีสิทธิ์เข้าถึง กลับไปหน้าแรกพร้อมระบุ Discord Username ให้ผู้ใช้เห็น
            res.redirect(`/?error=not_allowed&discord_user=${encodeURIComponent(discordUser.username)}&display_name=${encodeURIComponent(discordUser.global_name || '')}`);
        }

    } catch (error) {
        console.error('Error during Discord OAuth:', error.message);
        res.redirect('/?error=server_error');
    }
});

// API: ดึงสถานะรอบและการอัปเดตสเตตัสของสมาชิก
app.get('/api/discord/status', async (req, res) => {
    try {
        const token = req.query.token;
        const verified = verifyAuthToken(token);
        if (!verified) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const status = await announcer.getMembersUpdateStatus();
        res.json({
            success: true,
            status
        });
    } catch (err) {
        console.error('API discord status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// API: สั่งส่งประกาศเข้า Discord ทันที (Manual Trigger)
app.post('/api/discord/announce-now', async (req, res) => {
    try {
        const { token, type, customWebhookUrl } = req.body || {};
        const verified = verifyAuthToken(token);
        if (!verified) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const webhook = customWebhookUrl || process.env.DISCORD_WEBHOOK_URL || announcer.DEFAULT_WEBHOOK_URL;
        let result;

        if (type === 'SUNDAY' || type === 'EVERYONE') {
            result = await announcer.sendSundayAnnouncement(webhook);
        } else {
            result = await announcer.sendDailyReminderAnnouncement(webhook);
        }

        res.json({
            success: true,
            result
        });
    } catch (err) {
        console.error('API discord announce-now error:', err);
        res.status(500).json({ error: err.message });
    }
});

// เริ่มต้นระบบ Background Scheduler ตรวจสอบเวลา 12:00 น. ทุกวัน
announcer.startScheduler();

// Export สำหรับ Vercel Serverless Function
module.exports = app;

if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

