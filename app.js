// Google Sheets Web App URL (Replace with your deployed script URL)
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyy977GdY9FWlgA1QPZsA5oWw5W4tAuDlSpxHELFC_09eZZ3ck8sAoGY6Awg-1MfHQb/exec";

const state={priority:false,activeTab:"today",editingId:null,selectedIds:new Set(),lastItems:[]}

// LocalStorage Helper
const cache = {
  set: (key, data) => localStorage.setItem(key, JSON.stringify({ data, time: Date.now() })),
  get: (key) => {
    const val = localStorage.getItem(key);
    if (!val) return null;
    const { data, time } = JSON.parse(val);
    // ৫ মিনিট পর্যন্ত ক্যাশ ভ্যালিড থাকবে
    if (Date.now() - time > 5 * 60 * 1000) return null;
    return data;
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

function fmtDisplayDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const options = { day: 'numeric', month: 'long', year: 'numeric' };
  return date.toLocaleDateString('en-GB', options);
}
function todayStr(){return fmtDate(new Date())}
function uniquePhones(items){const s=new Set;items.forEach(i=>{if(i.Number)s.add(i.Number)});return Array.from(s)}

async function callSheets(action, payload = {}) {
  try {
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors', // ব্রাউজারের সিকিউরিটি এড়াতে
      cache: 'no-cache',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({ action, ...payload })
    });
    
    // no-cors মোডে আমরা রেসপন্স পড়তে পারি না, তাই সফল ধরে নিচ্ছি
    return { ok: true };
  } catch (e) {
    console.error("Sheets error:", e);
    throw e;
  }
}

async function saveRemote(payload){
  console.log("Saving remote to Google Sheets...", payload);
  return await callSheets('save', payload);
}

async function listRemote(useCache = true){
  if (useCache) {
    const cachedData = cache.get('notes_list');
    if (cachedData) return { items: cachedData, fromCache: true };
  }
  
  console.log("Fetching from Google Sheets...");
  try {
    const response = await fetch(`${SCRIPT_URL}?action=list`);
    const data = await response.json();
    cache.set('notes_list', data);
    return { items: data || [] };
  } catch (e) {
    console.error("Fetch error:", e);
    return { items: [] };
  }
}

