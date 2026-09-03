/**
 * ROOC Guild - Discord Announcement & Reminder Engine
 * 
 * 1. กำหนดการ: เริ่มต้นวันอาทิตย์ที่ 6 กันยายน 2026 (06/09/2026) วนรอบละ 2 สัปดาห์ (14 วัน)
 * 2. วันอาทิตย์ (12:00 น.): ประกาศแจ้งเตือนรวม @everyone ให้สมาชิกทุกคนอัปเดตสเตตัส
 * 3. วันจันทร์ - เสาร์ (12:00 น.): ประกาศรายชื่อคนที่ยังไม่อัปโหลดสเตตัส พร้อม @ดิสคอร์ด ในทุกๆ วันตอนเที่ยงวัน จนกว่าจะอัปเดต
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1545110304008962130/WKNATtFB6_4RD97nE1jEDrlmzEHciGIYHGahGxtApIb9iMBl5gXJ8ZVGNc8_gS6NqThm';
const FIREBASE_RTDB_URL = 'https://rooc-guild-default-rtdb.asia-southeast1.firebasedatabase.app';
const ANCHOR_DATE_STR = '2026-09-06T00:00:00+07:00'; // อาทิตย์ที่ 6 ก.ย. 2026

// Helper ดึงเวลา ณ ปัจจุบันในเขตเวลาประเทศไทย (Asia/Bangkok)
function getBangkokDate(dateObj = new Date()) {
    const bkkStr = dateObj.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
    return new Date(bkkStr);
}

// คำนวณข้อมูลรอบ 2 สัปดาห์ (Bi-weekly Cycle)
function getCycleInfo(targetDate = new Date()) {
    const bkkNow = getBangkokDate(targetDate);
    const anchor = new Date(ANCHOR_DATE_STR);
    const bkkAnchor = getBangkokDate(anchor);

    // ปรับเวลาให้เป็น 00:00:00 เพื่อคำนวณจำนวนวัน
    const midnightNow = new Date(bkkNow.getFullYear(), bkkNow.getMonth(), bkkNow.getDate());
    const midnightAnchor = new Date(bkkAnchor.getFullYear(), bkkAnchor.getMonth(), bkkAnchor.getDate());

    const diffMs = midnightNow.getTime() - midnightAnchor.getTime();
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

    let cycleNumber = 1;
    let dayInCycle = 0; // 0 = วันอาทิตย์ต้นรอบ, 1 = จันทร์, ..., 13 = เสาร์ปลายรอบ
    let cycleStartDate;
    let cycleEndDate;

    if (diffDays < 0) {
        // ยังไม่ถึงรอบแรก (ก่อน 6 ก.ย. 2026)
        cycleNumber = 1;
        dayInCycle = diffDays;
        cycleStartDate = new Date(midnightAnchor);
        cycleEndDate = new Date(midnightAnchor.getTime() + (13 * 24 * 60 * 60 * 1000));
    } else {
        cycleNumber = Math.floor(diffDays / 14) + 1;
        dayInCycle = diffDays % 14;
        const startMs = midnightAnchor.getTime() + ((cycleNumber - 1) * 14 * 24 * 60 * 60 * 1000);
        cycleStartDate = new Date(startMs);
        cycleEndDate = new Date(startMs + (13 * 24 * 60 * 60 * 1000));
    }

    const isSundayStart = (dayInCycle === 0);
    const isReminderPeriod = (dayInCycle >= 1 && dayInCycle <= 13);

    return {
        now: bkkNow,
        cycleNumber,
        dayInCycle,
        cycleStartDate,
        cycleEndDate,
        isSundayStart,
        isReminderPeriod,
        cycleStartDateStr: `${cycleStartDate.getDate().toString().padStart(2, '0')}/${(cycleStartDate.getMonth() + 1).toString().padStart(2, '0')}/${cycleStartDate.getFullYear()}`,
        cycleEndDateStr: `${cycleEndDate.getDate().toString().padStart(2, '0')}/${(cycleEndDate.getMonth() + 1).toString().padStart(2, '0')}/${cycleEndDate.getFullYear()}`
    };
}

// แปลงข้อความวันที่ในระบบ (เช่น "25/08/2569 09:00" หรือ ISO) ให้เป็น Date Object
function parseMemberDate(dateStr) {
    if (!dateStr) return null;
    if (typeof dateStr === 'number') return new Date(dateStr);
    
    // ตรวจสอบรูปแบบ DD/MM/YYYY หรือ DD/MM/BE
    const match = String(dateStr).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
    if (match) {
        let d = parseInt(match[1]);
        let m = parseInt(match[2]) - 1;
        let y = parseInt(match[3]);
        if (y > 2500) y -= 543; // แปลง พ.ศ. เป็น ค.ศ.
        let h = match[4] ? parseInt(match[4]) : 0;
        let min = match[5] ? parseInt(match[5]) : 0;
        return new Date(y, m, d, h, min);
    }

    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

// HTTP request helper โดยใช้ Node.js native fetch หรือ https module
async function makeRequest(url, options = {}) {
    if (typeof fetch === 'function') {
        const res = await fetch(url, options);
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${errText}`);
        }
        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const client = parsed.protocol === 'https:' ? https : http;
        const req = client.request(parsed, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        resolve(data);
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

// ดึงข้อมูลสมาชิกและกรองคนที่ยังไม่ได้อัปเดตสเตตัสในรอบปัจจุบัน
async function getMembersUpdateStatus(targetDate = new Date()) {
    const cycle = getCycleInfo(targetDate);
    const membersData = await makeRequest(`${FIREBASE_RTDB_URL}/members.json`);
    const whitelistData = await makeRequest(`${FIREBASE_RTDB_URL}/whitelist.json`).catch(() => ({}));

    if (!membersData) {
        return { cycle, totalMembers: 0, updatedCount: 0, unupdatedMembers: [] };
    }

    const unupdatedMembers = [];
    let updatedCount = 0;
    let totalActiveMembers = 0;

    const memberEntries = Object.entries(membersData);

    for (const [key, m] of memberEntries) {
        // กรองเฉพาะตัวละครหลัก และสมาชิกที่ยังไม่ได้ลากิลด์
        if (!m || m.isChar2) continue;
        if (m.active === false) continue; // ลากิลด์

        totalActiveMembers++;

        const hasStats = m.stats && Object.keys(m.stats).length > 0 && Object.values(m.stats).some(v => Number(v) > 0);
        const lastDate = parseMemberDate(m.lastUpdate);

        // สมาชิกถือว่าอัปเดตแล้วถ้ามีสเตตัส และวันที่อัปเดตอยู่ในรอบปัจจุบัน (หลัง cycleStartDate)
        const isUpdatedThisCycle = hasStats && lastDate && (lastDate.getTime() >= cycle.cycleStartDate.getTime());

        if (isUpdatedThisCycle) {
            updatedCount++;
        } else {
            // ดึง Discord User ID ถ้ามี
            let discordId = m.discordId || null;
            let discordUsername = (m.mainUid || m.discordUser || m.uid || '').trim();

            // ค้นหาใน whitelist เพิ่มเติม
            if (whitelistData && typeof whitelistData === 'object') {
                const wlItem = whitelistData[discordUsername] || whitelistData[discordUsername.replace(/\./g, '__dot__')];
                if (wlItem && wlItem.discordId) {
                    discordId = wlItem.discordId;
                }
            }

            unupdatedMembers.push({
                key,
                name: m.name || 'ไม่ระบุชื่อ',
                charClass: m.charClass || 'ไม่ระบุอาชีพ',
                role: m.role || 'สมาชิกกิลด์',
                discordUsername: discordUsername || 'ไม่ระบุ',
                discordId: discordId,
                lastUpdate: m.lastUpdate || 'ยังไม่เคยอัปเดต'
            });
        }
    }

    return {
        cycle,
        totalMembers: totalActiveMembers,
        updatedCount,
        unupdatedMembers
    };
}

// ส่งข้อความเข้า Discord Webhook
async function postToDiscordWebhook(payload, webhookUrl = DEFAULT_WEBHOOK_URL) {
    if (!webhookUrl) {
        throw new Error('ไม่พบ Discord Webhook URL');
    }

    return makeRequest(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
}

// 1. ส่งประกาศวันอาทิตย์: แจ้งเตือนทุกคน (@everyone)
async function sendSundayAnnouncement(webhookUrl = DEFAULT_WEBHOOK_URL) {
    const cycle = getCycleInfo();

    const payload = {
        content: "@everyone 📢 **[ROOC GUILD ANNOUNCEMENT] แจ้งเตือนอัปเดตสเตตัสประจำรอบ 2 สัปดาห์!**",
        embeds: [
            {
                title: "🛡️ กิลด์ ROOC: รบกวนสมาชิกทุกคนอัปเดตสเตตัสล่าสุด",
                description: `สวัสดีสมาชิกทุกคนครับ! วันนี้เริ่มต้นรอบการประเมินสเตตัสประจำรอบ **${cycle.cycleStartDateStr} - ${cycle.cycleEndDateStr}**\n\nรบกวนสมาชิกทุกคนช่วยเข้าไปอัปโหลดและอัปเดตสเตตัสตัวละครที่หน้าเว็บกิลด์ เพื่อให้ทีมผู้นำนำไปจัดผังปาร์ตี้ **GVG / KVM / PVE** ได้อย่างแม่นยำและเต็มประสิทธิภาพครับ ✨\n\n*(สามารถใช้ระบบ AI สแกนเนอร์อัปโหลดภาพหน้าจอในเกมเพื่อดึงค่าอัตโนมัติได้ทันที สะดวกและรวดเร็วมากครับ)*`,
                color: 0x9333ea, // Deep Purple
                fields: [
                    {
                        name: "📅 รอบประจำวันที่",
                        value: `${cycle.cycleStartDateStr} ถึง ${cycle.cycleEndDateStr}`,
                        inline: true
                    },
                    {
                        name: "⏰ กำหนดส่ง",
                        value: "ภายในวันนี้ก่อนเที่ยงคืน",
                        inline: true
                    },
                    {
                        name: "🌐 เว็บไซต์กิลด์",
                        value: "[คลิกเข้าสู่ระบบเว็บกิลด์](https://rooc-guild.vercel.app/)",
                        inline: false
                    }
                ],
                footer: {
                    text: "ROOC Guild Management System • ระบบแจ้งเตือนอัตโนมัติ",
                    icon_url: "https://raw.githubusercontent.com/daffodil2693/ROOCguild/main/images/classes/lord-knight.webp"
                },
                timestamp: new Date().toISOString()
            }
        ]
    };

    const result = await postToDiscordWebhook(payload, webhookUrl);
    await recordLastSent('SUNDAY_ANNOUNCEMENT');
    return { success: true, type: 'SUNDAY_ANNOUNCEMENT', result };
}

// 2. ส่งประกาศประจำวันตอนเที่ยงวัน: รายชื่อคนที่ยังไม่อัปเดต พร้อม @ดิสคอร์ด
async function sendDailyReminderAnnouncement(webhookUrl = DEFAULT_WEBHOOK_URL) {
    const statusData = await getMembersUpdateStatus();
    const { cycle, totalMembers, updatedCount, unupdatedMembers } = statusData;

    if (unupdatedMembers.length === 0) {
        console.log("🎉 สมาชิกทุกคนอัปเดตสเตตัสครบแล้ว ไม่ส่งข้อความทวง");
        return { success: true, count: 0, message: "สมาชิกทุกคนอัปเดตสเตตัสครบแล้ว" };
    }

    // สร้างข้อความ @ดิสคอร์ด เพื่อให้เกิด Notification
    const mentionList = unupdatedMembers.map(m => {
        if (m.discordId) {
            return `<@${m.discordId}>`;
        } else if (m.discordUsername && m.discordUsername !== 'ไม่ระบุ') {
            return `@${m.discordUsername}`;
        } else {
            return `**${m.name}**`;
        }
    });

    const mentionsContent = `⚠️ **แจ้งเตือนสมาชิกที่ยังไม่ได้อัปเดตสเตตัส (${unupdatedMembers.length}/${totalMembers} ท่าน):**\n${mentionList.join(' ')}`;

    // แบ่งรายการสมาชิกเป็นกลุ่มไม่เกิน 20 คนต่อ Field หรือ Embed
    const memberLines = unupdatedMembers.map((m, idx) => {
        const tag = m.discordId ? `<@${m.discordId}>` : (m.discordUsername ? `@${m.discordUsername}` : '-');
        return `\`${(idx + 1).toString().padStart(2, '0')}.\` **${m.name}** (${m.charClass}) • ${tag}\n└ *อัปเดตล่าสุด: ${m.lastUpdate}*`;
    });

    // แบ่งเป็น Embed Fields
    const fields = [];
    const chunkSize = 12;
    for (let i = 0; i < memberLines.length; i += chunkSize) {
        const chunk = memberLines.slice(i, i + chunkSize);
        fields.push({
            name: `📋 รายชื่อ (กลุ่มที่ ${Math.floor(i / chunkSize) + 1})`,
            value: chunk.join('\n'),
            inline: false
        });
    }

    const payload = {
        content: mentionsContent,
        embeds: [
            {
                title: `⚠️ แจ้งเตือน: สมาชิกที่ยังไม่ได้อัปเดตสเตตัส (${unupdatedMembers.length} คน)`,
                description: `ขณะนี้สมาชิกอัปเดตแล้ว **${updatedCount}/${totalMembers}** ท่าน\nรบกวนสมาชิกที่มีรายชื่อด้านล่างช่วยเข้าไปอัปเดตค่าสเตตัสล่าสุดที่หน้าเว็บด้วยนะครับ เพื่อความพร้อมในการแข่งขันกิลด์ครับ 🙏✨`,
                color: 0xf43f5e, // Rose Red
                fields: [
                    ...fields,
                    {
                        name: "🔗 ช่องทางอัปเดต",
                        value: "[คลิกเข้าสู่ระบบเว็บกิลด์เพื่ออัปเดต](https://rooc-guild.vercel.app/dashboard.html)",
                        inline: false
                    }
                ],
                footer: {
                    text: `รอบวันที่ ${cycle.cycleStartDateStr} - ${cycle.cycleEndDateStr} • เตือนประจำวันเวลา 12:00 น.`,
                    icon_url: "https://raw.githubusercontent.com/daffodil2693/ROOCguild/main/images/classes/high-priest.webp"
                },
                timestamp: new Date().toISOString()
            }
        ]
    };

    const result = await postToDiscordWebhook(payload, webhookUrl);
    await recordLastSent('DAILY_REMINDER', unupdatedMembers.length);
    return { success: true, type: 'DAILY_REMINDER', count: unupdatedMembers.length, result };
}

// บันทึกประวัติการส่งลง Firebase
async function recordLastSent(type, memberCount = 0) {
    try {
        const bkkNow = getBangkokDate();
        const dateKey = `${bkkNow.getFullYear()}-${(bkkNow.getMonth() + 1).toString().padStart(2, '0')}-${bkkNow.getDate().toString().padStart(2, '0')}`;
        const payload = {
            lastSentDate: dateKey,
            lastSentTime: bkkNow.toISOString(),
            lastSentType: type,
            memberCount: memberCount
        };
        await makeRequest(`${FIREBASE_RTDB_URL}/config/discordAnnouncementState.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.warn("บันทึก Announcement State ลง Firebase ล้มเหลว:", e.message);
    }
}

// ตรวจสอบว่าวันนี้ได้ส่งไปแล้วหรือยัง
async function hasSentToday() {
    try {
        const state = await makeRequest(`${FIREBASE_RTDB_URL}/config/discordAnnouncementState.json`);
        if (!state || !state.lastSentDate) return false;
        const bkkNow = getBangkokDate();
        const todayKey = `${bkkNow.getFullYear()}-${(bkkNow.getMonth() + 1).toString().padStart(2, '0')}-${bkkNow.getDate().toString().padStart(2, '0')}`;
        return state.lastSentDate === todayKey;
    } catch {
        return false;
    }
}

// ฟังก์ชันตรวจสอบและรันประกาศอัตโนมัติ (Scheduler Check)
// เรียกทำงานทุกๆ 1 นาที: ถ้าเป็นเวลา 12:00 น. ในประเทศไทย และวันนี้ยังไม่ได้ส่ง -> ส่งประกาศ
async function checkAndTriggerScheduler() {
    const bkkNow = getBangkokDate();
    const hours = bkkNow.getHours();
    const minutes = bkkNow.getMinutes();

    // ทำงานเมื่อถึงเวลา 12:00 ถึง 12:05 น.
    if (hours === 12 && minutes >= 0 && minutes <= 5) {
        const alreadySent = await hasSentToday();
        if (alreadySent) {
            return;
        }

        const cycle = getCycleInfo(bkkNow);

        console.log(`[Discord Scheduler] ตรวจพบเวลา 12:00 น. (รอบที่ ${cycle.cycleNumber}, วันในรอบที่ ${cycle.dayInCycle}) กำลังส่งประกาศ...`);

        if (cycle.isSundayStart) {
            // วันอาทิตย์ต้นรอบ -> ประกาศ @everyone
            console.log("[Discord Scheduler] ส่งประกาศวันอาทิตย์ (@everyone)...");
            await sendSundayAnnouncement();
        } else if (cycle.isReminderPeriod) {
            // วันจันทร์ - เสาร์ -> ประกาศทวงรายชื่อคนที่ยังไม่อัปเดต
            console.log("[Discord Scheduler] ส่งประกาศประจำวันทวงรายชื่อคนยังไม่อัปเดต...");
            await sendDailyReminderAnnouncement();
        }
    }
}

let schedulerTimer = null;

function startScheduler() {
    if (schedulerTimer) return;
    console.log("🚀 เริ่มต้นระบบ Discord Announcement Background Scheduler (ตรวจสอบทุก 1 นาที)");
    // ตรวจสอบรอบแรก
    checkAndTriggerScheduler().catch(err => console.error("Scheduler initial check error:", err));
    // ตรวจสอบทุกๆ 60 วินาที
    schedulerTimer = setInterval(() => {
        checkAndTriggerScheduler().catch(err => console.error("Scheduler check error:", err));
    }, 60 * 1000);
}

function stopScheduler() {
    if (schedulerTimer) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
        console.log("⏹️ หยุดระบบ Discord Announcement Background Scheduler");
    }
}

module.exports = {
    DEFAULT_WEBHOOK_URL,
    getBangkokDate,
    getCycleInfo,
    parseMemberDate,
    getMembersUpdateStatus,
    postToDiscordWebhook,
    sendSundayAnnouncement,
    sendDailyReminderAnnouncement,
    checkAndTriggerScheduler,
    startScheduler,
    stopScheduler
};
