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
const DEFAULT_ANCHOR_DATE_STR = '2026-09-06';
const DEFAULT_CYCLE_DAYS = 14;
const DEFAULT_REMINDER_TIME = '12:00';

// Cache การตั้งค่าในหน่วยความจำชั่วคราว
let cachedSettings = null;
let lastSettingsFetchTime = 0;

// ดึงการตั้งค่ารอบจาก Firebase RTDB (/config/discordAnnouncementSettings)
async function getAnnouncementSettings(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedSettings && (now - lastSettingsFetchTime < 30 * 1000)) {
        return cachedSettings;
    }

    try {
        const data = await makeRequest(`${FIREBASE_RTDB_URL}/config/discordAnnouncementSettings.json`);
        if (data && typeof data === 'object') {
            const startDate = data.startDate || DEFAULT_ANCHOR_DATE_STR;
            const cycleDays = Math.max(1, parseInt(data.cycleDays) || DEFAULT_CYCLE_DAYS);
            const reminderTime = data.reminderTime || DEFAULT_REMINDER_TIME;
            
            // คำนวณ endDate หากไม่ได้ระบุ หรือตาม cycleDays
            let endDate = data.endDate;
            if (!endDate) {
                const sDate = new Date(`${startDate}T00:00:00+07:00`);
                if (!isNaN(sDate.getTime())) {
                    const eDate = new Date(sDate.getTime() + ((cycleDays - 1) * 24 * 60 * 60 * 1000));
                    endDate = `${eDate.getFullYear()}-${(eDate.getMonth() + 1).toString().padStart(2, '0')}-${eDate.getDate().toString().padStart(2, '0')}`;
                }
            }

            cachedSettings = {
                startDate,
                endDate,
                cycleDays,
                reminderTime,
                updatedAt: data.updatedAt || null,
                updatedBy: data.updatedBy || null
            };
            lastSettingsFetchTime = now;
            return cachedSettings;
        }
    } catch (err) {
        console.warn('⚠️ ไม่สามารถโหลด discordAnnouncementSettings จาก Firebase ได้:', err.message);
    }

    cachedSettings = {
        startDate: DEFAULT_ANCHOR_DATE_STR,
        endDate: '2026-09-19',
        cycleDays: DEFAULT_CYCLE_DAYS,
        reminderTime: DEFAULT_REMINDER_TIME,
        updatedAt: null,
        updatedBy: 'system'
    };
    lastSettingsFetchTime = now;
    return cachedSettings;
}

// Helper ดึงเวลา ณ ปัจจุบันในเขตเวลาประเทศไทย (Asia/Bangkok)
function getBangkokDate(dateObj = new Date()) {
    const bkkStr = dateObj.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
    return new Date(bkkStr);
}

