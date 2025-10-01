document.addEventListener('DOMContentLoaded', () => {

  // --- 상수 분리 ---
  const CONSTANTS = {
    TOAST_DURATION: 3000,
    DEFAULT_SESSION_PREFIX: '세션',
    TAB_CREATION_DELAY: 100,
    DANGEROUS_PROTOCOLS: ['javascript:', 'data:', 'file:', 'about:', 'chrome:'],
    CACHE_CAPACITY: 100,
    STORAGE_KEYS: {
      SESSIONS: 'sessions',
      DELAY: 'restoreDelay',
      RESTORE_TARGET: 'restoreTarget'
    },
    ACTIONS: {
      RESTORE: 'restore',
      COPY: 'copy', // [NEW] 복사 액션 추가
      UPDATE: 'update',
      RENAME: 'rename',
      DELETE: 'delete'
    },
    RESTORE_TARGETS: {
      NEW_WINDOW: 'new-window',
      CURRENT_WINDOW: 'current-window'
    }
  };
  
  // --- [REVISED] 1. DOM 요소 ---
  const sessionInput = document.getElementById('session-input');
  const saveBtn = document.getElementById('save-session-btn');
  const sessionListEl = document.getElementById('session-list');
  const toastEl = document.getElementById('toast');

  // 메뉴바 요소
  const saveCurrentBtn = document.getElementById('save-current-btn');
  const importBtn = document.getElementById('import-btn');
  const importFileInput = document.getElementById('import-file-input');
  const exportBtn = document.getElementById('export-btn');
  const delayButtons = document.querySelectorAll('.delay-btn');
  const restoreTargetButtons = document.querySelectorAll('.restore-target-btn');

  // --- 2. 상태 관리 ---
  let allSessions = [];
  let toastTimeout;
  let selectedDelay = 0;
  let selectedRestoreTarget; 

  // --- 6.2 LRU Cache 구현 ---
  class LRUCache {
    constructor(capacity) {
      this.capacity = capacity;
      this.cache = new Map();
    }
    get(key) {
      if (!this.cache.has(key)) return null;
      const value = this.cache.get(key);
      this.cache.delete(key); this.cache.set(key, value);
      return value;
    }
    set(key, value) {
      if (this.cache.has(key)) this.cache.delete(key);
      else if (this.cache.size >= this.capacity) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, value);
    }
    clear() { this.cache.clear(); }
  }
  const sessionCache = new LRUCache(CONSTANTS.CACHE_CAPACITY);

  // --- 3. Chrome API 추상화 ---
  const storage = {
    get: async (key, defaultValue = []) => {
      if (key !== CONSTANTS.STORAGE_KEYS.SESSIONS) return (await chrome.storage.local.get(key))[key] ?? defaultValue;
      const cached = sessionCache.get(key);
      if (cached !== null) return cached;
      const result = (await chrome.storage.local.get(key))[key] ?? defaultValue;
      sessionCache.set(key, result);
      return result;
    },
    set: async (key, value) => {
      try {
        if (key === CONSTANTS.STORAGE_KEYS.SESSIONS) sessionCache.set(key, value);
        await chrome.storage.local.set({ [key]: value });
      } catch (error) {
        console.error('Storage set error:', error);
        throw new Error('저장 공간이 부족하거나 쓰기 오류가 발생했습니다.');
      }
    },
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CONSTANTS.STORAGE_KEYS.SESSIONS]) {
      sessionCache.clear();
      allSessions = changes[CONSTANTS.STORAGE_KEYS.SESSIONS].newValue || [];
      renderSessions();
    }
  });

  // --- 4. 유틸리티 함수 ---
  const formatDate = (timestamp) => {
    const d = new Date(timestamp);
    const datePart = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    let hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? '오후' : '오전';
    hours %= 12;
    if (hours === 0) hours = 12;
    const timePart = `${ampm} ${hours}시 ${minutes}분`;
    return `${datePart} ${timePart}`;
  };
  const showToast = (message, duration = CONSTANTS.TOAST_DURATION) => {
    clearTimeout(toastTimeout);
    toastEl.textContent = message;
    toastEl.classList.add('show');
    toastTimeout = setTimeout(() => toastEl.classList.remove('show'), duration);
  };
  const escapeHtml = (str) => String(str).replace(/[&<>"'\/]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' }[s]));
  const isValidUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      return !CONSTANTS.DANGEROUS_PROTOCOLS.some(proto => parsed.protocol === proto);
    } catch { return false; }
  };
  const isValidSession = (session) => session && (typeof session.id === 'number' || typeof session.id === 'string') && typeof session.name === 'string' && session.name.length > 0 && session.name.length <= 200 && Array.isArray(session.tabs) && session.tabs.length > 0 && session.tabs.every(tab => tab && typeof tab.url === 'string' && isValidUrl(tab.url) && typeof tab.pinned === 'boolean');
  const isDuplicateSessionName = (name, excludeId = null) => allSessions.some(s => s.id !== excludeId && s.name === name);
  const generateUniqueId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // --- 5. UI 렌더링 ---
  const renderSessions = () => {
    const fragment = document.createDocumentFragment();
    const searchTerm = sessionInput.value.trim().toLowerCase();
    const filteredSessions = searchTerm ? allSessions.filter(s => s.name.toLowerCase().includes(searchTerm) || s.tabs.some(t => t.url.toLowerCase().includes(searchTerm))) : allSessions;

    if (filteredSessions.length === 0) {
      sessionListEl.innerHTML = `<p style="text-align:center; padding: 20px 0;">${allSessions.length === 0 ? "저장된 세션이 없습니다." : "검색 결과가 없습니다."}</p>`;
      return;
    }

    const sortedSessions = [...filteredSessions].sort((a, b) => (typeof b.id === 'string' ? parseInt(b.id.split('-')[0]) : b.id) - (typeof a.id === 'string' ? parseInt(a.id.split('-')[0]) : a.id));
    sortedSessions.forEach(session => fragment.appendChild(createSessionListItem(session)));
    sessionListEl.innerHTML = '';
    sessionListEl.appendChild(fragment);
  };
  
  // [MODIFIED] 3줄 레이아웃으로 변경 및 복사 버튼 추가
  const createSessionListItem = (session) => {
    const item = document.createElement('li');
    item.className = 'session-item';
    item.dataset.sessionId = session.id;
  
    const groupCount = new Set(session.tabs.map(t => t.groupId).filter(Boolean)).size;
    const sessionIdNum = typeof session.id === 'string' ? parseInt(session.id.split('-')[0]) : session.id;
    // [MODIFIED] 메타 정보를 3줄로 표시하기 위해 분리
    const dateMeta = formatDate(sessionIdNum);
    const countMeta = `탭: ${session.tabs.length}${groupCount > 0 ? `, 그룹: ${groupCount}` : ''}`;
    
    const safeSessionName = escapeHtml(session.name);
    const safeTabsHtml = session.tabs.map(t => `<li>${escapeHtml(t.url)}</li>`).join('');
  
    // [MODIFIED] 3줄 레이아웃 및 복사(📋) 버튼 추가, 버튼 순서 변경
    item.innerHTML = `
      <div class="session-header">
        <div class="session-info">
          <span class="session-name">${safeSessionName}</span>
          <span class="session-meta">${dateMeta}</span>
          <span class="session-meta">${countMeta}</span>
        </div>
        <div class="session-actions">
          <button class="beos-icon-button restore-btn" data-action="${CONSTANTS.ACTIONS.RESTORE}" title="복원(열기)">🚀</button>
          <button class="beos-icon-button copy-btn" data-action="${CONSTANTS.ACTIONS.COPY}" title="URL 복사">📋</button>
          <button class="beos-icon-button update-btn" data-action="${CONSTANTS.ACTIONS.UPDATE}" title="덮어쓰기">🔄</button>
          <button class="beos-icon-button rename-btn" data-action="${CONSTANTS.ACTIONS.RENAME}" title="이름 변경">✏️</button>
          <button class="beos-icon-button delete-btn" data-action="${CONSTANTS.ACTIONS.DELETE}" title="삭제">🗑️</button>
        </div>
      </div>
      <div class="session-details" style="display: none;">
        <ul class="session-details-list">${safeTabsHtml}</ul>
      </div>
    `;
    
    const sessionHeader = item.querySelector('.session-header');
    const sessionDetails = item.querySelector('.session-details');

    // 세부 목록 토글
    sessionHeader.addEventListener('click', (e) => {
      if (!e.target.closest('.beos-icon-button')) {
        sessionDetails.style.display = sessionDetails.style.display === 'block' ? 'none' : 'block';
      }
    });

    return item;
  };


  // --- 6. 핵심 로직 ---
  const getTabsToSave = async () => {
    try {
      const tabs = await chrome.tabs.query({});
      if (tabs.length === 0) return [];
      const windows = await chrome.windows.getAll();
      const allTabGroups = (await Promise.all(windows.map(w => chrome.tabGroups.query({ windowId: w.id })))).flat();
      const validTabs = tabs.filter(tab => tab.url && isValidUrl(tab.url));
      return validTabs.map(tab => ({ 
        url: tab.url, pinned: tab.pinned, groupId: tab.groupId,
        groupInfo: tab.groupId > -1 ? allTabGroups.find(g => g.id === tab.groupId) : null,
        windowId: tab.windowId
      }));
    } catch (error) {
      console.error('Error getting tabs:', error);
      showToast('⚠️ 탭 정보를 가져오는데 실패했습니다.');
      return [];
    }
  };
  
  const generateUniqueSessionName = (baseName) => {
    if (!isDuplicateSessionName(baseName)) return baseName;
    let counter = 2, newName = `${baseName} (${counter})`;
    while (isDuplicateSessionName(newName)) newName = `${baseName} (${++counter})`;
    showToast(`⚠️ 중복된 이름입니다. '${newName}'으로 저장합니다.`);
    return newName;
  };

  const handleSaveSession = async (overwriteId = null) => {
    const tabs = await getTabsToSave();
    if (tabs.length === 0) {
      showToast('⚠️ 저장할 유효한 탭이 없습니다.');
      return;
    }
    let name = sessionInput.value.trim();
    let successMessage = '';
    if (overwriteId) {
      const sessionIndex = allSessions.findIndex(s => s.id === overwriteId);
      if (sessionIndex !== -1) {
        if (!name) name = allSessions[sessionIndex].name;
        allSessions[sessionIndex] = { ...allSessions[sessionIndex], tabs: tabs, name: name };
        successMessage = `🔄 '${escapeHtml(name)}' 세션을 업데이트했습니다.`;
      }
    } else {
      if (!name) name = `${CONSTANTS.DEFAULT_SESSION_PREFIX} ${formatDate(Date.now())}`;
      name = generateUniqueSessionName(name);
      allSessions.push({ id: generateUniqueId(), name, tabs });
      successMessage = `💾 '${escapeHtml(name)}' 세션을 저장했습니다.`;
    }
    
    try {
        await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
        sessionInput.value = '';
        renderSessions();
        showToast(successMessage);
    } catch (e) {
        showToast(`❌ ${e.message}`);
        allSessions = await storage.get(CONSTANTS.STORAGE_KEYS.SESSIONS, []);
        renderSessions();
    }
  };

  const createTabsSequentiallyWithDelay = async (windowId, tabsData, delayMs = 0) => {
    const results = [];
    for (let i = 0; i < tabsData.length; i++) {
      const tabData = tabsData[i];
      if (i > 0 && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      try {
        const createdTab = await chrome.tabs.create({
          windowId,
          url: tabData.url,
          pinned: tabData.pinned,
          active: false
        });
        results.push(createdTab);
      } catch (error) {
        console.warn(`Failed to create tab: ${tabData.url}`, error);
        results.push(null);
      }
    }
    return results;
  };

  const handleRestoreSession = async (sessionId) => {
    const session = allSessions.find(s => s.id === sessionId);
    if (!session) { showToast('⚠️ 세션을 찾을 수 없습니다.'); return; }
    showToast(`🚀 '${escapeHtml(session.name)}' 복원 중...${selectedDelay > 0 ? ` (${selectedDelay}초 지연)` : ''}`);
    try {
      let targetWindowId, initialTabId = null;
      if (selectedRestoreTarget === CONSTANTS.RESTORE_TARGETS.NEW_WINDOW) {
        const newWindow = await chrome.windows.create({ focused: true });
        targetWindowId = newWindow.id;
        initialTabId = newWindow.tabs[0].id;
      } else {
        targetWindowId = (await chrome.windows.getCurrent()).id;
      }
      const createdTabs = await createTabsSequentiallyWithDelay(targetWindowId, session.tabs, selectedDelay * 1000);
      const validCreatedTabs = createdTabs.filter(Boolean);
      if (validCreatedTabs.length === 0) {
        showToast('⚠️ 탭 복원에 실패했습니다.');
        if (selectedRestoreTarget === CONSTANTS.RESTORE_TARGETS.NEW_WINDOW) await chrome.windows.remove(targetWindowId);
        return;
      }
      const groupsToCreate = new Map();
      session.tabs.forEach((original, index) => {
        const newTab = createdTabs[index];
        if (newTab && original.groupId > -1 && original.groupInfo) {
          if (!groupsToCreate.has(original.groupId)) groupsToCreate.set(original.groupId, { tabIds: [], info: original.groupInfo });
          groupsToCreate.get(original.groupId).tabIds.push(newTab.id);
        }
      });
      for (const group of groupsToCreate.values()) {
        if(group.tabIds.length === 0) continue;
        try {
          const newGroupId = await chrome.tabs.group({ tabIds: group.tabIds, createProperties: { windowId: targetWindowId } });
          await chrome.tabGroups.update(newGroupId, { title: group.info.title, color: group.info.color });
        } catch (e) { console.warn('Failed to create tab group:', e); }
      }
      await chrome.tabs.update(validCreatedTabs[0].id, { active: true });
      if (chrome.windows.update) await chrome.windows.update(targetWindowId, { focused: true });
      if (initialTabId) try { await chrome.tabs.remove(initialTabId); } catch (e) { console.warn('Failed to remove initial tab:', e); }
      showToast(`✅ '${escapeHtml(session.name)}' 복원 완료!`);
    } catch (error) {
      console.error('Error restoring session:', error);
      showToast('❌ 세션 복원 중 오류가 발생했습니다.');
    }
  };
  
  const handleUpdateSession = async (sessionId) => {
    const session = allSessions.find(s => s.id === sessionId);
    if (!session) return;
    sessionInput.value = session.name;
    const newName = sessionInput.value.trim() || session.name;
    if (confirm(`'${newName}' 세션을 현재 모든 탭으로 덮어씁니까?`)) {
      await handleSaveSession(sessionId);
    }
  };

  const handleDeleteSession = async (sessionId) => {
    const session = allSessions.find(s => s.id === sessionId);
    if (!session) return;
    if (confirm(`'${escapeHtml(session.name)}' 세션을 삭제합니까?`)) {
      allSessions = allSessions.filter(s => s.id !== sessionId);
      try {
        await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
        showToast(`🗑️ 세션을 삭제했습니다.`);
        renderSessions();
      } catch (e) {
        showToast(`❌ ${e.message}`);
        allSessions = await storage.get(CONSTANTS.STORAGE_KEYS.SESSIONS, []);
        renderSessions();
      }
    }
  };

  const handleRenameSession = (sessionId) => {
    const session = allSessions.find(s => s.id === sessionId);
    const sessionItem = document.querySelector(`.session-item[data-session-id='${sessionId}']`);
    if (!session || !sessionItem) return;
    
    const sessionNameEl = sessionItem.querySelector('.session-name');
    const originalName = session.name;
    sessionNameEl.contentEditable = true;
    sessionNameEl.focus();
    const range = document.createRange();
    range.selectNodeContents(sessionNameEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const saveChanges = async () => {
        sessionNameEl.contentEditable = false;
        sessionNameEl.removeEventListener('blur', saveChanges);
        sessionNameEl.removeEventListener('keydown', handleKeyDown);

        const newName = sessionNameEl.textContent.trim();
        if (!newName || newName === originalName) {
            sessionNameEl.textContent = originalName;
            return;
        }
        if (isDuplicateSessionName(newName, session.id)) {
            showToast(`⚠️ '${newName}' 이름이 이미 존재합니다.`);
            sessionNameEl.textContent = originalName;
            return;
        }

        const sessionIndex = allSessions.findIndex(s => s.id === session.id);
        if (sessionIndex > -1) {
            allSessions[sessionIndex].name = newName;
            try {
                await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
                showToast(`✅ 이름이 '${escapeHtml(newName)}' (으)로 변경되었습니다.`);
                session.name = newName; // 로컬 상태 업데이트
            } catch (e) {
                showToast(`❌ ${e.message}`);
                allSessions[sessionIndex].name = originalName;
                sessionNameEl.textContent = originalName;
            }
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sessionNameEl.blur();
        } else if (e.key === 'Escape') {
            sessionNameEl.contentEditable = false;
            sessionNameEl.textContent = originalName;
            sessionNameEl.removeEventListener('blur', saveChanges);
            sessionNameEl.removeEventListener('keydown', handleKeyDown);
        }
    };

    sessionNameEl.addEventListener('blur', saveChanges);
    sessionNameEl.addEventListener('keydown', handleKeyDown);
  };
  
  // [NEW] URL 복사 핸들러 함수
  const handleCopySessionUrls = async (sessionId) => {
    const session = allSessions.find(s => s.id === sessionId);
    if (!session) {
        showToast('⚠️ 세션을 찾을 수 없습니다.');
        return;
    }

    const urlsToCopy = session.tabs.map(tab => tab.url).join('\n');
    if (!urlsToCopy) {
        showToast('⚠️ 복사할 URL이 없습니다.');
        return;
    }

    try {
        await navigator.clipboard.writeText(urlsToCopy);
        showToast('📋 모든 URL을 클립보드에 복사했습니다.');
    } catch (err) {
        console.error('Failed to copy URLs: ', err);
        showToast('❌ 클립보드 복사에 실패했습니다.');
    }
  };

  const handleExport = () => {
    if (allSessions.length === 0) { showToast('⚠️ 내보낼 세션이 없습니다.'); return; }
    const dataStr = JSON.stringify(allSessions, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const filename = `${year}${month}${day}_TabHaiku_Backup.json`;
    chrome.downloads.download({ url, filename });
    showToast('📤 모든 세션을 내보냈습니다.');
  };

  const handleImport = () => {
    const file = importFileInput.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('❌ 파일이 너무 큽니다 (최대 10MB)');
      return importFileInput.value = '';
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported)) throw new Error("Invalid format");
        const valid = imported.filter(s => isValidSession(s) || console.warn('Invalid session skipped:', s));
        if (valid.length === 0) throw new Error("No valid sessions");
        const existingIds = new Set(allSessions.map(s => s.id));
        valid.forEach(s => { 
          if (existingIds.has(s.id)) s.id = generateUniqueId(); 
          s.name = generateUniqueSessionName(s.name);
        });
        allSessions = [...allSessions, ...valid];
        await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
        renderSessions();
        showToast(`📥 ${valid.length}개의 세션을 가져왔습니다.`);
      } catch (error) {
        if (error.message.startsWith('저장 공간')) {
            showToast(`❌ ${error.message}`);
        } else {
            showToast('❌ 잘못된 파일 형식입니다.'); 
        }
        console.error('Import error:', error);
      } finally {
        importFileInput.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleSessionAction = (e) => {
    const btn = e.target.closest('.beos-icon-button');
    if (!btn) return;
    const sessionItem = btn.closest('.session-item');
    if (!sessionItem) return;
    const sessionId = sessionItem.dataset.sessionId;
    // [MODIFIED] 복사 액션 핸들링 추가
    switch (btn.dataset.action) {
      case CONSTANTS.ACTIONS.RESTORE: handleRestoreSession(sessionId); break;
      case CONSTANTS.ACTIONS.COPY: handleCopySessionUrls(sessionId); break;
      case CONSTANTS.ACTIONS.UPDATE: handleUpdateSession(sessionId); break;
      case CONSTANTS.ACTIONS.RENAME: handleRenameSession(sessionId); break;
      case CONSTANTS.ACTIONS.DELETE: handleDeleteSession(sessionId); break;
    }
  };

  const handleOptionSelection = async (e) => {
    const btn = e.target.closest('.option-btn');
    if (!btn) return;

    let key, value;
    if (btn.classList.contains('delay-btn')) {
        delayButtons.forEach(b => b.classList.remove('active'));
        selectedDelay = parseInt(btn.dataset.delay, 10);
        key = CONSTANTS.STORAGE_KEYS.DELAY;
        value = selectedDelay;
    } else if (btn.classList.contains('restore-target-btn')) {
        restoreTargetButtons.forEach(b => b.classList.remove('active'));
        selectedRestoreTarget = btn.dataset.target;
        key = CONSTANTS.STORAGE_KEYS.RESTORE_TARGET;
        value = selectedRestoreTarget;
    } else {
        return;
    }
    
    btn.classList.add('active');

    try {
        await storage.set(key, value);
    } catch (e) {
        showToast(`❌ 옵션 저장 실패: ${e.message}`);
    }
  };

  const cleanup = () => {
    if (toastTimeout) clearTimeout(toastTimeout);
    sessionCache.clear();
  };

  // --- 7. 초기화 및 이벤트 리스너 ---
  const initialize = async () => {
    selectedDelay = await storage.get(CONSTANTS.STORAGE_KEYS.DELAY, 0);
	  selectedRestoreTarget = await storage.get(CONSTANTS.STORAGE_KEYS.RESTORE_TARGET, CONSTANTS.RESTORE_TARGETS.CURRENT_WINDOW);
    delayButtons.forEach(b => b.classList.toggle('active', parseInt(b.dataset.delay, 10) === selectedDelay));
    restoreTargetButtons.forEach(b => b.classList.toggle('active', b.dataset.target === selectedRestoreTarget));
    allSessions = await storage.get(CONSTANTS.STORAGE_KEYS.SESSIONS, []);
    renderSessions();
    
    saveBtn.addEventListener('click', () => handleSaveSession());
    saveCurrentBtn.addEventListener('click', (e) => { e.preventDefault(); handleSaveSession(); });
    sessionInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveSession(); } });
    sessionInput.addEventListener('input', renderSessions);
    
    exportBtn.addEventListener('click', (e) => { e.preventDefault(); handleExport(); });
    importBtn.addEventListener('click', (e) => { e.preventDefault(); importFileInput.click(); });
    importFileInput.addEventListener('change', handleImport);
    
    sessionListEl.addEventListener('click', handleSessionAction);
    document.querySelector('.delay-btn-group').addEventListener('click', handleOptionSelection);
    document.querySelector('.restore-target-btn-group').addEventListener('click', handleOptionSelection);
    window.addEventListener('unload', cleanup);
  };

  initialize();
});