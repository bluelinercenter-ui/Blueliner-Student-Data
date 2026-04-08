// Google Sheets Web App URL (Replace with your deployed script URL)
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxYcj48lP-24hzNwf_2K3WbDL6GwA8clUgECGp4gGJVGkyIPEGnQCU8xN7K2GcNc3BZuw/exec";

const state={priority:false,activeTab:"today",editingId:null,selectedIds:new Set(),todayItems:[],allItems:[],searchVisible:false}

// LocalStorage Helper
const cache = {
  set: (key, data) => localStorage.setItem(key, JSON.stringify({ data, time: Date.now() })),
  get: (key) => {
    const val = localStorage.getItem(key);
    if (!val) return null;
    try {
      const parsed = JSON.parse(val);
      // যদি অবজেক্টে ডাটা এবং টাইম থাকে (পুরানো ক্যাশ)
      if (parsed && parsed.data !== undefined) return parsed.data;
      return parsed; // নতুন ফরম্যাটে সরাসরি ডাটা
    } catch(e) { return null; }
  }
};

function fmtDate(d){
  const x = new Date(d);
  if (isNaN(x.getTime())) return "";
  const year = x.getFullYear();
  const month = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fmtDisplayDate(d){
  if(!d) return "";
  const x = new Date(d);
  if (isNaN(x.getTime())) return d;
  const day = x.getDate();
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const month = months[x.getMonth()];
  const year = String(x.getFullYear()).slice(-2);
  return `${day} ${month}, ${year}`;
}
function todayStr(){return fmtDate(new Date())}
function uniquePhones(items){const s=new Set;items.forEach(i=>{if(i.Number)s.add(i.Number)});return Array.from(s)}

async function callSheets(action, payload = {}) {
  const url = `${SCRIPT_URL}`;
  console.log(`📡 Sending to Sheets: ${action}`, payload);
  
  try {
    const params = new URLSearchParams({ action });
    
    // সব পেলোড প্যারামিটার হিসেবে যোগ করা
    for (let key in payload) {
      if (typeof payload[key] === 'object') {
        params.set(key, JSON.stringify(payload[key]));
      } else {
        params.set(key, payload[key]);
      }
    }

    const finalUrl = `${url}?${params.toString()}`;
    console.log("🔗 Full URL:", finalUrl);

    // GET রিকোয়েস্ট (no-cors মোডে স্ট্যাটাস কোড পড়া যায় না, কিন্তু ডাটা পৌঁছে যায়)
    await fetch(finalUrl, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-cache'
    });
    
    return { ok: true };
  } catch (e) {
    console.error("❌ Sheets Error:", e);
    return { ok: false, error: e.message };
  }
}

async function saveRemote(payload){
  return await callSheets('save', payload);
}

async function listRemote(useCache = true){
  if (useCache) {
    const cachedData = cache.get('notes_list');
    if (cachedData) {
      console.log("Using cached data...");
      return { items: cachedData, fromCache: true };
    }
  }
  
  console.log("Fetching from Google Sheets...");
  try {
    const response = await fetch(`${SCRIPT_URL}?action=list`);
    const data = await response.json();
    cache.set('notes_list', data);
    return { items: data || [] };
  } catch (e) {
    console.error("Fetch error:", e);
    // এরর হলেও লোকাল ক্যাশ ফেরত দেওয়া যাতে অ্যাপ কাজ করে
    const local = cache.get('notes_list');
    return { items: local || [] };
  }
}

