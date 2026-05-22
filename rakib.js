import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, addDoc, onSnapshot, orderBy, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// !!! নিজের ফায়ারবেস তথ্য এখানে দিন !!!
const firebaseConfig = {
    apiKey: "AIzaSyCvW1eM0TD2afTBDWWqmSHksQbm3Esjl2I",
    authDomain: "tradingviews-77.firebaseapp.com",
    projectId: "tradingviews-77",
    storageBucket: "tradingviews-77.firebasestorage.app",
    messagingSenderId: "277785483742",
    appId: "1:277785483742:web:eea123b02bf1d2f987e54f",
    measurementId: "G-BTR2FS9EY5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const provider = new GoogleAuthProvider();

let currentUser = null, activeChatUser = null, isGroupContext = false;
let mediaRecorder = null, audioChunks = [], localStream = null, currentCallId = null;
let chatMessagesUnsubscribe = null, peerConnection = null;

const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// DOM Elements Mapping
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const searchInput = document.getElementById('search-user');
const searchResults = document.getElementById('search-results');
const chatsContainer = document.getElementById('chats-list-container');
const requestsContainer = document.getElementById('requests-list-container');
const feedStream = document.getElementById('feed-stream');
const fullChatView = document.getElementById('fullscreen-chat-view');
const profileViewModal = document.getElementById('user-profile-view-modal');

// --- INSTANT NOTIFICATION TOAST ENGINE ---
function sendInAppNotification(title, message) {
    const container = document.getElementById('notification-toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = "pointer-events-auto bg-slate-900/95 text-white p-3.5 rounded-xl shadow-xl flex flex-col gap-0.5 animate-slide-down border border-gray-700 max-w-sm ml-auto";
    toast.innerHTML = `
        <div class="flex items-center gap-2"><i class="fas fa-bell text-blue-400 text-xs"></i><span class="font-bold text-xs">${title}</span></div>
        <p class="text-[11px] text-gray-300 pl-4 truncate">${message}</p>
    `;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 4000);
}

// --- AUTH PIPELINE MANAGEMENT ---
document.getElementById('btn-login').addEventListener('click', async () => {
    try {
        const res = await signInWithPopup(auth, provider);
        const userRef = doc(db, "users", res.user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
            await setDoc(userRef, {
                uid: res.user.uid,
                displayName: res.user.displayName,
                email: res.user.email.toLowerCase(),
                photoURL: res.user.photoURL,
                friends: [],
                requestsReceived: []
            });
        }
    } catch (err) { alert("Auth error! Please check your Firebase settings."); }
});

document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        authScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        document.getElementById('user-profile-pic').src = user.photoURL;
        document.getElementById('user-display-name').textContent = user.displayName;
        syncLiveAppEngine();
        loadGlobalFeed();
        listenForIncomingCalls();
        listenForGlobalIncomingMessages();
    } else {
        currentUser = null;
        authScreen.classList.remove('hidden');
        appScreen.classList.add('hidden');
    }
});

// --- LAYOUT VIEWS CONTROLLER ---
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        const target = e.currentTarget;
        target.classList.add('active');

        const targetPage = target.getAttribute('data-target');
        document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
        document.getElementById(`page-${targetPage}`).classList.add('active');
        document.getElementById('app-title-text').innerText = targetPage.toUpperCase();
    });
});

// --- INTERACTIVE PROFILE BOX ---
function launchUserProfileView(userData) {
    document.getElementById('view-profile-pic').src = userData.photoURL;
    document.getElementById('view-profile-name').textContent = userData.displayName;
    document.getElementById('view-profile-email').textContent = userData.email;
    document.getElementById('profile-btn-chat').onclick = () => {
        profileViewModal.classList.add('hidden');
        openMessengerInterface(userData, false);
    };
    profileViewModal.classList.remove('hidden');
}
document.getElementById('profile-btn-close').addEventListener('click', () => profileViewModal.classList.add('hidden'));

// --- DISCOVERY LOOKUP SYSTEM ---
searchInput.addEventListener('input', async (e) => {
    const queryVal = e.target.value.trim().toLowerCase();
    if (!queryVal) { searchResults.classList.add('hidden'); return; }

    const q = query(collection(db, "users"), where("email", "==", queryVal));
    const snap = await getDocs(q);
    searchResults.innerHTML = '';

    if (snap.empty) {
        searchResults.innerHTML = `<p class="p-3 text-xs text-gray-400 text-center">No user profiles mapping database</p>`;
    } else {
        snap.forEach(d => {
            const data = d.data();
            if (data.uid === currentUser.uid) return;
            const el = document.createElement('div');
            el.className = "p-3 flex items-center justify-between border-b hover:bg-gray-50";
            el.innerHTML = `
                <div class="flex items-center gap-2 cursor-pointer search-view-profile"><img src="${data.photoURL}" class="w-6 h-6 rounded-full"><span class="text-xs font-bold">${data.displayName}</span></div>
                <button class="bg-blue-600 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg trigger-send-req" data-id="${data.uid}">Connect</button>
            `;
            el.querySelector('.search-view-profile').onclick = () => launchUserProfileView(data);
            searchResults.appendChild(el);
        });
    }
    searchResults.classList.remove('hidden');
});

