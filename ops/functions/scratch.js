const admin = require("firebase-admin");
admin.initializeApp({ projectId: "spin-it-a135a" });
const db = admin.firestore();

const targetIds = ["AEX9Q5IWAKNUR8CVNIVH","LLUZFTEYKR5AIIWPFU6N","BEBBLRC5ZRPFDENDXBYH","AZH0G1TBRIMOZWZFYRJJ","X3QQ71YGHSK4OKIES6KB","GDNEKHN1O6OIAJVXCSVG","WPDGLVQAPXVHKLJOVLN7","U5WH48TJOKOTYOWPK7PN","HIZL3P3IDSHR3MWH1NBO","7FBOO6WS5LDHSLVPSDMG","FKMQTQAJJEWA62GPIT7H","Y8ZEGHWNGIUXT6HFMOL7","9VMB6AU9KDXIORIO8UKW","TXNZGOCVENLUPOC6RQRU"];

async function run() {
  const snapshot = await db.collection("ops_delivery_tasks").get();
  snapshot.forEach(doc => {
    const data = doc.data();
    if (targetIds.includes(data.orderId.toUpperCase())) {
      console.log(`Order ID: ${data.orderId}`);
      console.log(`OTP: ${data.deliveryOTP}`);
      console.log("---");
    }
  });
}
run();
