// ------------------------------
// FIREBASE CONFIG - REPLACE WITH YOUR OWN!
// Get this from Firebase Console > Project Settings > Add App
// ------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyDih5G6dEis-UKN6jWvQH0K3ZEMi3_JNWI",
  authDomain: "everflow-b8078.firebaseapp.com",
  projectId: "everflow-b8078",
  storageBucket: "everflow-b8078.appspot.com",
  messagingSenderId: "134718334592",
  appId: "1:134718334592:web:86bcee8c1a691468265"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Default workers (will be synced with Firestore)
const DEFAULT_WORKERS = [
  { id: "1", name: "Worker 1", code: "2222" },
  { id: "2", name: "Worker 2", code: "3333" },
  { id: "3", name: "Worker 3", code: "4444" },
  { id: "4", name: "Worker 4", code: "5555" }
];

// Helper function to create a unique key for a note
function getNoteKey(note) {
  return `${note.Agent || ""}|||${note.Number || ""}|||${note.Date || ""}|||${note.Note || ""}`;
}

const state = {
  priority: false,
  activeTab: "today",
  editingId: null,
  selectedIds: new Set(),
  todayItems: [],
  allItems: [],
  searchVisible: false,
  searchQuery: "",
  workers: [],
  currentUser: null, // { id, name, code, role: 'admin'|'worker' }
  editingWorkerId: null, // For admin edit worker modal
  selectedWorkerForView: null, // For admin viewing a worker's notes
  adminActiveSection: "workers", // workers, worker-notes, add-note, all-notes, quick-notes
  selectedWorkersForFilter: new Set(), // Worker IDs selected for filtering
  adminEditingId: null, // For admin note editing
  adminSelectedIds: new Set(), // Now stores note keys (not sheetIndex)
  quickNotes: [] // For Quick Notes
};

// LocalStorage Helper
const cache = {
  set: (key, data) => {
    console.log("cache.set called with key:", key, "data:", data);
    localStorage.setItem(key, JSON.stringify({ data, time: Date.now() }));
  },
  get: (key) => {
    const val = localStorage.getItem(key);
    console.log("cache.get called with key:", key, "raw val:", val);
    if (!val) return null;
    try {
      const parsed = JSON.parse(val);
      console.log("cache.get parsed val:", parsed);
      if (parsed && parsed.data !== undefined) return parsed.data;
      return parsed;
    } catch(e) { 
      console.log("cache.get error:", e);
      return null; 
    }
  }
};

// ------------------------------
// FIREBASE / FIRESTORE FUNCTIONS
// ------------------------------

// Initialize workers from Firestore or defaults
async function initWorkers() {
  try {
    const snapshot = await db.collection('workers').get();
    const workersList = [];
    snapshot.forEach(doc => {
      workersList.push({ id: doc.id, ...doc.data() });
    });
    
    if (workersList.length > 0) {
      // Ensure all worker.id are strings
      state.workers = workersList.map(w => ({ ...w, id: String(w.id) }));
      cache.set('evernote_workers', state.workers);
    } else {
      // Use defaults if no workers in Firestore
      let savedWorkers = cache.get('evernote_workers');
      if (!savedWorkers || !Array.isArray(savedWorkers) || savedWorkers.length === 0) {
        savedWorkers = [...DEFAULT_WORKERS];
      }
      // Ensure all worker.id are strings
      state.workers = savedWorkers.map(w => ({ ...w, id: String(w.id) }));
      // Save default workers to Firestore
      for (const worker of state.workers) {
        await saveSingleWorker(worker);
      }
    }
  } catch (e) {
    console.error("Error loading workers from Firestore:", e);
    // Fall back to local cache, then to defaults
    let savedWorkers = cache.get('evernote_workers');
    if (!savedWorkers || !Array.isArray(savedWorkers) || savedWorkers.length === 0) {
      savedWorkers = [...DEFAULT_WORKERS];
    }
    // Ensure all worker.id are strings
    state.workers = savedWorkers.map(w => ({ ...w, id: String(w.id) }));
    cache.set('evernote_workers', state.workers);
  }
}

// Save workers to Firestore (and cache locally)
async function saveWorkers() {
  cache.set('evernote_workers', state.workers);
}

// Save single worker to Firestore
async function saveSingleWorker(worker) {
  try {
    if (worker.id && typeof worker.id === 'string' && worker.id.length > 0) {
      // Update existing worker
      await db.collection('workers').doc(worker.id).set({
        name: worker.name,
        code: worker.code
      });
    } else {
      // Add new worker
      const docRef = await db.collection('workers').add({
        name: worker.name,
        code: worker.code
      });
      worker.id = docRef.id;
    }
    await saveWorkers();
  } catch (e) {
    console.error("Error saving worker to Firestore:", e);
    throw e;
  }
}

// Delete worker from Firestore
async function deleteSingleWorker(id) {
  console.log('deleteSingleWorker called with id:', id);
  try {
    await db.collection('workers').doc(id).delete();
    // Also delete all notes by this worker? (Optional)
    // const notesSnapshot = await db.collection('notes').where('Agent', '==', workerName).get();
    // notesSnapshot.forEach(doc => doc.ref.delete());
    await saveWorkers();
  } catch (e) {
    console.error("Error deleting worker from Firestore:", e);
    throw e;
  }
}

// Get all notes from Firestore
async function getAllNotes(useCache = true) {
  if (useCache) {
    const cachedData = cache.get('notes_list');
    if (cachedData) {
      console.log("Using cached notes data...");
      return cachedData;
    }
  }

  console.log("Fetching notes from Firestore...");
  try {
    const snapshot = await db.collection('notes').orderBy('Date', 'desc').get();
    const notesList = [];
    snapshot.forEach(doc => {
      notesList.push({
        id: doc.id,
        ...doc.data(),
        sheetIndex: doc.id // For backward compatibility
      });
    });
    cache.set('notes_list', notesList);
    return notesList;
  } catch (e) {
    console.error("Error fetching notes from Firestore:", e);
    return cache.get('notes_list') || [];
  }
}

// Save note to Firestore
async function saveNoteToFirestore(noteData) {
  try {
    if (noteData.id && typeof noteData.id === 'string' && noteData.id.length > 0) {
      // Update existing note
      await db.collection('notes').doc(noteData.id).set(noteData);
    } else {
      // Add new note
      const docRef = await db.collection('notes').add(noteData);
      noteData.id = docRef.id;
      noteData.sheetIndex = docRef.id;
    }
    // Refresh cache
    await getAllNotes(false);
  } catch (e) {
    console.error("Error saving note to Firestore:", e);
    throw e;
  }
}

// Delete note(s) from Firestore
async function deleteNotesFromFirestore(noteIds) {
  try {
    const batch = db.batch();
    noteIds.forEach(id => {
      const noteRef = db.collection('notes').doc(id);
      batch.delete(noteRef);
    });
    await batch.commit();
    // Refresh cache
    await getAllNotes(false);
  } catch (e) {
    console.error("Error deleting notes from Firestore:", e);
    throw e;
  }
}

// Calculate remaining time for quick note
function getRemainingTime(createdAt) {
  const now = Date.now();
  const fiveDaysInMs = 5 * 24 * 60 * 60 * 1000;
  const expiresAt = createdAt + fiveDaysInMs;
  const remainingMs = expiresAt - now;

  if (remainingMs <= 0) return { expired: true };

  const remainingDays = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const remainingHours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const remainingMinutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

  if (remainingDays > 0) {
    return {
      expired: false,
      text: `${remainingDays} din baki`,
      isHourCountdown: false
    };
  } else {
    return {
      expired: false,
      text: `${remainingHours} ghanta ${remainingMinutes} minute baki`,
      isHourCountdown: true
    };
  }
}

// Delete expired quick notes
async function deleteExpiredQuickNotes() {
  const allQuickNotes = await getAllQuickNotes(false);
  const now = Date.now();
  const fiveDaysInMs = 5 * 24 * 60 * 60 * 1000;
  const expiredNoteIds = allQuickNotes
    .filter(note => (note.createdAt || 0) + fiveDaysInMs <= now)
    .map(note => note.id);

  if (expiredNoteIds.length > 0) {
    console.log(`Deleting ${expiredNoteIds.length} expired quick notes...`);
    await deleteQuickNotesFromFirestore(expiredNoteIds);
  }
}

// Get all Quick Notes from Firestore
async function getAllQuickNotes(useCache = true) {
  if (useCache) {
    const cachedData = cache.get('quick_notes_list');
    if (cachedData) {
      console.log("Using cached quick notes data...");
      return cachedData;
    }
  }

  console.log("Fetching quick notes from Firestore...");
  try {
    const snapshot = await db.collection('quick_notes').orderBy('Date', 'desc').get();
    const quickNotesList = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      quickNotesList.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt || Date.now(), // Default to now if missing
        lastRemindedAt: data.lastRemindedAt || null // Default to null if missing
      });
    });
    cache.set('quick_notes_list', quickNotesList);
    state.quickNotes = quickNotesList;
    return quickNotesList;
  } catch (e) {
    console.error("Error fetching quick notes from Firestore:", e);
    return cache.get('quick_notes_list') || [];
  }
}