document.body.addEventListener('click', async (e) => {
    if (e.target.classList.contains('trigger-send-req')) {
        const targetId = e.target.getAttribute('data-id');
        await updateDoc(doc(db, "users", targetId), { requestsReceived: arrayUnion(currentUser.uid) });
        e.target.innerText = "Sent";
        e.target.disabled = true;
    }
});

// --- ARCHITECTURE LIVE DATA SYNC ---
function syncLiveAppEngine() {
    onSnapshot(doc(db, "users", currentUser.uid), (snap) => {
        const uData = snap.data();
        if (!uData) return;

        chatsContainer.innerHTML = '';
        if (uData.friends && uData.friends.length > 0) {
            uData.friends.forEach(async (fId) => {
                const fSnap = await getDoc(doc(db, "users", fId));
                if (fSnap.exists()) renderConversationCard(fSnap.data(), false);
            });
        }

        requestsContainer.innerHTML = '';
        if (uData.requestsReceived && uData.requestsReceived.length > 0) {
            uData.requestsReceived.forEach(async (rId) => {
                const rSnap = await getDoc(doc(db, "users", rId));
                if (rSnap.exists()) renderRequestCard(rSnap.data());
            });
        }
    });
}

function renderConversationCard(data, isGroup) {
    const card = document.createElement('div');
    card.className = "flex items-center justify-between p-3 bg-white border rounded-2xl cursor-pointer hover:bg-gray-50 shadow-2xs";
    card.innerHTML = `
        <div class="flex items-center gap-3">
            <img src="${data.photoURL}" class="w-10 h-10 rounded-full object-cover border">
            <div>
                <h4 class="font-bold text-xs text-gray-800">${data.displayName}</h4>
                <p class="text-[10px] text-gray-400">Tap to start secure session</p>
            </div>
        </div>
    `;
    card.onclick = () => openMessengerInterface(data, isGroup);
    chatsContainer.appendChild(card);
}

function renderRequestCard(data) {
    const row = document.createElement('div');
    row.className = "p-3 bg-white border rounded-2xl flex items-center justify-between";
    row.innerHTML = `
        <div class="flex items-center gap-2"><img src="${data.photoURL}" class="w-8 h-8 rounded-full"><span class="text-xs font-bold">${data.displayName}</span></div>
        <button class="bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl run-accept-req" data-id="${data.uid}">Accept</button>
    `;
    requestsContainer.appendChild(row);
}

document.body.addEventListener('click', async (e) => {
    if (e.target.classList.contains('run-accept-req')) {
        const id = e.target.getAttribute('data-id');
        const myRef = doc(db, "users", currentUser.uid);
        const targetRef = doc(db, "users", id);
        const mySnap = await getDoc(myRef);
        const cleanReqs = (mySnap.data().requestsReceived || []).filter(i => i !== id);

        await updateDoc(myRef, { friends: arrayUnion(id), requestsReceived: cleanReqs });
        await updateDoc(targetRef, { friends: arrayUnion(currentUser.uid) });
    }
});

// --- BACKGROUND REAL-TIME SMS NOTIFIER ENGINE ---
function listenForGlobalIncomingMessages() {
    onSnapshot(collection(db, "chats"), (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === "modified" || change.type === "added") {
                const tokens = change.doc.id.split("_");
                if (tokens.includes(currentUser.uid)) {
                    const msgQuery = query(collection(db, "chats", change.doc.id, "messages"), orderBy("timestamp", "desc"));
                    const querySnap = await getDocs(msgQuery);
                    if (!querySnap.empty) {
                        const latestMsg = querySnap.docs[0].data();
                        if (latestMsg.senderId !== currentUser.uid && (!activeChatUser || fullChatView.classList.contains('hidden'))) {
                            sendInAppNotification("New Message", latestMsg.text || "Sent a media file");
                        }
                    }
                }
            }
        });
    });
}

