const http = require('http');
const axios = require('axios');

const API_URL = 'http://localhost:8080';
const API_KEY = 'my-secure-key-123';
const INSTANCE_NAME = 'spinzo-marketing-2';

const server = http.createServer(async (req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <html>
                <head>
                    <title>SpinZo WhatsApp Connect</title>
                    <meta http-equiv="refresh" content="10">
                </head>
                <body style="text-align: center; font-family: sans-serif; padding-top: 50px; background-color: #f0f2f5;">
                    <h1 style="color: #075E54;">Link SpinZo WhatsApp</h1>
                    <p style="font-size: 18px; color: #555;">Open WhatsApp > Settings > Linked Devices > Link a Device</p>
                    <p style="color: red; font-weight: bold;">(This page automatically refreshes every 10 seconds to keep the QR code alive)</p>
                    <img src="/qr" style="border: 4px solid #075E54; padding: 15px; border-radius: 15px; background: white; margin-top: 20px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />
                </body>
            </html>
        `);
    } else if (req.url === '/qr') {
        try {
            const connectRes = await axios.get(`${API_URL}/instance/connect/${INSTANCE_NAME}`, {
                headers: { 'apikey': API_KEY }
            });
            const base64Str = connectRes.data?.base64;
            if (base64Str) {
                const imgData = Buffer.from(base64Str.replace(/^data:image\/png;base64,/, ""), 'base64');
                res.writeHead(200, { 'Content-Type': 'image/png' });
                res.end(imgData);
            } else {
                // Check if already connected
                const stateRes = await axios.get(`${API_URL}/instance/connectionState/${INSTANCE_NAME}`, {
                    headers: { 'apikey': API_KEY }
                });
                if (stateRes.data.instance?.state === 'open') {
                    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
                    res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="green" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`);
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('Waiting...');
                }
            }
        } catch (error) {
            res.writeHead(500);
            res.end('Error fetching QR');
        }
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(3000, () => {
    console.log('Live QR server running at http://localhost:3000');
});