// Save Quick Note to Firestore
async function saveQuickNoteToFirestore(quickNoteData) {
  try {
    if (quickNoteData.id && typeof quickNoteData.id === 'string' && quickNoteData.id.length > 0) {
      // Update existing quick note
      await db.collection('quick_notes').doc(quickNoteData.id).set(quickNoteData);
    } else {
      // Add new quick note
      const docRef = await db.collection('quick_notes').add(quickNoteData);
      quickNoteData.id = docRef.id;
    }
    // Refresh cache
    await getAllQuickNotes(false);
  } catch (e) {
    console.error("Error saving quick note to Firestore:", e);
    throw e;
  }
}

// Delete Quick Note(s) from Firestore
async function deleteQuickNotesFromFirestore(quickNoteIds) {
  try {
    const batch = db.batch();
    quickNoteIds.forEach(id => {
      const quickNoteRef = db.collection('quick_notes').doc(id);
      batch.delete(quickNoteRef);
    });
    await batch.commit();
    // Refresh cache
    await getAllQuickNotes(false);
  } catch (e) {
    console.error("Error deleting quick notes from Firestore:", e);
    throw e;
  }
}

// ------------------------------
// NOTIFICATION FUNCTIONS
// ------------------------------
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.log('This browser does not support notifications');
    return;
  }
  const permission = await Notification.requestPermission();
  console.log('Notification permission:', permission);
}

function sendNotification(title, body) {
  if (!('Notification' in window)) {
    console.log('This browser does not support notifications');
    return;
  }
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: 'logo192.png' });
  }
}

async function checkQuickNoteReminders() {
  try {
    const quickNotes = await getAllQuickNotes(false);
    const now = Date.now();
    const reminderInterval = 2.5 * 60 * 60 * 1000; // 2.5 hours (between 2-3)
    const updatedNotes = [];

    for (const note of quickNotes) {
      const lastReminded = note.lastRemindedAt || note.createdAt;
      if (now - lastReminded >= reminderInterval) {
        // Send reminder
        sendNotification(`Quick Note Reminder from ${note.Agent}`, note.Note);
        // Update lastRemindedAt
        note.lastRemindedAt = now;
        updatedNotes.push(note);
        // Save to Firestore
        await saveQuickNoteToFirestore(note);
      }
    }

    if (updatedNotes.length > 0) {
      // Update cache
      const currentNotes = cache.get('quick_notes_list') || [];
      for (const updatedNote of updatedNotes) {
        const idx = currentNotes.findIndex(n => n.id === updatedNote.id);
        if (idx !== -1) {
          currentNotes[idx] = updatedNote;
        }
      }
      cache.set('quick_notes_list', currentNotes);
      state.quickNotes = currentNotes;
    }
  } catch (e) {
    console.error('Error checking Quick Note reminders:', e);
  }
}

// ------------------------------
// DATE / UTILITY FUNCTIONS
// ------------------------------

function fmtDate(d) {
  const x = new Date(d);
  if (isNaN(x.getTime())) return "";
  const year = x.getFullYear();
  const month = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fmtDisplayDate(d) {
  if (!d) return "";
  const x = new Date(d);
  if (isNaN(x.getTime())) return d;
  const day = x.getDate();
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const month = months[x.getMonth()];
  const year = String(x.getFullYear()).slice(-2);
  return `${day} ${month}, ${year}`;
}
function todayStr() { return fmtDate(new Date()); }
function uniquePhones(items) { const s = new Set(); items.forEach(i => { if (i.Number) s.add(i.Number); }); return Array.from(s); }

// Export notes to PDF function
function exportNotesToPDF(notes, title = "Notes") {
  // Access jsPDF from window (since it's loaded via UMD CDN)
  const { jsPDF } = window.jspdf;
  
  // Create new PDF document
  const doc = new jsPDF();
  
  // Add title
  doc.setFontSize(18);
  doc.text(title, 14, 22);
  
  // Prepare table data
  const tableData = notes.map(note => [
    note.Number || "-",
    fmtDisplayDate(note.Date) || "-",
    note.Note || "-"
  ]);
  
  // Add table with columns: Number, Date, Note
  doc.autoTable({
    startY: 30,
    head: [['Number', 'Date', 'Note']],
    body: tableData,
    theme: 'grid',
    styles: { fontSize: 10 },
    headStyles: { fillColor: [59, 130, 246], textColor: 255, fontWeight: 'bold' }
  });
  
  // Generate filename with current date
  const filename = `evernote-${todayStr()}.pdf`;
  
  // Download the PDF
  doc.save(filename);
}

// Helper function to export Admin's all notes
function exportAdminAllNotes() {
  const cachedNotes = cache.get('notes_list') || [];
  const adminNotes = cachedNotes.filter(note => note.Agent === 'Sabbir');
  exportNotesToPDF(adminNotes, 'Admin Notes');
}

// Helper function to export Admin's today notes
function exportAdminTodayNotes() {
  const todayStrVal = todayStr();
  const allNotes = cache.get('notes_list') || [];
  const todayNotes = allNotes.filter(note => {
    if (!note.Date) return false;
    if (note.Agent !== 'Sabbir') return false;
    return fmtDate(note.Date) === todayStrVal;
  });
  exportNotesToPDF(todayNotes, "Admin's Today's Notes");
}

// Helper function to export filtered notes (Admin)
function exportFilteredNotes() {
  // Get selected worker names
  const selectedWorkerNames = state.workers.filter(w => state.selectedWorkersForFilter.has(String(w.id))).map(w => w.name);
  const allNotes = cache.get('notes_list') || [];
  const filteredNotes = allNotes.filter(note => selectedWorkerNames.includes(note.Agent));
  filteredNotes.sort((a, b) => new Date(b.Date) - new Date(a.Date));
  exportNotesToPDF(filteredNotes, 'Filtered Notes');
}

// Helper function to export a specific worker's notes (Admin)
function exportWorkerNotes(workerName) {
  const allNotes = cache.get('notes_list') || [];
  const workerNotes = allNotes.filter(note => note.Agent === workerName);
  exportNotesToPDF(workerNotes, `${workerName}'s Notes`);
}

// Helper functions for worker's own notes
function exportWorkerTodayNotes() {
  const title = state.currentUser ? `${state.currentUser.name}'s Today's Notes` : "Today's Notes";
  exportNotesToPDF(state.todayItems, title);
}

function exportWorkerAllNotes() {
  const title = state.currentUser ? `${state.currentUser.name}'s Notes` : "Notes";
  exportNotesToPDF(state.allItems, title);
}

// ------------------------------
// ACCESS CODE / LOGIN
// ------------------------------

let enteredCode = '';
let accessCodeListenersAttached = false;
let appListenersAttached = false;

function updateCodeDisplay() {
  const display = document.getElementById('code-display');
  if (!display) return;
  display.textContent = '•'.repeat(enteredCode.length);
  if (enteredCode.length === 0) {
    display.textContent = '••••';
  }
}

function getWorkersForLogin() {
  if (Array.isArray(state.workers) && state.workers.length > 0) {
    return state.workers;
  }

  const cachedWorkers = cache.get('evernote_workers');
  if (Array.isArray(cachedWorkers) && cachedWorkers.length > 0) {
    return cachedWorkers.map(w => ({ ...w, id: String(w.id) }));
  }

  return DEFAULT_WORKERS.map(w => ({ ...w, id: String(w.id) }));
}

function hydrateWorkersForLogin() {
  state.workers = getWorkersForLogin();
}

async function checkAndLogin() {
  // Only check when exactly 4 digits are entered
  if (enteredCode.length !== 4) return;

  // Check for admin first - works regardless of workers
  if (enteredCode === '0000') {
    state.currentUser = { id: 0, name: 'Sabbir', code: '0000', role: 'admin' };
    saveLoginData(state.currentUser);
    enteredCode = '';
    updateCodeDisplay();
    showAdminDashboard();
    return;
  }

  // Check for worker
  const localWorker = getWorkersForLogin().find(w => String(w.code) === String(enteredCode));
  if (localWorker) {
    state.currentUser = { ...localWorker, role: 'worker' };
    saveLoginData(state.currentUser);
    enteredCode = '';
    updateCodeDisplay();
    showWorkerDashboard();
    return;
  }

  // Invalid code - just clear without warning
  setTimeout(() => {
    enteredCode = '';
    updateCodeDisplay();
  }, 300);
}

function saveLoginData(user) {
  const loginData = { user, timestamp: Date.now() };
  localStorage.setItem('evernote_login', JSON.stringify(loginData));
}

function clearLoginData() { localStorage.removeItem('evernote_login'); }

function logout() {
  state.currentUser = null;
  state.selectedWorkerForView = null;
  clearLoginData();
  const allTitleElements = document.querySelectorAll('.app-title');
  allTitleElements.forEach(el => {
    if (el.closest('#access-screen') || el.closest('#worker-dashboard')) {
      el.textContent = 'EverNote';
    } else if (el.closest('#admin-dashboard')) {
      el.textContent = 'EverNote Admin';
    }
  });
  showAccessScreen();
}

// ------------------------------
// SCREEN / DASHBOARD FUNCTIONS
// ------------------------------

function showAccessScreen() {
  document.getElementById('access-screen').classList.remove('hidden');
  document.getElementById('worker-dashboard').classList.add('hidden');
  document.getElementById('admin-dashboard').classList.add('hidden');
  state.currentUser = null;
  enteredCode = '';
  updateCodeDisplay();
  const accessTitle = document.querySelector('#access-screen .app-title');
  if (accessTitle) accessTitle.textContent = 'EverNote';
}

function attachAccessCodeListeners() {
  if (accessCodeListenersAttached) return;
  accessCodeListenersAttached = true;

  document.querySelectorAll('.keypad-btn[data-digit]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (enteredCode.length < 4) {
        enteredCode += btn.dataset.digit;
        updateCodeDisplay();
        checkAndLogin();
      }
    });
  });

  document.querySelector('.keypad-btn[data-action="delete"]')?.addEventListener('click', () => {
    enteredCode = enteredCode.slice(0, -1);
    updateCodeDisplay();
  });

  document.querySelector('.keypad-btn[data-action="clear"]')?.addEventListener('click', () => {
    enteredCode = '';
    updateCodeDisplay();
  });

  document.addEventListener('keydown', (e) => {
    const accessScreen = document.getElementById('access-screen');
    if (!accessScreen || accessScreen.classList.contains('hidden')) return;

    if (/^[0-9]$/.test(e.key)) {
      if (enteredCode.length < 4) {
        enteredCode += e.key;
        updateCodeDisplay();
        checkAndLogin();
      }
      return;
    }

    if (e.key === 'Backspace') {
      enteredCode = enteredCode.slice(0, -1);
      updateCodeDisplay();
    } else if (e.key === 'Escape') {
      enteredCode = '';
      updateCodeDisplay();
    }
  });
}