// คำนวณข้อมูลรอบ (Dynamic Cycle Calculation)
function getCycleInfo(targetDate = new Date(), customSettings = null) {
    const settings = customSettings || cachedSettings || {
        startDate: DEFAULT_ANCHOR_DATE_STR,
        endDate: '2026-09-19',
        cycleDays: DEFAULT_CYCLE_DAYS,
        reminderTime: DEFAULT_REMINDER_TIME
    };

    const bkkNow = getBangkokDate(targetDate);
    const anchorDatePart = (settings.startDate || DEFAULT_ANCHOR_DATE_STR).split('T')[0];
    const anchor = new Date(`${anchorDatePart}T00:00:00+07:00`);
    const bkkAnchor = getBangkokDate(anchor);

    const cycleDays = Math.max(1, parseInt(settings.cycleDays) || DEFAULT_CYCLE_DAYS);

    // ปรับเวลาให้เป็น 00:00:00 เพื่อคำนวณจำนวนวัน
    const midnightNow = new Date(bkkNow.getFullYear(), bkkNow.getMonth(), bkkNow.getDate());
    const midnightAnchor = new Date(bkkAnchor.getFullYear(), bkkAnchor.getMonth(), bkkAnchor.getDate());

    const diffMs = midnightNow.getTime() - midnightAnchor.getTime();
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

    let cycleNumber = 1;
    let dayInCycle = 0; // 0 = วันแรกของรอบ (ประกาศรวม @everyone), 1 ถึง cycleDays - 1 = วันทวงตามรายชื่อ
    let cycleStartDate;
    let cycleEndDate;

    if (diffDays < 0) {
        // ยังไม่ถึงรอบแรก
        cycleNumber = 1;
        dayInCycle = diffDays;
        cycleStartDate = new Date(midnightAnchor);
        cycleEndDate = new Date(midnightAnchor.getTime() + ((cycleDays - 1) * 24 * 60 * 60 * 1000));
    } else {
        cycleNumber = Math.floor(diffDays / cycleDays) + 1;
        dayInCycle = diffDays % cycleDays;
        const startMs = midnightAnchor.getTime() + ((cycleNumber - 1) * cycleDays * 24 * 60 * 60 * 1000);
        cycleStartDate = new Date(startMs);
        cycleEndDate = new Date(startMs + ((cycleDays - 1) * 24 * 60 * 60 * 1000));
    }

    // วันแรกของรอบ: ประกาศแจ้งเตือนทุกคน (@everyone)
    const isStartDay = (dayInCycle === 0);
    // วันถัดๆ ไปในรอบจนถึงวันก่อนเริ่มรอบใหม่: ตามทวงเฉพาะคนที่ยังไม่อัปเดตทุกวัน
    const isReminderPeriod = (dayInCycle >= 1 && dayInCycle < cycleDays);

    const startStr = `${cycleStartDate.getDate().toString().padStart(2, '0')}/${(cycleStartDate.getMonth() + 1).toString().padStart(2, '0')}/${cycleStartDate.getFullYear()}`;
    const endStr = `${cycleEndDate.getDate().toString().padStart(2, '0')}/${(cycleEndDate.getMonth() + 1).toString().padStart(2, '0')}/${cycleEndDate.getFullYear()}`;

    return {
        now: bkkNow,
        settings,
        cycleDays,
        cycleNumber,
        dayInCycle,
        cycleStartDate,
        cycleEndDate,
        isSundayStart: isStartDay, // เข้ากันได้กับโค้ดเดิม
        isStartDay,
        isReminderPeriod,
        cycleStartDateStr: startStr,
        cycleEndDateStr: endStr,
        startStr,
        endStr
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
async function getMembersUpdateStatus(targetDate = new Date(), customSettings = null) {
    const settings = customSettings || await getAnnouncementSettings();
    const cycle = getCycleInfo(targetDate, settings);
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
                lastUpdate: m.lastUpdate || 'ยังไม่เคยอัปเดต',
                hasStats: !!hasStats
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

// 1. ส่งประกาศวันเริ่มต้นรอบ: แจ้งเตือนทุกคน (@everyone)
async function sendSundayAnnouncement(webhookUrl = DEFAULT_WEBHOOK_URL, customSettings = null) {
    const settings = customSettings || await getAnnouncementSettings();
    const cycle = getCycleInfo(new Date(), settings);

    const payload = {
        content: `@everyone 📢 **[ROOC GUILD ANNOUNCEMENT] แจ้งเตือนอัปเดตสเตตัสประจำรอบ (${cycle.cycleStartDateStr} - ${cycle.cycleEndDateStr})!**`,
        allowed_mentions: {
            parse: ['everyone', 'users', 'roles']
        },
        embeds: [
            {
                title: "🛡️ กิลด์ ROOC: รบกวนสมาชิกทุกคนอัปเดตสเตตัสล่าสุด",
                description: `สวัสดีสมาชิกทุกคนครับ! วันนี้เริ่มต้นรอบการประเมินสเตตัสประจำรอบ **${cycle.cycleStartDateStr} - ${cycle.cycleEndDateStr}**\n\nรบกวนสมาชิกทุกคนช่วยเข้าไปอัปโหลดและอัปเดตสเตตัสตัวละครที่หน้าเว็บกิลด์ เพื่อให้ทีมผู้นำนำไปจัดผังปาร์ตี้ **GVG / KVM / PVE** ได้อย่างแม่นยำและเต็มประสิทธิภาพครับ ✨\n\n*(สามารถใช้ระบบ AI สแกนเนอร์อัปโหลดภาพหน้าจอในเกมเพื่อดึงค่าอัตโนมัติได้ทันที สะดวกและรวดเร็วมากครับ)*`,
                color: 0x9333ea, // Deep Purple
                fields: [
                    {
                        name: "📅 รอบประจำวันที่",
                        value: `${cycle.cycleStartDateStr} ถึง ${cycle.cycleEndDateStr} (${cycle.cycleDays} วัน)`,
                        inline: true
                    },
                    {
                        name: "⏰ กำหนดส่ง / การแจ้งเตือน",
                        value: `แจ้งเตือนทวงรายชื่อทุกวันเวลา ${settings.reminderTime || '12:00'} น. จนกว่าจะอัปเดตครบ`,
                        inline: true
                    },
                    {
                        name: "🌐 เว็บไซต์กิลด์",
                        value: "[คลิกเข้าสู่ระบบเว็บกิลด์](https://roocguild.xyz/)",
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
    await recordLastSent('START_CYCLE_ANNOUNCEMENT');
    return { success: true, type: 'START_CYCLE_ANNOUNCEMENT', result };
}

// 2. ส่งประกาศประจำวันตามเวลาที่ตั้งไว้: รายชื่อคนที่ยังไม่อัปเดต พร้อม @ดิสคอร์ด
async function sendDailyReminderAnnouncement(webhookUrl = DEFAULT_WEBHOOK_URL, customSettings = null) {
    const settings = customSettings || await getAnnouncementSettings();
    const statusData = await getMembersUpdateStatus(new Date(), settings);
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
        let noteText = '';
        if (!m.hasStats) {
            noteText = (m.lastUpdate && m.lastUpdate !== 'ยังไม่เคยอัปเดต')
                ? `❌ ยังไม่มีข้อมูลสเตตัสในระบบ (บันทึกเฉพาะโปรไฟล์: ${m.lastUpdate})`
                : `❌ ยังไม่เคยกรอกสเตตัสในระบบ`;
        } else {
            noteText = `อัปเดตล่าสุด: ${m.lastUpdate}`;
        }
        return `\`${(idx + 1).toString().padStart(2, '0')}.\` **${m.name}** (${m.charClass}) • ${tag}\n└ *${noteText}*`;
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
        allowed_mentions: {
            parse: ['users', 'roles', 'everyone']
        },
        embeds: [
            {
                title: `⚠️ แจ้งเตือน: สมาชิกที่ยังไม่ได้อัปเดตสเตตัส (${unupdatedMembers.length} คน)`,
                description: `ขณะนี้สมาชิกอัปเดตแล้ว **${updatedCount}/${totalMembers}** ท่าน\nรบกวนสมาชิกที่มีรายชื่อด้านล่างช่วยเข้าไปอัปเดตค่าสเตตัสล่าสุดที่หน้าเว็บด้วยนะครับ เพื่อความพร้อมในการแข่งขันกิลด์ครับ 🙏✨`,
                color: 0xf43f5e, // Rose Red
                fields: [
                    ...fields,
                    {
                        name: "🔗 ช่องทางอัปเดต",
                        value: "[คลิกเข้าสู่ระบบเว็บกิลด์เพื่ออัปเดต](https://roocguild.xyz/dashboard.html)",
                        inline: false
                    }
                ],
                footer: {
                    text: `รอบประจำวันที่ ${cycle.cycleStartDateStr} - ${cycle.cycleEndDateStr} • เตือนประจำวันเวลา ${settings.reminderTime || '12:00'} น.`,
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
// เรียกทำงานทุกๆ 1 นาที: ถ้าตรงกับเวลาที่ตั้งค่าไว้ และวันนี้ยังไม่ได้ส่ง -> ส่งประกาศ
async function checkAndTriggerScheduler() {
    const settings = await getAnnouncementSettings();
    const bkkNow = getBangkokDate();
    const hours = bkkNow.getHours();
    const minutes = bkkNow.getMinutes();

    // ดึงเวลาที่ตั้งไว้ เช่น "12:00"
    const [targetHourStr, targetMinStr] = (settings.reminderTime || '12:00').split(':');
    const targetHour = parseInt(targetHourStr) || 12;
    const targetMin = parseInt(targetMinStr) || 0;

    // ทำงานเมื่อถึงเวลา targetHour:targetMin ถึง +5 นาที
    const isTargetHour = (hours === targetHour);
    const isTargetMin = (minutes >= targetMin && minutes <= targetMin + 5);

    if (isTargetHour && isTargetMin) {
        const alreadySent = await hasSentToday();
        if (alreadySent) {
            return;
        }

        const cycle = getCycleInfo(bkkNow, settings);

        console.log(`[Discord Scheduler] ตรวจพบเวลา ${settings.reminderTime || '12:00'} น. (รอบที่ ${cycle.cycleNumber}, วันในรอบที่ ${cycle.dayInCycle}) กำลังส่งประกาศ...`);

        if (cycle.isStartDay) {
            // วันเริ่มต้นรอบ -> ประกาศ @everyone
            console.log("[Discord Scheduler] ส่งประกาศเริ่มต้นรอบ (@everyone)...");
            await sendSundayAnnouncement(DEFAULT_WEBHOOK_URL, settings);
        } else if (cycle.isReminderPeriod) {
            // วันถัดๆ ไป -> ประกาศทวงรายชื่อคนที่ยังไม่อัปเดต
            console.log("[Discord Scheduler] ส่งประกาศประจำวันทวงรายชื่อคนยังไม่อัปเดต...");
            await sendDailyReminderAnnouncement(DEFAULT_WEBHOOK_URL, settings);
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
    DEFAULT_ANCHOR_DATE_STR,
    DEFAULT_CYCLE_DAYS,
    DEFAULT_REMINDER_TIME,
    getBangkokDate,
    getAnnouncementSettings,
    getCycleInfo,
    parseMemberDate,
    getMembersUpdateStatus,
    postToDiscordWebhook,
    sendSundayAnnouncement,
    sendDailyReminderAnnouncement,
    checkAndTriggerScheduler,
    hasSentToday,
    startScheduler,
    stopScheduler
};