// --- CHAT SYSTEM MODULE ---
function openMessengerInterface(target, groupContextFlag) {
    activeChatUser = target;
    isGroupContext = groupContextFlag;
    fullChatView.classList.remove('hidden');
    document.getElementById('chat-user-pic').src = target.photoURL;
    document.getElementById('chat-user-name').textContent = target.displayName;

    const roomPath = [currentUser.uid, target.uid].sort().join("_");
    if (chatMessagesUnsubscribe) chatMessagesUnsubscribe();

    const q = query(collection(db, "chats", roomPath, "messages"), orderBy("timestamp", "asc"));
    chatMessagesUnsubscribe = onSnapshot(q, (snapshot) => {
        const msgBox = document.getElementById('chat-messages');
        msgBox.innerHTML = '';
        snapshot.forEach(doc => {
            const m = doc.data();
            const isMe = m.senderId === currentUser.uid;
            const msgRow = document.createElement('div');
            msgRow.className = `flex ${isMe ? 'justify-end' : 'justify-start'} mb-1`;

            let contentNode = `<p class="text-xs leading-relaxed">${m.text}</p>`;
            if (m.type === 'image') contentNode = `<img src="${m.mediaUrl}" class="max-w-[60vw] rounded-lg border shadow-sm" alt="image">`;
            if (m.type === 'audio') contentNode = `<audio src="${m.mediaUrl}" controls class="max-w-[55vw] scale-90 origin-left"></audio>`;

            msgRow.innerHTML = `
                <div class="${isMe ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'} p-3 rounded-2xl max-w-[70vw] shadow-3xs">
                    ${contentNode}
                </div>
            `;
            msgBox.appendChild(msgRow);
        });
        msgBox.scrollTop = msgBox.scrollHeight;
    });
}

document.getElementById('close-chat').addEventListener('click', () => { fullChatView.classList.add('hidden'); activeChatUser = null; });

async function dispatchChatMessage(payload, type = 'text') {
    if (!activeChatUser) return;
    const roomPath = [currentUser.uid, activeChatUser.uid].sort().join("_");
    await addDoc(collection(db, "chats", roomPath, "messages"), {
        senderId: currentUser.uid,
        timestamp: Date.now(),
        type: type,
        ...payload
    });
}

document.getElementById('btn-send-msg').addEventListener('click', () => {
    const input = document.getElementById('chat-msg-input');
    if (!input.value.trim()) return;
    dispatchChatMessage({ text: input.value.trim() }, 'text');
    input.value = '';
});

// FIXED: CHAT IMAGE TRANSMISSION SYSTEM
document.getElementById('chat-image-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !activeChatUser) return;

    try {
        const storageRef = ref(storage, `chats/${Date.now()}_${file.name}`);
        const snap = await uploadBytes(storageRef, file);
        const downloadUrl = await getDownloadURL(snap.ref);
        await dispatchChatMessage({ mediaUrl: downloadUrl, text: '[Image Photo]' }, 'image');
        e.target.value = ''; // input reset
    } catch (err) {
        console.error(err);
        alert("Image upload failed. Ensure your Firebase Storage rules allow writing.");
    }
});

// FIXED: VOICE RECORD NOTES DISPATCH PIPELINE
const voiceBtn = document.getElementById('btn-voice-record');
voiceBtn.addEventListener('click', async () => {
    if (!activeChatUser) return;

    if (!mediaRecorder) {
        audioChunks = [];
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);

            mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                try {
                    const blob = new Blob(audioChunks, { type: 'audio/webm; codecs=opus' });
                    const fileRef = ref(storage, `audio/${Date.now()}.webm`);
                    const uploadSnap = await uploadBytes(fileRef, blob);
                    const streamURL = await getDownloadURL(uploadSnap.ref);
                    await dispatchChatMessage({ mediaUrl: streamURL, text: '[Voice Note]' }, 'audio');
                } catch (uploadErr) {
                    console.error(uploadErr);
                    alert("Voice note upload failed.");
                }
            };

            mediaRecorder.start();
            voiceBtn.classList.replace('text-gray-400', 'text-red-500');
        } catch (mediaErr) {
            alert("Microphone access denied or unavailable.");
        }
    } else {
        mediaRecorder.stop();
        mediaRecorder = null;
        voiceBtn.classList.replace('text-red-500', 'text-gray-400');
    }
});

// --- BROADCAST SOCIAL FEED ENGINE ---
function loadGlobalFeed() {
    onSnapshot(query(collection(db, "posts"), orderBy("timestamp", "desc")), (snapshot) => {
        feedStream.innerHTML = '';
        snapshot.forEach(d => {
            const post = d.data();
            const postCard = document.createElement('div');
            postCard.className = "bg-white p-4 rounded-2xl border border-gray-100 shadow-3xs";
            postCard.innerHTML = `
                <div class="flex items-center gap-2.5 mb-3">
                    <img src="${post.authorPic}" class="w-8 h-8 rounded-full border" alt="author">
                    <div><h4 class="font-bold text-xs text-gray-800">${post.authorName}</h4></div>
                </div>
                <p class="text-xs text-gray-700 mb-2">${post.text || ''}</p>
                ${post.image ? `<img src="${post.image}" class="w-full rounded-xl object-cover" alt="post-img">` : ''}
            `;
            feedStream.appendChild(postCard);
        });
    });
}