function attachAppEventListeners() {
  if (appListenersAttached) return;
  appListenersAttached = true;

  console.log("Attaching event listeners!");
  console.log("document.getElementById('save'):", document.getElementById('save'));
  console.log("document.getElementById('admin-save-btn'):", document.getElementById('admin-save-btn'));
  document.getElementById('save')?.addEventListener('click', saveNoteWrapper);
  document.getElementById('admin-save-btn')?.addEventListener('click', saveAdminNote);
  document.getElementById('add-worker-btn')?.addEventListener('click', addWorker);
  document.getElementById('save-worker-btn')?.addEventListener('click', saveWorkerChanges);
  document.getElementById('close-edit-worker-modal')?.addEventListener('click', closeEditWorkerModal);
  document.getElementById('paste-phone')?.addEventListener('click', pastePhone);
  document.getElementById('paste-admin-phone')?.addEventListener('click', pasteAdminPhone);
  document.getElementById('save-quick-note-worker')?.addEventListener('click', saveQuickNoteWrapper);
  document.getElementById('save-quick-note-admin')?.addEventListener('click', saveAdminQuickNote);
  document.getElementById('back-to-workers')?.addEventListener('click', backToWorkerList);
  document.getElementById('close-modal')?.addEventListener('click', closeModal);
  document.getElementById('tab-today')?.addEventListener('click', () => setTab('today'));
  document.getElementById('tab-all')?.addEventListener('click', () => setTab('all'));
  document.getElementById('tab-quick-notes')?.addEventListener('click', () => setTab('quick-notes'));
  document.getElementById('admin-tab-add-note')?.addEventListener('click', () => selectAdminMenuItem('add-note'));
  document.getElementById('admin-tab-all-notes')?.addEventListener('click', () => selectAdminMenuItem('all-notes'));
  document.getElementById('admin-tab-quick-notes')?.addEventListener('click', () => selectAdminMenuItem('quick-notes'));
  document.getElementById('worker-menu-toggle-btn')?.addEventListener('click', openWorkerMenu);
  document.getElementById('worker-close-menu-btn')?.addEventListener('click', closeWorkerMenu);
  document.getElementById('worker-menu-logout')?.addEventListener('click', () => { logout(); closeWorkerMenu(); });
  document.getElementById('worker-menu-overlay')?.addEventListener('click', closeWorkerMenu);
  document.getElementById('menu-toggle-btn')?.addEventListener('click', openAdminMenu);
  document.getElementById('close-menu-btn')?.addEventListener('click', closeAdminMenu);
  document.getElementById('menu-item-add-note')?.addEventListener('click', () => selectAdminMenuItem('add-note'));
  document.getElementById('menu-item-all-notes')?.addEventListener('click', () => selectAdminMenuItem('all-notes'));
  document.getElementById('menu-item-workers')?.addEventListener('click', () => selectAdminMenuItem('workers'));
  document.getElementById('menu-item-worker-notes')?.addEventListener('click', () => selectAdminMenuItem('worker-notes'));
  document.getElementById('menu-item-quick-notes')?.addEventListener('click', () => selectAdminMenuItem('quick-notes'));
  document.getElementById('menu-item-all-workers-quick-notes')?.addEventListener('click', () => selectAdminMenuItem('all-workers-quick-notes'));
  document.getElementById('admin-menu-logout')?.addEventListener('click', () => { logout(); closeAdminMenu(); });
  document.getElementById('admin-menu-overlay')?.addEventListener('click', closeAdminMenu);
  document.getElementById('note-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'note-modal') closeModal();
  });
  document.getElementById('edit-worker-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'edit-worker-modal') closeEditWorkerModal();
  });
}

function showWorkerDashboard() {
  document.getElementById('access-screen').classList.add('hidden');
  document.getElementById('worker-dashboard').classList.remove('hidden');
  document.getElementById('admin-dashboard').classList.add('hidden');
  if (state.currentUser && state.currentUser.name) {
    const titleElements = document.querySelectorAll('#worker-dashboard .app-title');
    titleElements.forEach(el => {
      el.textContent = `EverNote (${state.currentUser.name})`;
    });
  }
  // Render immediately from cache
  renderWorkerTodayNotes();
  renderWorkerAllNotes();
  // Then sync in background
  setTimeout(async () => {
    await getAllNotes(false);
    renderWorkerTodayNotes();
    renderWorkerAllNotes();
  }, 100);
}

function showAdminDashboard() {
  document.getElementById('access-screen').classList.add('hidden');
  document.getElementById('worker-dashboard').classList.add('hidden');
  document.getElementById('admin-dashboard').classList.remove('hidden');
  selectAdminMenuItem('add-note');
  renderWorkerList();
  // Render immediately from cache
  renderAdminTodayNotes();
  renderAllAdminNotes();
  renderWorkerFilterList();
  renderFilteredNotes();
  if (state.selectedWorkerForView) {
    renderAdminWorkerNotes(state.selectedWorkerForView.name);
  }
  // Sync in background
  setTimeout(async () => {
    await initWorkers();
    await getAllNotes(false);
    renderWorkerList();
    renderAdminTodayNotes();
    renderAllAdminNotes();
    renderWorkerFilterList();
    renderFilteredNotes();
    if (state.selectedWorkerForView) {
      renderAdminWorkerNotes(state.selectedWorkerForView.name);
    }
  }, 100);
}

// ------------------------------
// ADMIN MENU / NAVIGATION
// ------------------------------

function openAdminMenu() {
  document.getElementById('admin-menu-overlay').classList.remove('hidden');
  document.getElementById('admin-side-menu').classList.remove('hidden');
}
function closeAdminMenu() {
  document.getElementById('admin-menu-overlay').classList.add('hidden');
  document.getElementById('admin-side-menu').classList.add('hidden');
}
function openWorkerMenu() {
  document.getElementById('worker-menu-overlay').classList.remove('hidden');
  document.getElementById('worker-side-menu').classList.remove('hidden');
}
function closeWorkerMenu() {
  document.getElementById('worker-menu-overlay').classList.add('hidden');
  document.getElementById('worker-side-menu').classList.add('hidden');
}

