const admin = require('firebase-admin');

let firebaseApp;

const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Railway stores env vars as plain strings, so we replace escaped newlines
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    console.log('✅ Firebase Admin SDK initialised');
  } catch (err) {
    console.error('❌ Firebase init failed:', err.message);
  }

  return firebaseApp;
};

/**
 * Verify a Firebase ID token from the customer app
 * @param {string} idToken
 * @returns {Promise<admin.auth.DecodedIdToken>}
 */
const verifyFirebaseToken = async (idToken) => {
  return admin.auth().verifyIdToken(idToken);
};

/**
 * Send a push notification via Firebase FCM
 */
const sendPushNotification = async ({ token, title, body, data = {} }) => {
  if (!token) return;
  try {
    await admin.messaging().send({
      token,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });
  } catch (err) {
    console.error('FCM send error:', err.message);
  }
};

module.exports = { initFirebase, verifyFirebaseToken, sendPushNotification };
