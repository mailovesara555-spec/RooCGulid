require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// รายชื่อ Discord Username ที่อนุญาตให้เข้าถึง
// (ใช้ชื่อ username ปัจจุบันของ Discord ที่ไม่มี # ตัวเลขแล้ว เช่น 'admin_user')
const ALLOWED_USERS = [
    'admin_user',
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

        const userData = userResponse.data;
        const username = userData.username.toLowerCase(); // ชื่อ Username ของ Discord

        // 3. ตรวจสอบว่าชื่อ Username อยู่ในรายชื่ออนุญาตหรือไม่
        if (ALLOWED_USERS.includes(username)) {
            // สำเร็จ! อนุญาตให้เข้าถึง ไปที่หน้า Dashboard
            // หมายเหตุ: ในระบบจริงควรใช้ Session หรือ JWT Cookie เก็บสถานะล็อกอิน
            res.redirect('/dashboard.html?user=' + username);
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
