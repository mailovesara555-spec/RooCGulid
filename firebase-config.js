// Firebase App configuration
const firebaseConfig = {
  apiKey: "AIzaSyDXhciX3AG7bXsWtRbRd7371UtS8SwR7sU",
  authDomain: "rooc-guild.firebaseapp.com",
  databaseURL: "https://rooc-guild-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "rooc-guild",
  storageBucket: "rooc-guild.firebasestorage.app",
  messagingSenderId: "326463676837",
  appId: "1:326463676837:web:048169408eb182d96c484c",
  measurementId: "G-VR163R8CYD"
};

// Initialize Firebase App
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// ผูกตัวแปร db ไว้กับ window เพื่อให้เข้าถึงได้จากทุกไฟล์
window.db = firebase.database();
