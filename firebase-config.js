// Firebase App (the core Firebase SDK) is always required and must be listed first
// Initialize Firebase
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

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();