// --- REAL-TIME WEBRTC SIGNALING INTERFACE ENGINE ---
async function initiateLiveWebRTCSession(videoEnabled = true) {
    document.getElementById('call-overlay').classList.remove('hidden');
    document.getElementById('call-status').innerText = "Ringing Target Engine Channel...";

    localStream = await navigator.mediaDevices.getUserMedia({ video: videoEnabled, audio: true });
    document.getElementById('local-video').srcObject = localStream;

    peerConnection = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        document.getElementById('remote-video').srcObject = event.streams[0];
    };

    const callDocRef = await addDoc(collection(db, "calls"), {
        callerId: currentUser.uid, callerName: currentUser.displayName,
        receiverId: activeChatUser.uid, status: "ringing", type: videoEnabled ? "video" : "audio",
        timestamp: Date.now()
    });
    currentCallId = callDocRef.id;

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            addDoc(collection(db, "calls", currentCallId, "callerCandidates"), event.candidate.toJSON());
        }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await updateDoc(doc(db, "calls", currentCallId), { offer: { type: offer.type, sdp: offer.sdp } });

    onSnapshot(doc(db, "calls", currentCallId), async (snap) => {
        const data = snap.data();
        if (data && data.answer && !peerConnection.currentRemoteDescription) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            document.getElementById('call-status').innerText = "Session Established Connected Live";
        }
        if (data && data.status === "rejected") terminateHardwareSession();
    });

    onSnapshot(collection(db, "calls", currentCallId, "receiverCandidates"), (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === "added") {
                await peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
        });
    });
}

function listenForIncomingCalls() {
    const q = query(collection(db, "calls"), where("receiverId", "==", currentUser.uid), where("status", "==", "ringing"));
    onSnapshot(q, (snapshot) => {
        snapshot.forEach(d => {
            const callData = d.data();
            currentCallId = d.id;
            document.getElementById('incoming-caller-name').innerText = `${callData.callerName} is initializing an incoming ${callData.type} call session.`;
            document.getElementById('incoming-call-overlay').classList.remove('hidden');
            sendInAppNotification("Incoming Call Alert", `${callData.callerName} is requesting connection.`);
        });
    });
}

document.getElementById('btn-accept-call').addEventListener('click', async () => {
    document.getElementById('incoming-call-overlay').classList.add('hidden');
    document.getElementById('call-overlay').classList.remove('hidden');
    document.getElementById('call-status').innerText = "Linking media descriptors...";

    const callSnap = await getDoc(doc(db, "calls", currentCallId));
    const callData = callSnap.data();
    const isVideo = callData.type === "video";

    localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
    document.getElementById('local-video').srcObject = localStream;

    peerConnection = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        document.getElementById('remote-video').srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            addDoc(collection(db, "calls", currentCallId, "receiverCandidates"), event.candidate.toJSON());
        }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await updateDoc(doc(db, "calls", currentCallId), { answer: { type: answer.type, sdp: answer.sdp }, status: "accepted" });

    onSnapshot(collection(db, "calls", currentCallId, "callerCandidates"), (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === "added") {
                await peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
        });
    });

    onSnapshot(doc(db, "calls", currentCallId), (snap) => {
        if (snap.exists() && snap.data().status === "rejected") terminateHardwareSession();
    });
});

document.getElementById('btn-decline-call').addEventListener('click', async () => {
    document.getElementById('incoming-call-overlay').classList.add('hidden');
    await updateDoc(doc(db, "calls", currentCallId), { status: "rejected" });
});

document.getElementById('btn-end-call').addEventListener('click', async () => {
    if (currentCallId) await updateDoc(doc(db, "calls", currentCallId), { status: "rejected" });
    terminateHardwareSession();
});

function terminateHardwareSession() {
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    document.getElementById('call-overlay').classList.add('hidden');
    document.getElementById('incoming-call-overlay').classList.add('hidden');
}

document.getElementById('btn-voice-call').addEventListener('click', () => initiateLiveWebRTCSession(false));
document.getElementById('btn-video-call').addEventListener('click', () => initiateLiveWebRTCSession(true));

document.querySelectorAll('#theme-selectors button').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.getElementById('chat-messages').className = `flex-1 overflow-y-auto p-4 space-y-3 theme-${e.currentTarget.getAttribute('data-theme')}`;
    });
});