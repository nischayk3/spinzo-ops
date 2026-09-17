const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');

const API_URL = 'http://localhost:8080';
const API_KEY = 'my-secure-key-123';
const INSTANCE_NAME = 'spinzo-marketing';

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

const saveProgress = (phone) => {
    progress[phone] = true;
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

async function processUsers() {
    const users = [];

    fs.createReadStream(CSV_FILE)
        .pipe(csv({ mapHeaders: ({ header }) => header.toLowerCase().trim() }))
        .on('data', (row) => {
            users.push(row);
        })
        .on('end', async () => {
            console.log(`Loaded ${users.length} total users from CSV.`);
            let sentCount = 0;
            
            for (let i = 0; i < users.length; i++) {
                const user = users[i];
                const phoneStr = user.number || '';
                const nameStr = user.name || '';
                
                const phone = cleanPhone(phoneStr);
                
                if (!phone || phone.length < 10) {
                    continue; // Silently skip invalid phones
                }

                // VERY IMPORTANT: Check if we already messaged this person!
                if (progress[phone]) {
                    console.log(`[${i+1}/${users.length}] ⏭️ Already messaged ${phone}, skipping...`);
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
                        headers: {
                            'apikey': API_KEY,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    console.log(`✅ Success!`);
                    saveProgress(phone); // Save to file immediately so we don't message them again
                    sentCount++;
                } catch (error) {
                    console.error(`❌ Failed to send to ${phone}:`, error.response?.data || error.message);
                }

                // Random delay between 30 to 60 seconds for the production blast to avoid bans
                const waitTime = Math.floor(Math.random() * (60000 - 30000 + 1)) + 30000;
                console.log(`⏳ Waiting ${Math.round(waitTime / 1000)} seconds before next...`);
                await delay(waitTime);
            }
            console.log(`\n🎉 Campaign completed! Sent ${sentCount} new messages.`);
        });
}

processUsers();