function selectAdminMenuItem(section) {
  document.getElementById('menu-item-add-note').classList.toggle('active', section === 'add-note');
  document.getElementById('menu-item-all-notes').classList.toggle('active', section === 'all-notes');
  document.getElementById('menu-item-workers').classList.toggle('active', section === 'workers');
  document.getElementById('menu-item-worker-notes').classList.toggle('active', section === 'worker-notes');
  document.getElementById('menu-item-quick-notes').classList.toggle('active', section === 'quick-notes');
  document.getElementById('menu-item-all-workers-quick-notes').classList.toggle('active', section === 'all-workers-quick-notes');
  closeAdminMenu();
  document.getElementById('admin-worker-section').classList.toggle('hidden', section !== 'workers');
  document.getElementById('admin-worker-notes-section').classList.toggle('hidden', section !== 'worker-notes');
  document.getElementById('admin-note-section').classList.toggle('hidden', section !== 'add-note');
  document.getElementById('admin-all-notes-section').classList.toggle('hidden', section !== 'all-notes');
  document.getElementById('admin-quick-notes-section').classList.toggle('hidden', section !== 'quick-notes');
  document.getElementById('admin-all-workers-quick-notes-section').classList.toggle('hidden', section !== 'all-workers-quick-notes');
  const tabsContainer = document.getElementById('admin-tabs-container');
  tabsContainer.classList.toggle('hidden', !['add-note', 'all-notes', 'quick-notes'].includes(section));
  if (['add-note', 'all-notes', 'quick-notes'].includes(section)) {
    document.getElementById('admin-tab-add-note').classList.toggle('active', section === 'add-note');
    document.getElementById('admin-tab-all-notes').classList.toggle('active', section === 'all-notes');
    document.getElementById('admin-tab-quick-notes').classList.toggle('active', section === 'quick-notes');
  }
  state.adminActiveSection = section;
  if (section === 'worker-notes') {
    state.selectedWorkersForFilter.clear();
    renderWorkerFilterList();
    renderFilteredNotes();
  }
  if (section === 'add-note') renderAdminTodayNotes();
  if (section === 'all-notes') renderAllAdminNotes();
  if (section === 'quick-notes') renderAdminQuickNotes();
  if (section === 'all-workers-quick-notes') renderAllWorkersQuickNotes();
}

function renderAllWorkersQuickNotes() {
  const allQuickNotes = cache.get('quick_notes_list') || [];
  const workersQuickNotes = allQuickNotes.filter(note => note.Agent !== "Sabbir");
  const container = document.getElementById('admin-all-workers-quick-notes-container');
  if (!container) return;
  const headerHtml = `
    <div class="list-header">
      <div class="list-title">All Workers' Quick Notes</div>
      <div class="header-right-group">
        <span class="count">${workersQuickNotes.length}</span>
      </div>
    </div>`;
  if (!workersQuickNotes.length) {
    container.innerHTML = headerHtml + '<div class="empty">No Quick Notes from Workers</div>';
    return;
  }
  container.innerHTML = headerHtml + `
    <div class="cards-container">
      ${workersQuickNotes.map((note, index) => renderQuickNoteCard(note, index + 1)).join('')}
    </div>`;
}

// ------------------------------
// ADMIN NOTE FUNCTIONS
// ------------------------------

function toggleAdminSelect(noteKey) {
  console.log("toggleAdminSelect called with noteKey:", noteKey);
  if (state.adminSelectedIds.has(noteKey)) state.adminSelectedIds.delete(noteKey);
  else state.adminSelectedIds.add(noteKey);
  renderAdminTodayNotes();
  renderAllAdminNotes();
  renderWorkerFilterList();
  renderFilteredNotes();
  if (state.selectedWorkerForView) {
    renderAdminWorkerNotes(state.selectedWorkerForView.name);
  }
}

async function deleteSingleAdminNote(noteKey) {
  state.adminSelectedIds.clear();
  state.adminSelectedIds.add(noteKey);
  await deleteSelectedAdmin();
}

function renderAdminNoteCard(i, isTodayView = false, index) {
  const noteKey = getNoteKey(i);
  const isSelected = state.adminSelectedIds.has(noteKey);
  const isAdminNote = i.Agent === "Sabbir";
  const isAllView = !isTodayView;
  return `
    <div class="note-card ${isSelected ? 'selected-row' : ''}" onclick="showFullNote('${i.id || i.sheetIndex}', event)">
      <div class="card-top">
        <div style="display: flex; gap: 12px; align-items: flex-start;">
          ${isAllView ? `
          <label class="custom-checkbox" onclick="event.stopPropagation();">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="event.stopPropagation(); toggleAdminSelect('${noteKey.replace(/'/g, "\\'")}')">
            <span class="checkmark"></span>
          </label>` : ""}
          <div style="display: flex; justify-content: space-between; width: 100%; gap: 16px;">
            <span class="card-number">#${index}</span>
            <span class="card-date">${fmtDisplayDate(i.Date)}</span>
          </div>
        </div>
        ${isAdminNote ? `
          <div class="card-actions" style="gap: 8px;">
            <button class="edit-btn-icon" title="Edit Note" onclick="event.stopPropagation(); editAdminNote('${i.id || i.sheetIndex}')">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
          </div>
        ` : ''}
      </div>
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <span class="card-phone">${i.Number || "No Number"}</span>
        ${i.Number ? `
          <button class="copy-number-btn" onclick="copyNumber('${i.Number}', event)" title="Copy Number" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 4px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
        ` : ''}
      </div>
      <div class="card-note">${i.Note || "No content"}</div>
    </div>`;
}

async function renderAdminTodayNotes() {
  const todayStrVal = todayStr();
  const allNotes = cache.get('notes_list') || [];
  const todayNotes = allNotes.filter(note => {
    if (!note.Date) return false;
    if (note.Agent !== 'Sabbir') return false;
    return fmtDate(note.Date) === todayStrVal;
  });
  const container = document.getElementById('admin-today-notes-container');
  if (!container) return;
  const headerHtml = `
    <div class="list-header">
      <div class="list-title">Today's Notes</div>
      <div class="header-right-group">
        <span class="count">${todayNotes.length}</span>
      </div>
    </div>`;
  if (!todayNotes.length) {
    container.innerHTML = headerHtml + '<div class="empty">No notes today</div>';
    return;
  }
  container.innerHTML = headerHtml + `
    <div class="cards-container">
      ${todayNotes.map((note, index) => renderAdminNoteCard(note, true, index + 1)).join('')}
    </div>`;
}

async function renderAllAdminNotes() {
  const cachedNotes = cache.get('notes_list') || [];
  let allNotes = cachedNotes.filter(note => note.Agent === 'Sabbir');
  const container = document.getElementById('admin-all-notes-container');
  if (!container) return;
  const headerHtml = `
    <div class="list-header">
      <div class="list-title">All Notes</div>
      <div class="header-right-group">
        <span class="count">${allNotes.length}</span>
        <button class="icon-btn" onclick="exportAdminAllNotes()" title="Data Export">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
        <button class="delete-all-btn" onclick="deleteSelectedAdmin()" title="Delete Selected">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </div>
    </div>`;
  if (!allNotes.length) {
    container.innerHTML = headerHtml + '<div class="empty">No notes found</div>';
  } else {
    container.innerHTML = headerHtml + `
      <div class="cards-container">
        ${allNotes.map((note, index) => renderAdminNoteCard(note, false, index + 1)).join('')}
      </div>`;
  }
}

async function saveAdminNote() {
  console.log("saveAdminNote called!");
  const phoneInput = document.getElementById('admin-phone').value.trim();
  const noteInput = document.getElementById('admin-note').value.trim();
  const dateInput = document.getElementById('admin-note-date').value;
  const statusEl = document.getElementById('admin-status');
  const saveBtn = document.getElementById('admin-save-btn');

  console.log("Admin inputs: phone:", phoneInput, "note:", noteInput, "date:", dateInput);

  let phone = phoneInput.replace(/[^\d+]/g, '');
  if (phone.startsWith('+88')) phone = phone.substring(3);
  else if (phone.startsWith('88')) phone = phone.substring(2);
  phone = phone.replace(/\D/g, '');

  console.log("Admin processed phone:", phone);

  if (!phone || !noteInput) {
    alert('Please fill Number and Note fields!');
    return;
  }
  const finalDate = dateInput || fmtDate(new Date());

  let currentNotes = cache.get('notes_list') || [];
  let existingNote = null;
  let isNew = false;
  let tempId = null;
  if (state.adminEditingId !== null) {
    existingNote = currentNotes.find(n => (n.id === state.adminEditingId || n.sheetIndex === state.adminEditingId));
  }

  const savePayload = {
    Agent: "Sabbir",
    Date: finalDate,
    Number: phone,
    Note: noteInput
  };

  // Optimistic UI
  if (existingNote) {
    const idx = currentNotes.findIndex(n => (n.id === state.adminEditingId || n.sheetIndex === state.adminEditingId));
    if (idx !== -1) {
      savePayload.id = existingNote.id;
      savePayload.sheetIndex = existingNote.sheetIndex;
      currentNotes[idx] = { ...existingNote, ...savePayload };
    }
  } else {
    isNew = true;
    tempId = Date.now().toString();
    const tempNote = { ...savePayload, id: tempId, sheetIndex: tempId };
    currentNotes.unshift(tempNote);
  }
  cache.set('notes_list', currentNotes);
  renderAdminTodayNotes();

  statusEl.textContent = "Syncing...";
  statusEl.style.color = "#3b82f6";

  // Sync to Firestore: create a copy without id if new
  let firestorePayload = { ...savePayload };
  if (isNew) {
    delete firestorePayload.id;
    delete firestorePayload.sheetIndex;
  }
  try {
    await saveNoteToFirestore(firestorePayload);
    // If it's a new note, update cache with real Firestore id
    if (isNew) {
      const realId = firestorePayload.id;
      currentNotes = cache.get('notes_list') || [];
      const tempNoteIndex = currentNotes.findIndex(n => n.id === tempId);
      if (tempNoteIndex !== -1) {
        currentNotes[tempNoteIndex] = { ...currentNotes[tempNoteIndex], id: realId, sheetIndex: realId };
        cache.set('notes_list', currentNotes);
        renderAdminTodayNotes();
        renderAllAdminNotes();
      }
    }
    // Send notification if it's a new Today's Note
    if (isNew && fmtDate(savePayload.Date) === todayStr()) {
      sendNotification(`New Note from ${savePayload.Agent}`, savePayload.Note);
    }
    statusEl.textContent = "Saved!";
    statusEl.style.color = "green";
  } catch (e) {
    console.error("Error in saveAdminNote:", e);
    statusEl.textContent = "Saved locally, sync failed!";
    statusEl.style.color = "orange";
  }
  setTimeout(() => statusEl.textContent = "", 3000);

  document.getElementById('admin-phone').value = "";
  document.getElementById('admin-note').value = "";
  document.getElementById('admin-note-date').value = "";
  state.adminEditingId = null;
  saveBtn.textContent = "Save Note";
  saveBtn.classList.remove("editing");
}