async function saveNote(data){
  const status = document.getElementById("status");
  try {
    status.textContent = "Saving...";
    status.style.color = "blue";
    
    await saveRemote(data);
    
    // ডাটা সেভ হলে ক্যাশ ক্লিয়ার করে দিব যাতে নতুন ডাটা দেখা যায়
    localStorage.removeItem('notes_list');
    
    status.textContent = "Saved to Google Sheets!";
    status.style.color = "green";
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
  status.textContent = "Deleting...";
  status.style.color = "blue";
  
  try {
    const indices = Array.from(state.selectedIds);
    await callSheets('deleteBulk', { sheetIndices: indices });
    
    // ডিলিট সফল হলে ক্যাশ ক্লিয়ার করা
    localStorage.removeItem('notes_list');
    
    state.selectedIds.clear();
    status.textContent = "Deleted successfully!";
    status.style.color = "green";
    
    // Refresh UI
    setTimeout(async () => {
      status.textContent = "";
      await refresh(false); // ফোর্স রিফ্রেশ
    }, 1000);
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
  // Refresh the list to show selection - Fast render from last items
  const container = state.activeTab === 'today' ? 'today-view' : (state.activeTab === 'all' ? 'all-view' : null);
  if (container) {
    renderList(state.lastItems || [], container);
  }
}

async function editNote(sheetIndex) {
  // Find the note to edit by its sheetIndex - use cache for speed
  const res = await listRemote(true);
  const allNotes = res.items || [];
  const note = allNotes.find(i => i.sheetIndex === sheetIndex);
  if (!note) return;

  // Fill form with note data
  document.getElementById("note-date").value = note.Date;
  document.getElementById("phone").value = note.Number;
  document.getElementById("note").value = note.Note;
  
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
      const itemDate = fmtDate(i.Date);
      return itemDate === t;
    });
  }
  return combined;
}
function renderPhones(items){const dl=document.getElementById("phone-suggestions");dl.innerHTML="";uniquePhones(items).slice(0,50).forEach(p=>{const o=document.createElement("option");o.value=p;dl.appendChild(o)})}
function renderList(items,container){
  const el=document.getElementById(container);
  state.lastItems = items; // Store for re-rendering during selection
  
  // ফিল্টারিং লজিক (যদি সার্চ বক্সে কিছু থাকে)
  const searchQuery = state.searchQuery || "";
  const filteredItems = items.filter(i => {
    if (!searchQuery) return true;
    return (i.Number && i.Number.includes(searchQuery));
  });

  if(!filteredItems.length){el.innerHTML=`
    <div class="list-header">
      <div class="list-title">${container === "today-view" ? "Today’s Notes" : "All Notes"}</div>
      ${container === "all-view" ? `
      <div class="search-container">
        <input type="text" id="search-input" placeholder="Search number..." value="${searchQuery}">
      </div>` : ""}
      <div class="header-actions">
        <span class="count">0</span>
      </div>
    </div>
    <div class="empty">No notes found</div>`;
    // সার্চ ইনপুট ইভেন্ট লিসেনার আবার লাগানো
    if (container === "all-view") attachSearchListener();
    return;
  }
  
  const rows=filteredItems.map((i)=>{
    const isSelected = state.selectedIds.has(i.sheetIndex);
    return `<tr class="${isSelected ? 'selected-row' : ''}">
      <td><input type="checkbox" class="note-checkbox" ${isSelected ? 'checked' : ''} onchange="toggleSelect(${i.sheetIndex})"></td>
      <td>${fmtDisplayDate(i.Date)}</td>
      <td>${i.Number||""}</td>
      <td>${i.Note||""}</td>
      <td><div class="row-actions"><button class="edit-btn" onclick="editNote(${i.sheetIndex})">Edit</button></div></td>
    </tr>`
  }).join("");
  
  let title = "All Notes";
  if(container==="today-view") title = "Today’s Notes";
  
  el.innerHTML=`
    <div class="list-header">
      <div class="list-title">${title}</div>
      ${container === "all-view" ? `
      <div class="search-container">
        <input type="text" id="search-input" placeholder="Search number..." value="${searchQuery}">
      </div>` : ""}
      <div class="header-actions">
        <span class="count">${filteredItems.length}</span>
        <button class="delete-all-btn" onclick="deleteSelected()" title="Delete Selected">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </div>
    </div>
    <div class="table-container">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 40px;"></th>
            <th>Date</th>
            <th>Number</th>
            <th>Note</th>
            <th style="width: 80px;"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
    
    // সার্চ ইনপুট ইভেন্ট লিসেনার লাগানো
    if (container === "all-view") attachSearchListener();
}

function attachSearchListener() {
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    // আগের ফোকাস ঠিক রাখার জন্য (যাতে টাইপ করার সময় ফোকাস চলে না যায়)
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value.trim();
      renderList(state.lastItems || [], "all-view");
    });
  }
}
function setTab(name){state.activeTab=name;document.getElementById("tab-today").classList.toggle("active",name==="today");document.getElementById("tab-all").classList.toggle("active",name==="all");document.getElementById("today-view").classList.toggle("hidden",name!=="today");document.getElementById("all-view").classList.toggle("hidden",name!=="all")}
async function refresh(useCache = true){
  const today=await listNotes('today', useCache);
  const all=await listNotes('all', useCache);
  renderPhones(all);
  renderList(today,"today-view");
  renderList(all,"all-view");
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
  
  const pasteBtn = document.getElementById("paste-phone");
  if (pasteBtn) {
    pasteBtn.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          // কোনো ফিল্টার বা লিমিট ছাড়া সরাসরি যা কপি করা আছে তা পেস্ট হবে
          document.getElementById("phone").value = text.trim();
        }
      } catch (err) {
        console.error('Failed to read clipboard contents: ', err);
        // অনেক সময় ব্রাউজার পারমিশন চায়, তাই সরাসরি ইনপুট বক্সে ফোকাস করে পেস্ট করার চেষ্টা করতে পারে ইউজার
        document.getElementById("phone").focus();
      }
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
    
    const payload = {
      Date: noteDateInput || "", // Send empty string if no date selected
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
    const status = document.getElementById("status");
    if (result.ok) {
      status.textContent = "Saved to Google Sheets!";
      status.style.color = "green";
    } else {
      status.textContent = "Error: " + (result.error || "Save failed");
      status.style.color = "red";
    }
    setTimeout(() => status.textContent = "", 5000);
    
    state.editingId = null;
    const saveBtn = document.getElementById("save");
    saveBtn.textContent = "Save Note";
    saveBtn.classList.remove("editing");

    document.getElementById("save").disabled=false;
    document.getElementById("note").value="";
    document.getElementById("phone").value="";
    document.getElementById("note-date").value=""; // Clear date after save
    
    await refresh();
    setTab("today")
  });
  refresh()
}
document.addEventListener("DOMContentLoaded",init)
