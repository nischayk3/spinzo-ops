
const admin = require('firebase-admin');
const fs = require('fs');

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const targets = ['Lalit', 'Ajay dobliyal', 'Dhaxitha', 'Gary', 'Chaitra Deshpande', 'Osheen', 'Prathyusha', 'Puja Tokdar'];

async function run() {
  try {
    const snapshot = await db.collectionGroup('orders').where('status', '==', 'out_for_delivery').get();
    let found = 0;
    let output = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      targets.forEach(t => {
        if (data.customerName && data.customerName.toLowerCase().includes(t.toLowerCase())) {
          output += `OTP FOUND: ${t} -> ${data.deliveryOTP}
`;
          found++;
        }
      });
    });
    output += `Found total: ${found}
`;
    fs.writeFileSync('out.txt', output);
  } catch (err) {
    fs.writeFileSync('out.txt', err.toString());
  }
}
run().then(() => process.exit(0));

