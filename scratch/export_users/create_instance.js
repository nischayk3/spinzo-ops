const axios = require('axios');
const fs = require('fs');

const API_URL = 'http://localhost:8080';
const API_KEY = 'my-secure-key-123';
const INSTANCE_NAME = 'spinzo-marketing-2';

async function createInstance() {
    try {
        console.log(`Connecting to Evolution API at ${API_URL}...`);
        const response = await axios.post(`${API_URL}/instance/create`, {
            instanceName: INSTANCE_NAME,
            token: "spinzo123",
            qrcode: true,
            integration: "WHATSAPP-BAILEYS"
        }, {
            headers: {
                'apikey': API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log('Instance created successfully!');
        
        // The API returns the base64 string in response.data.qrcode.base64
        const qrBase64 = response.data?.qrcode?.base64 || response.data?.base64;
        
        if (qrBase64) {
            console.log('QR Code received, saving to file...');
            // Remove the data:image/png;base64, prefix if it exists
            const base64Data = qrBase64.replace(/^data:image\/png;base64,/, "");
            fs.writeFileSync('/Users/nischaykumar/.gemini/antigravity-ide/brain/cfc5554d-0662-4372-85ae-478b61ad05fd/qr.png', base64Data, 'base64');
            console.log('QR Code saved as qr.png in the brain directory.');
        } else {
            console.log('No QR code found in response. The instance might already be connected or the API response has changed.', response.data);
            
            // Try fetching connection state to see if we need to fetch QR separately
            const stateRes = await axios.get(`${API_URL}/instance/connectionState/${INSTANCE_NAME}`, {
                headers: { 'apikey': API_KEY }
            });
            console.log('Current state:', stateRes.data);
            
            if (stateRes.data.instance?.state !== 'open') {
                console.log('Fetching QR manually...');
                const connectRes = await axios.get(`${API_URL}/instance/connect/${INSTANCE_NAME}`, {
                    headers: { 'apikey': API_KEY }
                });
                
                const manualQr = connectRes.data?.base64;
                if (manualQr) {
                    const base64Data = manualQr.replace(/^data:image\/png;base64,/, "");
                    fs.writeFileSync('/Users/nischaykumar/.gemini/antigravity-ide/brain/cfc5554d-0662-4372-85ae-478b61ad05fd/qr.png', base64Data, 'base64');
                    console.log('QR Code saved from manual fetch.');
                }
            }
        }
    } catch (error) {
        console.error('Error creating instance:', error.response?.data || error.message);
    }
}

createInstance();