async function saveNote(data){
  const status = document.getElementById("status");
  try {
    status.textContent = "Saved locally! Syncing with Sheets...";
    status.style.color = "#3b82f6";
    
    // ১. লোকাল ডাটা আপডেট করা (Optimistic UI)
    let currentNotes = cache.get('notes_list') || [];
    let isNew = false;
    if (data.sheetIndex !== undefined) {
      // এডিট মোড
      const idx = currentNotes.findIndex(n => n.sheetIndex === data.sheetIndex);
      if (idx !== -1) currentNotes[idx] = data;
    } else {
      // নতুন নোট - অস্থায়ী ইনডেক্স দেওয়া
      isNew = true;
      data.sheetIndex = Date.now(); 
      currentNotes.unshift(data); // উপরে নতুন নোট যোগ করা
    }
    cache.set('notes_list', currentNotes);
    
    // ২. তৎক্ষণাৎ UI রিফ্রেশ করা
    await refresh(true); 

    // নতুন নোটে এনিমেশন ইফেক্ট দেওয়া
    if (isNew) {
      // একটু সময় নিয়ে এনিমেশন ক্লাস যোগ করা যাতে ব্রাউজার রেন্ডারিং ঠিকমতো ধরে
      setTimeout(() => {
        const firstCard = document.querySelector('.cards-container .note-card:first-child');
        if (firstCard) {
          firstCard.classList.add('animate-new-note');
        }
      }, 50);
    }

    // ৩. ব্যাকগ্রাউন্ডে গুগল শিটে সেভ করা
    callSheets('save', data).then(() => {
      // সেভ হওয়ার পর শিট থেকে লেটেস্ট ডাটা নিয়ে আসা
      status.textContent = "Synced with Google Sheets!";
      status.style.color = "green";
      setTimeout(() => { if(status.textContent.includes("Synced")) status.textContent = ""; }, 3000);
      refresh(false); // শিট থেকে ফ্রেশ ডাটা ফেচ করে ক্যাশ আপডেট করবে
    }).catch(err => {
      status.textContent = "Sync failed, but saved on phone.";
      status.style.color = "orange";
    });

    return { ok: true };
  } catch(e) {
    status.textContent = "Error: " + e.message;
    status.style.color = "red";
    return { ok: false, error: e.message };
  }
}

async function deleteSelected() {
  if (state.selectedIds.size === 0) {
    alert("Please select at least one note to delete.");
    return;
  }
  
  if (!confirm(`Are you sure you want to delete ${state.selectedIds.size} selected note(s)?`)) return;
  
  const status = document.getElementById("status");
  status.textContent = "Deleting locally...";
  status.style.color = "blue";
  
  try {
    const indices = Array.from(state.selectedIds);
    
    // ডিলিট এনিমেশন অ্যাপ্লাই করা
    const cards = document.querySelectorAll('.note-card');
    cards.forEach(card => {
      const checkbox = card.querySelector('input[type="checkbox"]');
      if (checkbox && state.selectedIds.has(Number(checkbox.dataset.index))) {
        card.classList.add('animate-delete');
      }
    });

    // এনিমেশন শেষ হওয়ার জন্য সামান্য অপেক্ষা করা
    await new Promise(resolve => setTimeout(resolve, 450));

    // ১. লোকাল থেকে ডিলিট করা (Optimistic UI)
    let currentNotes = cache.get('notes_list') || [];
    currentNotes = currentNotes.filter(n => !state.selectedIds.has(n.sheetIndex));
    cache.set('notes_list', currentNotes);
    state.selectedIds.clear();
    await refresh(true); // লোকাল ডাটা দিয়ে দ্রুত আপডেট
    
    // ২. ব্যাকগ্রাউন্ডে গুগল শিটে ডিলিট করা
    callSheets('deleteBulk', { sheetIndices: indices }).then(() => {
      status.textContent = "Deleted from Google Sheets!";
      status.style.color = "green";
      setTimeout(() => { if(status.textContent.includes("Deleted")) status.textContent = ""; }, 3000);
      refresh(false); // শিট থেকে ফ্রেশ ডাটা নিয়ে আসবে
    }).catch(err => {
      status.textContent = "Delete failed on Sheets, but updated on phone.";
      status.style.color = "orange";
    });
    
  } catch(e) {
    console.error("Delete failed:", e);
    status.textContent = "Delete failed: " + e.message;
    status.style.color = "red";
  }
}

