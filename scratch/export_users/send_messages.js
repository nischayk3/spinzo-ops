const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');

const API_URL = 'http://localhost:8080';
const API_KEY = 'my-secure-key-123';
const INSTANCE_NAME = 'spinzo-marketing-2';

// === PRODUCTION SETTINGS ===
const CSV_FILE = 'users_data.csv'; 
const PROGRESS_FILE = 'progress.json'; // Tracks who has already been messaged
// ===========================

const delay = (ms) => new Promise(res => setTimeout(res, ms));

// Load progress to prevent double-messaging if the script stops and restarts
let progress = {};
if (fs.existsSync(PROGRESS_FILE)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_FILE));
    console.log(`Loaded ${Object.keys(progress).length} already messaged users from progress.json`);
}

const saveProgress = (phone, status = true) => {
    progress[phone] = status;
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
};

const cleanPhone = (phone) => {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) cleaned = '91' + cleaned;
    return cleaned;
};

const getMessage = (name) => {
    let greeting = `Hi! 👋`;
    
    const cleanName = name ? name.trim().toUpperCase() : 'NA';
    
    if (cleanName !== 'NA' && cleanName !== 'N/A' && cleanName !== '') {
        const formattedName = name.trim().charAt(0).toUpperCase() + name.trim().slice(1);
        greeting = `Hi ${formattedName}! 👋`;
    }

    return `${greeting} We noticed it's been a while since you last used SpinZo! 

Since your last order, we’ve completely revamped our process to give your clothes a premium, spa-like treatment. We take the sorting, washing, and folding completely off your plate so you can take your free time back. 🫧🧺

You really have to experience the massive SpinZo upgrade for yourself. 

Tap here to book a quick pickup: https://spinzonow.com 🚀`;
};

async function checkConnection() {
    try {
        const res = await axios.get(`${API_URL}/instance/connectionState/${INSTANCE_NAME}`, {
            headers: { 'apikey': API_KEY },
            timeout: 5000
        });
        return res.data?.instance?.state === 'open';
    } catch (err) {
        return false;
    }
}

async function processUsers() {
    console.log(`Checking WhatsApp connection for ${INSTANCE_NAME}...`);
    const isConnected = await checkConnection();
    if (!isConnected) {
        console.error(`🚨 Evolution API instance "${INSTANCE_NAME}" is NOT connected to WhatsApp. Please verify connection and retry.`);
        process.exit(1);
    }
    console.log(`✅ WhatsApp instance "${INSTANCE_NAME}" is connected and ready!`);

    const users = [];

    fs.createReadStream(CSV_FILE)
        .pipe(csv({ mapHeaders: ({ header }) => header.toLowerCase().trim() }))
        .on('data', (row) => {
            users.push(row);
        })
        .on('end', async () => {
            console.log(`Loaded ${users.length} total users from CSV.`);
            console.log(`Currently messaged: ${Object.values(progress).filter(v => v === true).length} users.`);
            let sentCount = 0;
            let consecutiveErrors = 0;
            
            for (let i = 0; i < users.length; i++) {
                const user = users[i];
                const phoneStr = user.number || '';
                const nameStr = user.name || '';
                
                const phone = cleanPhone(phoneStr);
                
                if (!phone || phone.length < 10) {
                    continue; // Silently skip invalid phones
                }

                // Check if we already processed this person (either successfully or confirmed invalid/unreachable)
                if (progress[phone] !== undefined) {
                    continue;
                }

                const message = getMessage(nameStr);
                console.log(`\n[${i+1}/${users.length}] 🚀 Sending to ${phone} (Name: "${nameStr}")`);
                
                try {
                    await axios.post(`${API_URL}/message/sendText/${INSTANCE_NAME}`, {
                        number: phone,
                        options: {
                            delay: 1200,
                            presence: 'composing',
                            linkPreview: false
                        },
                        text: message
                    }, {
                        timeout: 15000, // 15 seconds timeout
                        headers: {
                            'apikey': API_KEY,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    console.log(`✅ Success!`);
                    saveProgress(phone, true); // Save as true (success)
                    sentCount++;
                    consecutiveErrors = 0;
                    
                    // Random delay between 30 to 60 seconds ONLY on success to avoid bans
                    const waitTime = Math.floor(Math.random() * (60000 - 30000 + 1)) + 30000;
                    console.log(`⏳ Waiting ${Math.round(waitTime / 1000)} seconds before next...`);
                    await delay(waitTime);
                } catch (error) {
                    const errorData = error.response?.data;
                    const errorStr = JSON.stringify(errorData || '');
                    const isRecipientIssue = 
                        error.response?.status === 400 && 
                        (errorData?.response?.message?.[0]?.exists === false || 
                         errorStr.includes('SessionError') || 
                         errorData?.error === 'Bad Request');

                    if (isRecipientIssue) {
                        const reason = errorData?.response?.message?.[0]?.exists === false 
                            ? 'not on WhatsApp' 
                            : (errorData?.response?.message?.[0] || 'invalid/no session');
                        console.warn(`⚠️ Recipient ${phone} skipped: ${reason}`);
                        saveProgress(phone, false);
                        await delay(2000);
                    } else {
                        // Infrastructure / Network / Socket disconnect error
                        console.error(`🚨 Connection error sending to ${phone}:`, errorData?.error || error.message);
                        consecutiveErrors++;

                        if (consecutiveErrors >= 3) {
                            console.error(`🚨 3 consecutive infrastructure errors encountered. Halting campaign safely to prevent list corruption.`);
                            process.exit(1);
                        }

                        console.log(`⏳ Pausing 15 seconds to allow connection recovery...`);
                        await delay(15000);
                        const healthy = await checkConnection();
                        if (!healthy) {
                            console.error(`🚨 WhatsApp connection lost. Halting campaign safely.`);
                            process.exit(1);
                        }
                        // Retry this user
                        i--;
                    }
                }
            }
            console.log(`\n🎉 Campaign completed! Sent ${sentCount} new messages.`);
        });
}

process.on('SIGINT', () => {
    console.log('\n🛑 Campaign gracefully paused by user. Progress is saved.');
    process.exit(0);
});

processUsers();
