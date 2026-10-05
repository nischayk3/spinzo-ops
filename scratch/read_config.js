const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'spinzo-ops' });
const db = admin.firestore();
db.doc('config/opsStaff').get().then(snap => {
  console.log(JSON.stringify(snap.data(), null, 2));
}).catch(console.error);
