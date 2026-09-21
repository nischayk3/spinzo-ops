const axios = require('axios');

const API_URL = 'http://localhost:8080';
const API_KEY = 'my-secure-key-123';
const INSTANCE_NAME = 'spinzo-marketing-2';

const TEST_PHONE = '919108558715';
const TEST_NAME = 'Nischay';

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

async function sendTest() {
    console.log(`Sending test message to ${TEST_PHONE} (${TEST_NAME}) via ${INSTANCE_NAME}...`);
    const message = getMessage(TEST_NAME);

    try {
        const response = await axios.post(`${API_URL}/message/sendText/${INSTANCE_NAME}`, {
            number: TEST_PHONE,
            options: {
                delay: 1200,
                presence: 'composing',
                linkPreview: false
            },
            text: message
        }, {
            timeout: 15000,
            headers: {
                'apikey': API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ Test Message Sent Successfully!');
        console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('❌ Test Send Failed:', error.response?.data || error.message);
    }
}

sendTest();