function toggleSelect(sheetIndex) {
  if (state.selectedIds.has(sheetIndex)) {
    state.selectedIds.delete(sheetIndex);
  } else {
    state.selectedIds.add(sheetIndex);
  }
  
  // সঠিক লিস্ট ব্যবহার করে রেন্ডার করা
  if (state.activeTab === 'today') {
    renderList(state.todayItems, "today-view");
  } else {
    renderList(state.allItems, "all-view");
  }
}

async function editNote(sheetIndex) {
  // Find the note to edit by its sheetIndex - use cache for speed
  const res = await listRemote(true);
  const allNotes = res.items || [];
  const note = allNotes.find(i => i.sheetIndex === sheetIndex);
  if (!note) return;

  // তারিখটি ইনপুট ফিল্ডের জন্য সেট করা
  if (note.Date) {
    document.getElementById("note-date").value = fmtDate(note.Date);
  }
  
  document.getElementById("phone").value = note.Number;
  document.getElementById("note").value = note.Note;

  // এডিট করার সময় ডুপ্লিকেট ওয়ার্নিং হাইড করা
  const warningDiv = document.getElementById("duplicate-warning");
  if (warningDiv) warningDiv.classList.add("hidden");
  
  // Set editing state
  state.editingId = sheetIndex; 
  const saveBtn = document.getElementById("save");
  saveBtn.textContent = "Update Note";
  saveBtn.classList.add("editing");
  
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function listNotes(type, useCache = true){
  let items = [];
  try {
    const res = await listRemote(useCache);
    items = res.items || [];
  } catch(e) {
    console.error("List fetch error:", e);
    items = [];
  }

  // Sort by Date
  const combined = [...items];
  combined.sort((a, b) => new Date(a.Date) - new Date(b.Date));

  if(type === 'today') {
    const t = todayStr();
    return combined.filter(i => {
      if (!i.Date) return false;
      // ডাটা শিটে যে ফরম্যাটেই থাকুক (ISO বা অন্য কিছু), সেটিকে YYYY-MM-DD ফরম্যাটে নিয়ে এসে চেক করা
      return fmtDate(i.Date) === t;
    });
  }
  return combined;
}
function renderPhones(items){const dl=document.getElementById("phone-suggestions");dl.innerHTML="";uniquePhones(items).slice(0,50).forEach(p=>{const o=document.createElement("option");o.value=p;dl.appendChild(o)})}
function renderList(items, container) {
  const el = document.getElementById(container);
  if (!el) return;

  // ডাটা সেভ করা যাতে পরবর্তীতে রি-রেন্ডার করা যায়
  if (container === "today-view") {
    state.todayItems = items;
  } else {
    state.allItems = items;
  }

  // ফিল্টারিং লজিক (শুধুমাত্র All Notes সেকশনের জন্য)
  const searchQuery = state.searchQuery || "";
  let filteredItems = items;
  if (container === "all-view" && searchQuery) {
    filteredItems = items.filter(i => {
      const num = i.Number ? String(i.Number) : "";
      return num.includes(searchQuery);
    });
  }

  // যদি কন্টেইনার খালি থাকে বা সার্চ রি-রেন্ডার করতে হয়
  const isAllView = container === "all-view";
  const hasHeader = el.querySelector('.list-header');

  // যদি হেডার না থাকে বা অল ভিউতে বড় কোনো পরিবর্তন হয়, পুরোটা রেন্ডার হবে
  if (!hasHeader || isAllView) {
    const headerHtml = `
      <div class="list-header ${isAllView ? 'header-compact' : ''}">
        ${container === "today-view" ? `<div class="list-title">Today’s Notes</div>` : ""}
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
            <button class="delete-all-btn" onclick="deleteSelected()" title="Delete Selected">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
          </div>
        </div>
      </div>`;

    const cardsHtml = filteredItems.length ? `
      <div class="cards-container">
        ${filteredItems.map(i => renderNoteCard(i)).join("")}
      </div>` : `<div class="empty">${isAllView ? "No Notes Found" : "No Notes For Today"}</div>`;

    el.innerHTML = headerHtml + cardsHtml;

    if (isAllView) {
      attachSearchListener();
      // সার্চ ইনপুটে কার্সর পজিশন ঠিক রাখা
      const input = document.getElementById("search-input");
      if (input && state.searchVisible) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  } else {
    // হেডার আপডেট না করে শুধু কার্ড এবং কাউন্ট আপডেট করা
    const countEl = el.querySelector('.count');
    if (countEl) countEl.textContent = filteredItems.length;

    const cardsContainer = el.querySelector('.cards-container');
    const emptyEl = el.querySelector('.empty');

    if (filteredItems.length) {
      const cardsHtml = filteredItems.map(i => renderNoteCard(i)).join("");
      if (cardsContainer) {
        cardsContainer.innerHTML = cardsHtml;
      } else {
        // যদি আগে empty থাকতো, তবে cards-container তৈরি করতে হবে
        if (emptyEl) emptyEl.remove();
        const newCardsContainer = document.createElement('div');
        newCardsContainer.className = 'cards-container';
        newCardsContainer.innerHTML = cardsHtml;
        el.appendChild(newCardsContainer);
      }
    } else {
      if (cardsContainer) cardsContainer.remove();
      if (!emptyEl) {
        const newEmpty = document.createElement('div');
        newEmpty.className = 'empty';
        newEmpty.textContent = container === "today-view" ? "No Notes For Today" : "No Notes Found";
        el.appendChild(newEmpty);
      }
    }
  }
}

// আলাদা ফাংশন যাতে কোড ডুপ্লিকেট না হয়
function renderNoteCard(i) {
  const isSelected = state.selectedIds.has(i.sheetIndex);
  return `
    <div class="note-card ${isSelected ? 'selected-row' : ''}" onclick="showFullNote(${i.sheetIndex}, event)">
      <div class="card-top">
        <div style="display: flex; gap: 12px; align-items: center;">
          <label class="custom-checkbox" onclick="event.stopPropagation();">
            <input type="checkbox" data-index="${i.sheetIndex}" ${isSelected ? 'checked' : ''} onchange="toggleSelect(${i.sheetIndex})">
            <span class="checkmark"></span>
          </label>
          <div class="card-info">
            <span class="card-date">${fmtDisplayDate(i.Date)}</span>
            <span class="card-phone">${i.Number || "No Number"}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="edit-btn-icon" title="Edit Note" onclick="event.stopPropagation(); editNote(${i.sheetIndex})">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
        </div>
      </div>
      <div class="card-note">${i.Note || "No content"}</div>
    </div>`;
}

function showFullNote(sheetIndex, event) {
  // Don't show modal if clicking checkbox or edit button
  if (event.target.closest('.note-checkbox') || event.target.closest('.edit-btn')) return;

  // Find in all items
  const note = (state.allItems || []).find(i => i.sheetIndex === sheetIndex);
  if (!note) return;

  const modal = document.getElementById("note-modal");
  const modalBody = document.getElementById("modal-body");
  const modalDate = document.getElementById("modal-date");
  const modalPhone = document.getElementById("modal-phone");

  modalBody.textContent = note.Note;
  modalDate.textContent = fmtDisplayDate(note.Date);
  modalPhone.textContent = note.Number;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden"; // Prevent scrolling
}

function closeModal() {
  const modal = document.getElementById("note-modal");
  modal.classList.add("hidden");
  document.body.style.overflow = "auto";
}

function toggleSearchBar() {
  state.searchVisible = !state.searchVisible;
  renderList(state.allItems || [], "all-view");
  if (state.searchVisible) {
    setTimeout(() => {
      const input = document.getElementById("search-input");
      if (input) input.focus();
    }, 100);
  } else {
    state.searchQuery = ""; // বন্ধ করার সময় সার্চ ক্লিয়ার করা
    renderList(state.allItems || [], "all-view");
  }
}

function attachSearchListener() {
  const searchInput = document.getElementById("search-input");
  if (searchInput && !searchInput.dataset.listenerAttached) {
    searchInput.dataset.listenerAttached = "true";
    
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value.trim();
      // শুধুমাত্র কার্ডগুলো আপডেট করবে, হেডার নয়
      renderList(state.allItems || [], "all-view");
    });
  }
}
function setTab(name){
  state.activeTab=name;
  document.getElementById("tab-today").classList.toggle("active",name==="today");
  document.getElementById("tab-all").classList.toggle("active",name==="all");
  document.getElementById("today-view").classList.toggle("hidden",name!=="today");
  document.getElementById("all-view").classList.toggle("hidden",name!=="all");
  
  // ট্যাব পরিবর্তনের সময় সেই ট্যাবের ডাটা রিফ্রেশ করা
  refresh(true);
}

