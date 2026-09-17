const admin = require('firebase-admin');
const { createObjectCsvWriter } = require('csv-writer');
const serviceAccount = require('/Users/nischaykumar/Downloads/spin-it-a135a-firebase-adminsdk-fbsvc-201c9eb2f9.json');

// Initialize Firebase Admin (Read-Only approach)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function exportUsers() {
  console.log('Fetching users from Firestore...');
  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();

    if (snapshot.empty) {
      console.log('No matching documents found in the users collection.');
      return;
    }

    const records = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      // Extract ONLY name and number/phone as requested
      const name = data.name || data.userName || data.customerName || 'N/A';
      const phone = data.phone || data.phoneNumber || data.customerPhone || 'N/A';
      
      // We push strictly name and phone.
      records.push({ name, phone });
    });

    console.log(`Successfully fetched ${records.length} users. Writing to CSV...`);

    const csvWriter = createObjectCsvWriter({
      path: 'users_data.csv',
      header: [
        { id: 'name', title: 'Name' },
        { id: 'phone', title: 'Number' }
      ]
    });

    await csvWriter.writeRecords(records);
    console.log('Data written to users_data.csv successfully!');

  } catch (error) {
    console.error('Error exporting users:', error);
  } finally {
    // Terminate the app
    admin.app().delete();
  }
}

exportUsers();