async function editAdminNote(id) {
  const allNotes = cache.get('notes_list') || await getAllNotes(true);
  const note = allNotes.find(i => (i.id === id || i.sheetIndex === id));
  if (!note) return;
  if (note.Date) document.getElementById("admin-note-date").value = fmtDate(note.Date);
  document.getElementById("admin-phone").value = note.Number;
  document.getElementById("admin-note").value = note.Note;
  state.adminEditingId = id;
  const saveBtn = document.getElementById("admin-save-btn");
  saveBtn.textContent = "Update Note";
  saveBtn.classList.add("editing");
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteSelectedAdmin() {
  if (state.adminSelectedIds.size === 0) {
    alert("Please select at least one note to delete.");
    return;
  }
  if (!confirm(`Are you sure you want to delete ${state.adminSelectedIds.size} selected note(s)?`)) return;

  const statusEl = document.getElementById("admin-status");
  const deleteKeys = new Set(state.adminSelectedIds);
  const currentNotes = cache.get('notes_list') || [];
  const filteredNotes = currentNotes.filter(n => !deleteKeys.has(getNoteKey(n)));
  cache.set('notes_list', filteredNotes);
  state.adminSelectedIds.clear();
  renderAdminTodayNotes();
  renderAllAdminNotes();
  renderWorkerFilterList();
  renderFilteredNotes();
  if (state.selectedWorkerForView) {
    renderAdminWorkerNotes(state.selectedWorkerForView.name);
  }

  statusEl.textContent = "Deleting...";
  statusEl.style.color = "blue";

  // Sync in background
  (async () => {
    try {
      const freshNotes = await getAllNotes(false);
      const selectedNotes = freshNotes.filter(n => deleteKeys.has(getNoteKey(n)));
      const noteIdsToDelete = selectedNotes.map(n => n.id).filter(id => id);
      if (noteIdsToDelete.length > 0) {
        await deleteNotesFromFirestore(noteIdsToDelete);
      }
      renderAdminTodayNotes();
      renderAllAdminNotes();
      renderWorkerFilterList();
      renderFilteredNotes();
      if (state.selectedWorkerForView) {
        renderAdminWorkerNotes(state.selectedWorkerForView.name);
      }
      statusEl.textContent = "Deleted!";
      statusEl.style.color = "green";
    } catch (e) {
      statusEl.textContent = "Deleted locally, sync failed!";
      statusEl.style.color = "orange";
    }
    setTimeout(() => statusEl.textContent = "", 3000);
  })();
}

// ------------------------------
// ADMIN WORKER FUNCTIONS
// ------------------------------

function renderWorkerList() {
  const container = document.getElementById('worker-list');
  if (!container) return;
  const workers = state.workers;

  if (!workers.length) {
    container.innerHTML = '<div class="empty">No workers found</div>';
    return;
  }

  container.innerHTML = `
    <div class="list-header" style="margin-bottom: 16px;">
      <div class="list-title">Workers</div>
    </div>
    <div class="cards-container">
      ${workers.map(w => `
        <div class="note-card" style="cursor: pointer;" onclick="viewWorkerNotes('${w.id}', '${w.name.replace(/'/g, "\\'")}')">
          <div class="card-top">
            <div class="card-info">
              <div style="font-size: 16px; font-weight: 700; color: var(--text);">${w.name}</div>
              <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Code: ${w.code}</div>
            </div>
            <div class="card-actions">
              <button class="edit-btn-icon" title="Edit Worker" onclick="event.stopPropagation(); editWorker('${w.id}')">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>`;
}

async function addWorker() {
  const name = document.getElementById('new-worker-name').value.trim();
  const code = document.getElementById('new-worker-code').value.trim();
  if (!name || !code) {
    alert('Please fill worker name and code!');
    return;
  }
  const newWorker = { id: Date.now().toString(), name, code };
  state.workers.push(newWorker);
  cache.set('evernote_workers', state.workers);
  renderWorkerList();
  document.getElementById('new-worker-name').value = '';
  document.getElementById('new-worker-code').value = '';
  // Sync in background
  saveSingleWorker(newWorker);
}

async function editWorker(id) {
  const worker = state.workers.find(w => w.id === id);
  if (!worker) return;
  document.getElementById('edit-worker-name').value = worker.name;
  document.getElementById('edit-worker-code').value = worker.code;
  state.editingWorkerId = id;
  document.getElementById('edit-worker-modal').classList.remove('hidden');
}

async function saveWorkerChanges() {
  if (!state.editingWorkerId) return;
  const name = document.getElementById('edit-worker-name').value.trim();
  const code = document.getElementById('edit-worker-code').value.trim();
  if (!name || !code) {
    alert('Please fill worker name and code!');
    return;
  }
  const idx = state.workers.findIndex(w => w.id === state.editingWorkerId);
  if (idx !== -1) {
    state.workers[idx] = { ...state.workers[idx], name, code };
    cache.set('evernote_workers', state.workers);
    renderWorkerList();
    // Sync in background
    saveSingleWorker(state.workers[idx]);
  }
  document.getElementById('edit-worker-modal').classList.add('hidden');
  state.editingWorkerId = null;
}

function closeEditWorkerModal() {
  document.getElementById('edit-worker-modal').classList.add('hidden');
  state.editingWorkerId = null;
}

function viewWorkerNotes(id, name) {
  state.selectedWorkerForView = { id, name };
  document.getElementById('selected-worker-name').textContent = name;
  document.getElementById('admin-worker-section').querySelector('.list-section').classList.add('hidden');
  document.getElementById('admin-worker-notes').classList.remove('hidden');
  renderAdminWorkerNotes(name);
}

function backToWorkerList() {
  state.selectedWorkerForView = null;
  document.getElementById('admin-worker-notes').classList.add('hidden');
  document.getElementById('admin-worker-section').querySelector('.list-section').classList.remove('hidden');
}

function renderAdminWorkerNotes(agentName) {
  const allNotes = cache.get('notes_list') || [];
  const workerNotes = allNotes.filter(n => n.Agent === agentName);
  const todayStrVal = todayStr();
  const todayNotes = workerNotes.filter(n => fmtDate(n.Date) === todayStrVal);
  const olderNotes = workerNotes.filter(n => fmtDate(n.Date) !== todayStrVal);
  const container = document.getElementById('admin-worker-today-view');
  if (!container) return;

  let html = `
    <div class="list-header" style="margin-bottom: 12px;">
      <div class="list-title">Today's Notes</div>
      <div class="header-right-group">
        <span class="count">${todayNotes.length}</span>
      </div>
    </div>
    ${todayNotes.length ? `<div class="cards-container">${todayNotes.map((n, index) => renderAdminNoteCard(n, true, index + 1)).join('')}</div>` : '<div class="empty">No notes today</div>'}
    <div class="list-header" style="margin-bottom: 12px; margin-top: 24px;">
      <div class="list-title">All Notes</div>
      <span class="count">${olderNotes.length}</span>
    </div>
    ${olderNotes.length ? `<div class="cards-container">${olderNotes.map((n, index) => renderAdminNoteCard(n, false, index + 1)).join('')}</div>` : '<div class="empty">No other notes</div>'}`;
  container.innerHTML = html;
}

// ------------------------------
// WORKER FILTER / NOTES
// ------------------------------

function renderWorkerFilterList() {
  const container = document.getElementById('worker-filter-list');
  if (!container) return;
  const allNotes = cache.get('notes_list') || [];
  const workerItemsHtml = state.workers.map(worker => {
    const workerNoteCount = allNotes.filter(note => note.Agent === worker.name).length;
    const workerIdStr = String(worker.id);
    const isSelected = state.selectedWorkersForFilter.has(workerIdStr);
    return `
      <div class="worker-filter-item ${isSelected ? 'selected' : ''}" onclick="toggleWorkerFilter('${workerIdStr}')">
        <div class="worker-filter-info">
          <div class="worker-filter-name">${worker.name}</div>
          <div class="worker-filter-count">${workerNoteCount} notes</div>
        </div>
        <div style="display: flex; align-items: center;">
          <label class="custom-checkbox" style="width: 24px; height: 24px;">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleWorkerFilter('${workerIdStr}');">
            <span class="checkmark"></span>
          </label>
        </div>
      </div>`;
  }).join('');
  container.innerHTML = workerItemsHtml;
}

function toggleWorkerFilter(workerId) {
  // Convert workerId to string to ensure consistent type
  const workerIdStr = String(workerId);
  if (state.selectedWorkersForFilter.has(workerIdStr)) {
    state.selectedWorkersForFilter.delete(workerIdStr);
  } else {
    state.selectedWorkersForFilter.add(workerIdStr);
  }
  renderWorkerFilterList();
  renderFilteredNotes();
}

function renderFilteredNotes() {
  const container = document.getElementById('filtered-notes-container');
  if (!container) return;
  const allNotes = cache.get('notes_list') || [];
  const selectedWorkerNames = state.workers.filter(w => state.selectedWorkersForFilter.has(String(w.id))).map(w => w.name);
  if (selectedWorkerNames.length === 0) {
    container.innerHTML = '<div class="empty">Please select workers to view their notes</div>';
    return;
  }
  const filteredNotes = allNotes.filter(n => selectedWorkerNames.includes(n.Agent));
  filteredNotes.sort((a, b) => new Date(b.Date) - new Date(a.Date));
  const headerHtml = `
    <div class="list-header">
      <div class="list-title">Filtered Notes</div>
      <div class="header-right-group">
        <span class="count">${filteredNotes.length}</span>
        <button class="icon-btn" onclick="exportFilteredNotes()" title="Data Export">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
        <button class="delete-all-btn" onclick="deleteSelectedAdmin()" title="Delete Selected">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </div>
    </div>`;
  if (!filteredNotes.length) {
    container.innerHTML = headerHtml + '<div class="empty">No notes found for selected workers</div>';
    return;
  }
  container.innerHTML = headerHtml + `
    <div class="cards-container">
      ${filteredNotes.map((note, index) => renderAdminNoteCard(note, false, index + 1)).join('')}
    </div>`;
}

// ------------------------------
// WORKER FUNCTIONS
// ------------------------------

async function saveNoteWrapper() {
  console.log("saveNoteWrapper called!");
  const phoneInput = document.getElementById('phone').value.trim();
  const noteInput = document.getElementById('note').value.trim();
  const dateInput = document.getElementById('note-date').value;

  console.log("Inputs: phone:", phoneInput, "note:", noteInput, "date:", dateInput);

  let phone = phoneInput.replace(/[^\d+]/g, '');
  if (phone.startsWith('+88')) phone = phone.substring(3);
  else if (phone.startsWith('88')) phone = phone.substring(2);
  phone = phone.replace(/\D/g, '');

  console.log("Processed phone:", phone);

  if (!phone || !noteInput) {
    alert('Please fill Number and Note fields!');
    return;
  }
  const finalDate = dateInput || fmtDate(new Date());
  console.log("Final date:", finalDate);
  console.log("Calling saveNote with data:", { Agent: state.currentUser?.name, Number: phone, Date: finalDate, Note: noteInput });
  await saveNote({ Agent: state.currentUser?.name, Number: phone, Date: finalDate, Note: noteInput });
}

async function saveNote(data) {
  console.log("saveNote called with data:", data);
  console.log("state.currentUser:", state.currentUser);
  if (state.currentUser?.role !== 'worker') {
    console.log("Not a worker, returning!");
    return;
  }
  data.Agent = state.currentUser.name;
  const status = document.getElementById("status");
  const saveBtn = document.getElementById("save");
  try {
    let currentNotes = cache.get('notes_list') || [];
    console.log("Current notes from cache:", currentNotes);
    let isNew = false;
    let existingNote = null;
    let tempId = null;
    if (state.editingId !== null) {
      existingNote = currentNotes.find(n => (n.id === state.editingId || n.sheetIndex === state.editingId));
      console.log("Existing note found:", existingNote);
    }

    // Optimistic UI
    if (existingNote) {
      const idx = currentNotes.findIndex(n => (n.id === state.editingId || n.sheetIndex === state.editingId));
      if (idx !== -1) {
        data.id = existingNote.id;
        data.sheetIndex = existingNote.sheetIndex;
        currentNotes[idx] = { ...existingNote, ...data };
      }
    } else {
      isNew = true;
      tempId = Date.now().toString();
      const tempNote = { ...data, id: tempId, sheetIndex: tempId };
      currentNotes.unshift(tempNote);
    }

    cache.set('notes_list', currentNotes);
    renderWorkerTodayNotes();
    renderWorkerAllNotes();

    status.textContent = "Syncing...";
    status.style.color = "#3b82f6";

    // Sync to Firestore: create a copy without id if it's new
    let firestorePayload = { ...data };
    if (isNew) {
      delete firestorePayload.id;
      delete firestorePayload.sheetIndex;
    }
    await saveNoteToFirestore(firestorePayload);
    
    // If it's a new note, update the cache with the real Firestore id
    if (isNew) {
      const realId = firestorePayload.id; // saveNoteToFirestore sets firestorePayload.id now
      currentNotes = cache.get('notes_list') || [];
      const tempNoteIndex = currentNotes.findIndex(n => n.id === tempId);
      if (tempNoteIndex !== -1) {
        currentNotes[tempNoteIndex] = { ...currentNotes[tempNoteIndex], id: realId, sheetIndex: realId };
        cache.set('notes_list', currentNotes);
        renderWorkerTodayNotes();
        renderWorkerAllNotes();
      }
    }
    
    // Send notification if it's a new Today's Note
    if (isNew && fmtDate(data.Date) === todayStr()) {
      sendNotification(`New Note from ${data.Agent}`, data.Note);
    }
    
    status.textContent = "Saved!";
    status.style.color = "green";
    setTimeout(() => { if (status.textContent.includes("Saved")) status.textContent = ""; }, 3000);
  } catch (e) {
    console.error("Error in saveNote:", e);
    status.textContent = "Saved locally, sync failed!";
    status.style.color = "orange";
  }

  document.getElementById("phone").value = "";
  document.getElementById("note").value = "";
  document.getElementById("note-date").value = "";
  state.editingId = null;
  saveBtn.textContent = "Save Note";
  saveBtn.classList.remove("editing");
}

function renderWorkerTodayNotes() {
  if (!state.currentUser) return;
  const agentName = state.currentUser.name;
  const allNotes = cache.get('notes_list') || [];
  const todayNotes = allNotes.filter(n => {
    if (!n.Date) return false;
    if (n.Agent !== agentName) return false;
    return fmtDate(n.Date) === todayStr();
  });
  renderList(todayNotes, "today-view");
  renderPhones(allNotes.filter(n => n.Agent === agentName));
}

function renderWorkerAllNotes() {
  if (!state.currentUser) return;
  const agentName = state.currentUser.name;
  const allNotes = cache.get('notes_list') || [];
  const workerNotes = allNotes.filter(n => n.Agent === agentName);
  renderList(workerNotes, "all-view");
  renderPhones(workerNotes);
}

async function deleteSelected() {
  if (state.currentUser?.role !== 'worker') return;
  if (state.selectedIds.size === 0) {
    alert("Please select at least one note to delete.");
    return;
  }
  if (!confirm(`Are you sure you want to delete ${state.selectedIds.size} selected note(s)?`)) return;

  const statusEl = document.getElementById("status");
  const deleteKeys = new Set(state.selectedIds);
  const currentNotes = cache.get('notes_list') || [];
  const filteredNotes = currentNotes.filter(n => !deleteKeys.has(getNoteKey(n)));
  cache.set('notes_list', filteredNotes);
  state.selectedIds.clear();
  renderWorkerTodayNotes();
  renderWorkerAllNotes();
  statusEl.textContent = "Deleting...";
  statusEl.style.color = "blue";

  // Sync in background
  (async () => {
    try {
      const freshNotes = await getAllNotes(false);
      const selectedNotes = freshNotes.filter(n => deleteKeys.has(getNoteKey(n)));
      const noteIdsToDelete = selectedNotes.map(n => n.id).filter(id => id);
      if (noteIdsToDelete.length > 0) await deleteNotesFromFirestore(noteIdsToDelete);
      renderWorkerTodayNotes();
      renderWorkerAllNotes();
      statusEl.textContent = "Deleted!";
      statusEl.style.color = "green";
    } catch (e) {
      statusEl.textContent = "Deleted locally, sync failed!";
      statusEl.style.color = "orange";
    }
    setTimeout(() => statusEl.textContent = "", 3000);
  })();
}

function toggleSelect(noteKey) {
  if (state.selectedIds.has(noteKey)) state.selectedIds.delete(noteKey);
  else state.selectedIds.add(noteKey);
  if (state.activeTab === 'today') renderWorkerTodayNotes();
  else renderWorkerAllNotes();
}

async function deleteSingleWorkerNote(noteKey) {
  state.selectedIds.clear();
  state.selectedIds.add(noteKey);
  await deleteSelected();
}

async function editNote(id) {
  const allNotes = cache.get('notes_list') || await getAllNotes(true);
  const note = allNotes.find(i => (i.id === id || i.sheetIndex === id));
  if (!note) return;
  if (note.Date) document.getElementById("note-date").value = fmtDate(note.Date);
  document.getElementById("phone").value = note.Number;
  document.getElementById("note").value = note.Note;
  const warningDiv = document.getElementById("duplicate-warning");
  if (warningDiv) warningDiv.classList.add("hidden");
  state.editingId = id;
  const saveBtn = document.getElementById("save");
  saveBtn.textContent = "Update Note";
  saveBtn.classList.add("editing");
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setTab(tab) {
  state.activeTab = tab;
  document.getElementById('tab-today').classList.toggle('active', tab === 'today');
  document.getElementById('tab-all').classList.toggle('active', tab === 'all');
  document.getElementById('tab-quick-notes').classList.toggle('active', tab === 'quick-notes');
  document.getElementById('today-view').classList.toggle('hidden', tab !== 'today');
  document.getElementById('all-view').classList.toggle('hidden', tab !== 'all');
  document.getElementById('worker-quick-notes-view').classList.toggle('hidden', tab !== 'quick-notes');
  if (tab === 'quick-notes') {
    renderWorkerQuickNotes();
  }
}

function renderPhones(items) {
  const dl = document.getElementById("phone-suggestions");
  if (!dl) return;
  dl.innerHTML = "";
  uniquePhones(items).slice(0, 50).forEach(p => {
    const o = document.createElement("option");
    o.value = p;
    dl.appendChild(o);
  });
}

function renderList(items, container) {
  const el = document.getElementById(container);
  if (!el) return;
  if (container === "today-view") state.todayItems = items;
  else state.allItems = items;
  const searchQuery = state.searchQuery || "";
  let filteredItems = items;
  if (container === "all-view" && searchQuery) {
    filteredItems = items.filter(i => {
      const num = i.Number ? String(i.Number) : "";
      return num.includes(searchQuery);
    });
  }
  const isAllView = container === "all-view";
  const headerHtml = `
    <div class="list-header ${isAllView ? 'header-compact' : ''}">
      ${container === "today-view" ? `<div class="list-title">Today's Notes</div>` : ""}
      <div class="header-main-actions">
        ${isAllView ? `
        <div class="search-wrapper-dynamic ${state.searchVisible ? 'visible' : ''}">
          <button class="search-toggle-btn" onclick="toggleSearchBar()" title="Search">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </button>
          <div class="search-input-container">
            <input type="text" id="search-input" placeholder="Search number..." value="${searchQuery}">
          </div>
        </div>` : ""}
        <div class="header-right-group">
          <span class="count">${filteredItems.length}</span>
          ${container === "all-view" ? `
          <button class="icon-btn" onclick="exportWorkerAllNotes()" title="Data Export">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
          <button class="delete-all-btn" onclick="deleteSelected()" title="Delete Selected">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>` : ""}
        </div>
      </div>
    </div>`;
  const cardsHtml = filteredItems.length ? `
    <div class="cards-container">
      ${filteredItems.map((i, index) => renderNoteCard(i, container, index + 1)).join("")}
    </div>` : `<div class="empty">${isAllView ? "No Notes Found" : "No Notes For Today"}</div>`;
  el.innerHTML = headerHtml + cardsHtml;
  if (isAllView) {
    attachSearchListener();
    const input = document.getElementById("search-input");
    if (input && state.searchVisible) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

function renderNoteCard(i, container = "", index) {
  const noteKey = getNoteKey(i);
  const isSelected = state.selectedIds.has(noteKey);
  const isAllView = container === "all-view";
  return `
    <div class="note-card ${isSelected ? 'selected-row' : ''}" onclick="showFullNote('${i.id || i.sheetIndex}', event)">
      <div class="card-top">
        <div style="display: flex; gap: 12px; align-items: flex-start;">
          ${isAllView ? `
          <label class="custom-checkbox" onclick="event.stopPropagation();">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="event.stopPropagation(); toggleSelect('${noteKey.replace(/'/g, "\\'")}')">
            <span class="checkmark"></span>
          </label>` : ""}
          <div style="display: flex; justify-content: space-between; width: 100%; gap: 16px;">
            <span class="card-number">#${index}</span>
            <span class="card-date">${fmtDisplayDate(i.Date)}</span>
          </div>
        </div>
        <div class="card-actions" style="gap: 8px;">
          <button class="edit-btn-icon" title="Edit Note" onclick="event.stopPropagation(); editNote('${i.id || i.sheetIndex}')">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <span class="card-phone">${i.Number || "No Number"}</span>
        ${i.Number ? `
          <button class="copy-number-btn" onclick="copyNumber('${i.Number}', event)" title="Copy Number" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 4px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
        ` : ''}
      </div>
      <div class="card-note">${i.Note || "No content"}</div>
    </div>`;
}

function toggleSearchBar() {
  state.searchVisible = !state.searchVisible;
  state.searchQuery = "";
  renderWorkerAllNotes();
}

function attachSearchListener() {
  const searchInput = document.getElementById("search-input");
  if (!searchInput) return;
  searchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderWorkerAllNotes();
  });
}

function showFullNote(id, event) {
  if (event) event.stopPropagation();
  const allNotes = cache.get('notes_list') || [];
  const note = allNotes.find(i => (i.id === id || i.sheetIndex === id));
  if (!note) return;
  const modal = document.getElementById("note-modal");
  document.getElementById("modal-body").textContent = note.Note || "No content";
  document.getElementById("modal-date").textContent = `Date: ${fmtDisplayDate(note.Date)}`;
  document.getElementById("modal-phone").textContent = `Number: ${note.Number || "N/A"}`;
  modal.classList.remove("hidden");
}

function closeModal() {
  document.getElementById("note-modal").classList.add("hidden");
}

function copyNumber(number, event) {
  if (event) event.stopPropagation();
  navigator.clipboard.writeText(number).catch(console.error);
}

async function pastePhone() {
  try {
    const text = await navigator.clipboard.readText();
    const phoneInput = document.getElementById('phone');
    if (phoneInput) phoneInput.value = text;
  } catch (e) {
    console.error("Failed to read clipboard:", e);
  }
}

async function pasteAdminPhone() {
  try {
    const text = await navigator.clipboard.readText();
    const phoneInput = document.getElementById('admin-phone');
    if (phoneInput) phoneInput.value = text;
  } catch (e) {
    console.error("Failed to read clipboard:", e);
  }
}

async function saveQuickNoteWrapper() {
  console.log("saveQuickNoteWrapper called!");
  const noteInput = document.getElementById('note').value.trim();

  if (!noteInput) {
    alert('Please fill Note field!');
    return;
  }
  const finalDate = fmtDate(new Date());
  await saveQuickNote({ Agent: state.currentUser?.name, Date: finalDate, Note: noteInput, createdAt: Date.now(), lastRemindedAt: null });
}

async function saveQuickNote(data) {
  console.log("saveQuickNote called with data:", data);
  if (state.currentUser?.role !== 'worker') {
    console.log("Not a worker, returning!");
    return;
  }
  data.Agent = state.currentUser.name;
  const status = document.getElementById("status");
  try {
    let currentQuickNotes = cache.get('quick_notes_list') || [];
    const tempId = Date.now().toString();
    const tempNote = { ...data, id: tempId };
    currentQuickNotes.unshift(tempNote);
    cache.set('quick_notes_list', currentQuickNotes);
    state.quickNotes = currentQuickNotes;
    if (state.activeTab === 'quick-notes') {
      renderWorkerQuickNotes();
    }
    status.textContent = "Syncing...";
    status.style.color = "#3b82f6";
    let firestorePayload = { ...data };
    delete firestorePayload.id;
    await saveQuickNoteToFirestore(firestorePayload);
    const realId = firestorePayload.id;
    currentQuickNotes = cache.get('quick_notes_list') || [];
    const tempNoteIndex = currentQuickNotes.findIndex(n => n.id === tempId);
    if (tempNoteIndex !== -1) {
      currentQuickNotes[tempNoteIndex] = { ...currentQuickNotes[tempNoteIndex], id: realId };
      cache.set('quick_notes_list', currentQuickNotes);
      if (state.activeTab === 'quick-notes') {
        renderWorkerQuickNotes();
      }
    }
    status.textContent = "Saved!";
    status.style.color = "green";
    setTimeout(() => { if (status.textContent.includes("Saved")) status.textContent = ""; }, 3000);
  } catch (e) {
    console.error("Error in saveQuickNote:", e);
    status.textContent = "Saved locally, sync failed!";
    status.style.color = "orange";
  }
  document.getElementById("note").value = "";
  document.getElementById("note-date").value = "";
  document.getElementById("phone").value = "";
}

async function saveAdminQuickNote() {
  console.log("saveAdminQuickNote called!");
  const noteInput = document.getElementById('admin-note').value.trim();
  const statusEl = document.getElementById('admin-status');

  if (!noteInput) {
    alert('Please fill Note field!');
    return;
  }
  const finalDate = fmtDate(new Date());
  let currentQuickNotes = cache.get('quick_notes_list') || [];
  const savePayload = { Agent: "Sabbir", Date: finalDate, Note: noteInput, createdAt: Date.now(), lastRemindedAt: null };
  const tempId = Date.now().toString();
  const tempNote = { ...savePayload, id: tempId };
  currentQuickNotes.unshift(tempNote);
  cache.set('quick_notes_list', currentQuickNotes);
  state.quickNotes = currentQuickNotes;
  if (state.adminActiveSection === 'quick-notes') {
    renderAdminQuickNotes();
  }
  statusEl.textContent = "Syncing...";
  statusEl.style.color = "#3b82f6";
  try {
    let firestorePayload = { ...savePayload };
    delete firestorePayload.id;
    await saveQuickNoteToFirestore(firestorePayload);
    const realId = firestorePayload.id;
    currentQuickNotes = cache.get('quick_notes_list') || [];
    const tempNoteIndex = currentQuickNotes.findIndex(n => n.id === tempId);
    if (tempNoteIndex !== -1) {
      currentQuickNotes[tempNoteIndex] = { ...currentQuickNotes[tempNoteIndex], id: realId };
      cache.set('quick_notes_list', currentQuickNotes);
      if (state.adminActiveSection === 'quick-notes') {
        renderAdminQuickNotes();
      }
    }
    statusEl.textContent = "Saved!";
    statusEl.style.color = "green";
    if (state.adminActiveSection === 'quick-notes') {
      renderAdminQuickNotes();
    }
  } catch (e) {
    statusEl.textContent = "Saved locally, sync failed!";
    statusEl.style.color = "orange";
  }
  setTimeout(() => statusEl.textContent = "", 3000);
  document.getElementById('admin-note').value = "";
  document.getElementById('admin-note-date').value = "";
  document.getElementById('admin-phone').value = "";
}

function renderAdminQuickNotes() {
  const allQuickNotes = cache.get('quick_notes_list') || [];
  const adminQuickNotes = allQuickNotes.filter(note => note.Agent === "Sabbir");
  const container = document.getElementById('admin-quick-notes-container');
  if (!container) return;
  const headerHtml = `
    <div class="list-header">
      <div class="list-title">My Quick Notes</div>
      <div class="header-right-group">
        <span class="count">${adminQuickNotes.length}</span>
      </div>
    </div>`;
  if (!adminQuickNotes.length) {
    container.innerHTML = headerHtml + '<div class="empty">No Quick Notes</div>';
    return;
  }
  container.innerHTML = headerHtml + `
    <div class="cards-container">
      ${adminQuickNotes.map((note, index) => renderQuickNoteCard(note, index + 1)).join('')}
    </div>`;
}

function renderWorkerQuickNotes() {
  if (!state.currentUser) return;
  const allQuickNotes = cache.get('quick_notes_list') || [];
  const workerQuickNotes = allQuickNotes.filter(note => note.Agent === state.currentUser.name);
  const container = document.getElementById('worker-quick-notes-view');
  if (!container) return;
  const headerHtml = `
    <div class="list-header">
      <div class="list-title">My Quick Notes</div>
      <div class="header-right-group">
        <span class="count">${workerQuickNotes.length}</span>
      </div>
    </div>`;
  if (!workerQuickNotes.length) {
    container.innerHTML = headerHtml + '<div class="empty">No Quick Notes</div>';
    return;
  }
  container.innerHTML = headerHtml + `
    <div class="cards-container">
      ${workerQuickNotes.map((note, index) => renderQuickNoteCard(note, index + 1)).join('')}
    </div>`;
}

// Delete a single quick note manually
async function deleteQuickNote(id, event) {
  if (event) event.stopPropagation();
  if (!confirm('Sure you want to delete this quick note?')) return;
  await deleteQuickNotesFromFirestore([id]);
  renderAdminQuickNotes();
  renderWorkerQuickNotes();
  renderAllWorkersQuickNotes();
}

function renderQuickNoteCard(note, index) {
  const remaining = getRemainingTime(note.createdAt);
  if (remaining.expired) return '';

  return `
    <div class="note-card" onclick="showFullQuickNote('${note.id}', event)">
      <div class="card-top">
        <div style="display: flex; gap: 12px; align-items: flex-start; flex: 1;">
          <div style="display: flex; justify-content: space-between; width: 100%; gap: 16px;">
            <span class="card-number">#${index}</span>
            <span class="card-date">${fmtDisplayDate(note.Date)}</span>
          </div>
        </div>
        <div class="card-actions" style="gap: 4px;">
          <button class="icon-btn" onclick="deleteQuickNote('${note.id}', event)" style="padding: 4px; border-radius: 4px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
      <div style="font-size: 12px; color: ${remaining.isHourCountdown ? '#f59e0b' : '#9ca3af'}; margin-bottom: 8px;">
        ${remaining.text}
      </div>
      <div class="card-note">${note.Note || "No content"}</div>
    </div>`;
}

function showFullQuickNote(id, event) {
  if (event) event.stopPropagation();
  const allQuickNotes = cache.get('quick_notes_list') || [];
  const quickNote = allQuickNotes.find(i => i.id === id);
  if (!quickNote) return;
  const modal = document.getElementById("note-modal");
  document.getElementById("modal-body").textContent = quickNote.Note || "No content";
  document.getElementById("modal-date").textContent = `Date: ${fmtDisplayDate(quickNote.Date)}`;
  document.getElementById("modal-phone").textContent = `Agent: ${quickNote.Agent || "N/A"}`;
  modal.classList.remove("hidden");
}

// ------------------------------
// INITIALIZATION
// ------------------------------

async function init() {
  console.log("init function STARTED!");
  hydrateWorkersForLogin();
  attachAccessCodeListeners();
  attachAppEventListeners();
  showAccessScreen();

  try {
    // Request notification permission
    await requestNotificationPermission();
    console.log("requestNotificationPermission() completed!");
    // Load workers
    await initWorkers();
    console.log("initWorkers() completed!");
    // Load quick notes
    await getAllQuickNotes();
    console.log("getAllQuickNotes() completed!");
    // Start Quick Note reminder check every minute
    setInterval(checkQuickNoteReminders, 60 * 1000); // Check every 60 seconds
    console.log("Quick Note reminder interval started!");
    // Delete expired quick notes
    await deleteExpiredQuickNotes();
    // Check and delete expired quick notes every hour
    setInterval(deleteExpiredQuickNotes, 60 * 60 * 1000); // Every hour
    // Update quick note countdowns every minute
    setInterval(() => {
      renderAdminQuickNotes();
      renderWorkerQuickNotes();
      renderAllWorkersQuickNotes();
    }, 60 * 1000); // Every minute
    // Check saved login
  const savedLogin = localStorage.getItem('evernote_login');
  if (savedLogin) {
    try {
      const { user, timestamp } = JSON.parse(savedLogin);
      // Check if login is less than 5 hours old
      if (Date.now() - timestamp < 5 * 60 * 60 * 1000) {
        state.currentUser = user;
        if (user.role === 'admin') {
          showAdminDashboard();
          return;
        } else {
          // Verify worker still exists
          const workerExists = state.workers.some(w => String(w.code) === String(user.code));
          if (workerExists) {
            showWorkerDashboard();
            return;
          }
        }
      }
    } catch (e) {
      console.error("Error parsing saved login:", e);
    }
  }
  console.log("init function COMPLETED successfully!");
  } catch (e) {
    console.error("ERROR in init function!", e);
  }
}

// Run init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