async function refresh(useCache = true){
  if (state.activeTab === 'today') {
    const today = await listNotes('today', useCache);
    renderList(today, "today-view");
  } else {
    const all = await listNotes('all', useCache);
    state.allItems = all; // গ্লোবাল স্টেটে অল নোট রাখা যাতে সার্চ করা যায়
    renderPhones(all); // ফোন সাজেশন অল নোট থেকে আসবে
    renderList(all, "all-view");
  }
}

// নাম্বার টাইপ করার সময় ডুপ্লিকেট চেক করা
function checkDuplicate(input) {
  const warningDiv = document.getElementById("duplicate-warning");
  if (!warningDiv) return;

  if (!input || input.length < 5) {
    warningDiv.classList.add("hidden");
    return;
  }

  // ক্লিন নাম্বার (স্পেস, হাইফেন, +88 এবং শুরুর 0 রিমুভ করা)
  const clean = (val) => {
    let s = String(val).replace(/[^\d+]/g, '');
    if (s.startsWith('+88')) s = s.substring(3);
    else if (s.startsWith('88')) s = s.substring(2);
    s = s.replace(/\D/g, '');
    if (s.startsWith('0')) s = s.substring(1); // শুরুর 0 বাদ দেওয়া যাতে 019... আর 19... একই ধরা হয়
    return s;
  };

  const cleanInput = clean(input);
  const allNotes = state.allItems || [];
  
  const match = allNotes.find(n => {
    if (!n.Number) return false;
    const sheetNum = clean(n.Number);
    // যদি ইনপুট করা নাম্বার শিটের নাম্বারের সাথে পুরোপুরি মিলে যায় 
    // অথবা ইনপুটের শেষ ১০ ডিজিট শিটের নাম্বারের সাথে মিলে যায়
    return sheetNum === cleanInput || 
           (cleanInput.length >= 10 && sheetNum.includes(cleanInput.slice(-10))) ||
           (sheetNum.length >= 10 && cleanInput.includes(sheetNum.slice(-10)));
  });

  if (match) {
    warningDiv.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>Similar note exists (${match.Number})</span>
      <button onclick="showFullNote(${match.sheetIndex}, event)" style="background:none; border:none; color:var(--primary); cursor:pointer; font-size:12px; font-weight:600; padding:0; margin-left:auto; text-decoration:underline;">View Note</button>
    `;
    warningDiv.classList.remove("hidden");
  } else {
    warningDiv.classList.add("hidden");
  }
}

function init(){
  // Remove priority toggle logic since it's not used
  const star = document.getElementById("star");
  if (star) star.style.display = "none";

  // By default, no date selected
  const noteDate = document.getElementById("note-date");
  if (noteDate) noteDate.value = "";

  document.getElementById("tab-today").addEventListener("click", () => setTab("today"));
  document.getElementById("tab-all").addEventListener("click", () => setTab("all"));
  
  // Modal event listeners
  const closeBtn = document.getElementById("close-modal");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  
  const modal = document.getElementById("note-modal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }
  
  const pasteBtn = document.getElementById("paste-phone");
  if (pasteBtn) {
    pasteBtn.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          // কোনো ফিল্টার বা লিমিট ছাড়া সরাসরি যা কপি করা আছে তা পেস্ট হবে
          const phoneInput = document.getElementById("phone");
          phoneInput.value = text.trim();
          // পেস্ট করার পর চেক করা
          checkDuplicate(text.trim());
        }
      } catch (err) {
        console.error('Failed to read clipboard contents: ', err);
        // অনেক সময় ব্রাউজার পারমিশন চায়, তাই সরাসরি ইনপুট বক্সে ফোকাস করে পেস্ট করার চেষ্টা করতে পারে ইউজার
        document.getElementById("phone").focus();
      }
    });
  }

  // নাম্বার টাইপ করার সময় ডুপ্লিকেট চেক করা
  const phoneInput = document.getElementById("phone");
  if (phoneInput) {
    phoneInput.addEventListener("input", (e) => {
      checkDuplicate(e.target.value.trim());
    });
  }
  
  document.getElementById("save").addEventListener("click",async()=>{
    const phoneInput=document.getElementById("phone").value.trim();
    const note=document.getElementById("note").value.trim();
    const noteDateInput = document.getElementById("note-date").value;
    
    // ফোন নাম্বার ক্লিন করার লজিক (স্পেস, হাইফেন, +88 রিমুভ করা)
    let phone = phoneInput.replace(/[^\d+]/g, ''); // শুধু ডিজিট এবং '+' রাখা
    if (phone.startsWith('+88')) {
      phone = phone.substring(3);
    } else if (phone.startsWith('88')) {
      phone = phone.substring(2);
    }
    phone = phone.replace(/\D/g, ''); // বাকি সব নন-ডিজিট (যদি থাকে) রিমুভ করা
    
    // Validation: Only Number and Note are required
    if(!phone || !note) {
      alert("Please fill Number and Note fields!");
      return;
    }
    
    document.getElementById("save").disabled=true;
    
    // তারিখটি স্ট্যান্ডার্ড ফরম্যাটে (YYYY-MM-DD) রাখা যাতে শিটে সঠিকভাবে জমা হয়
    const finalDate = noteDateInput || fmtDate(new Date());

    const payload = {
      Date: finalDate,
      Number: phone,
      Note: note
    };

    // একই নাম্বারের নোট আগে থেকে আছে কিনা তা চেক করা (যদি নতুন নোট হিসেবে সেভ করা হয়)
    if (state.editingId === null) {
      const res = await listRemote(true); // ক্যাশ থেকে দ্রুত লিস্ট পাওয়া
      const existingNote = res.items.find(n => n.Number === phone);
      if (existingNote) {
        payload.sheetIndex = existingNote.sheetIndex; // আগের নোটের ইনডেক্স ব্যবহার করা যাতে সেটি রিপ্লেস হয়
      }
    } else {
      // যদি ইউজার এডিট বাটনে ক্লিক করে এডিট করতে চায়
      payload.sheetIndex = state.editingId;
    }

    const result = await saveNote(payload);
    
    state.editingId = null;
    const saveBtn = document.getElementById("save");
    saveBtn.textContent = "Save Note";
    saveBtn.classList.remove("editing");

    document.getElementById("save").disabled=false;
    document.getElementById("note").value="";
    document.getElementById("phone").value="";
    document.getElementById("note-date").value=""; // Clear date after save
    
    // ডুপ্লিকেট ওয়ার্নিং হাইড করা
    const warningDiv = document.getElementById("duplicate-warning");
    if (warningDiv) warningDiv.classList.add("hidden");
    
    setTab("today")
  });
  
  // ১. লোকাল ডাটা দিয়ে দ্রুত শুরু করা
  refresh(true);
  
  // ২. ব্যাকগ্রাউন্ডে গুগল শিট থেকে লেটেস্ট ডাটা নেওয়া
  setTimeout(() => refresh(false), 1000);
}
document.addEventListener("DOMContentLoaded",init)
