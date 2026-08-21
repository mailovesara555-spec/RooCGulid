require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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
app.get('/auction', (req, res) => {
    res.sendFile(path.join(__dirname, 'auction.html'));
});

// รายชื่อ Discord Username ที่อนุญาตให้เข้าถึง
// (ใช้ชื่อ username ปัจจุบันของ Discord ที่ไม่มี # ตัวเลขแล้ว เช่น 'admin_user')
const ALLOWED_USERS = [
    'admin_user','daffodil2693','amooma_aom',
    'guild_leader',
    'player123'
];

// ให้บริการไฟล์ Static (HTML, CSS, JS) จากโฟลเดอร์ปัจจุบัน
app.use(express.static(__dirname));

// Route: สำหรับกดเข้าสู่ระบบผ่าน Discord
app.get('/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
    // สร้าง URL สำหรับให้ User ไปยืนยันตัวตนที่ Discord
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;
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
        const username = discordUser.username.toLowerCase(); // ชื่อ Username ของ Discord

        // 3. ตรวจสอบว่าชื่อ Username อยู่ในรายชื่ออนุญาตหรือไม่
        if (ALLOWED_USERS.includes(username)) {
            // อนุญาตให้เข้าถึง: ส่งต่อไปยังหน้า Dashboard พร้อมแนบ Discord Username
            res.redirect(`/dashboard.html?user=${encodeURIComponent(discordUser.username)}`);
        } else {
            // ไม่มีสิทธิ์เข้าถึง กลับไปหน้าแรกพร้อมแจ้งเตือน
            res.redirect('/?error=not_allowed');
        }

    } catch (error) {
        console.error('Error during Discord OAuth:', error.message);
        res.redirect('/?error=server_error');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
