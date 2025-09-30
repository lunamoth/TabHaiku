/*
 * @file 탭 하이쿠 - 로직 (v6.1 - Emoji Icons)
 * @description 안정성을 위해 SVG 아이콘을 이모지로 교체한 버전
 */
document.addEventListener('DOMContentLoaded', () => {

  // --- 상수 분리 ---
  const CONSTANTS = {
    TOAST_DURATION: 3000,
    DEFAULT_SESSION_PREFIX: '세션',
    BACKUP_FILENAME_PREFIX: 'tab-haiku-backup-',
    TAB_CREATION_BATCH_SIZE: 5,
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
      UPDATE: 'update',
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
  let selectedRestoreTarget = CONSTANTS.RESTORE_TARGETS.NEW_WINDOW;

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
      if (key === CONSTANTS.STORAGE_KEYS.SESSIONS) sessionCache.set(key, value);
      await chrome.storage.local.set({ [key]: value });
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
  const formatDate = (timestamp) => new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp));
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
  const createElement = (tag, options = {}) => {
    const el = document.createElement(tag);
    if (options.className) el.className = options.className;
    if (options.textContent) el.textContent = options.textContent;
    if (options.innerHTML) el.innerHTML = options.innerHTML;
    Object.keys(options.dataset || {}).forEach(key => el.dataset[key] = options.dataset[key]);
    Object.keys(options.attributes || {}).forEach(key => el.setAttribute(key, options.attributes[key]));
    return el;
  };

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
  
  // [REVISED] SVG 생성 함수 제거, 이모지 직접 사용
  const createSessionListItem = (session) => {
    const groupCount = new Set(session.tabs.map(t => t.groupId).filter(Boolean)).size;
    const sessionIdNum = typeof session.id === 'string' ? parseInt(session.id.split('-')[0]) : session.id;
    let metaText = `${formatDate(sessionIdNum)} · 탭:${session.tabs.length}${groupCount > 0 ? ` 그룹:${groupCount}` : ''}`;

    const sessionName = createElement('span', { className: 'session-name', textContent: session.name });
    const sessionMeta = createElement('span', { className: 'session-meta', textContent: metaText });
    const sessionInfo = createElement('div', { className: 'session-info' });
    sessionInfo.append(sessionName, sessionMeta);

    const restoreBtn = createElement('button', { className: 'beos-icon-button restore-btn', textContent: '🚀', dataset: { action: CONSTANTS.ACTIONS.RESTORE }, attributes: { title: '복원' } });
    const updateBtn = createElement('button', { className: 'beos-icon-button update-btn', textContent: '🔄', dataset: { action: CONSTANTS.ACTIONS.UPDATE }, attributes: { title: '덮어쓰기' } });
    const deleteBtn = createElement('button', { className: 'beos-icon-button delete-btn', textContent: '🗑️', dataset: { action: CONSTANTS.ACTIONS.DELETE }, attributes: { title: '삭제' } });
    
    const sessionActions = createElement('div', { className: 'session-actions' });
    sessionActions.append(restoreBtn, updateBtn, deleteBtn);
    
    const sessionHeader = createElement('div', { className: 'session-header' });
    sessionHeader.append(sessionInfo, sessionActions);

    const detailsList = createElement('ul', { className: 'session-details-list' });
    session.tabs.forEach(t => detailsList.appendChild(createElement('li', { textContent: t.url })));
    const sessionDetails = createElement('div', { className: 'session-details' });
    sessionDetails.appendChild(detailsList);

    const item = createElement('li', { className: 'session-item', dataset: { sessionId: session.id } });
    item.append(sessionHeader, sessionDetails);
    
    sessionHeader.addEventListener('click', (e) => {
      if (!e.target.closest('.beos-icon-button')) {
        sessionDetails.style.display = sessionDetails.style.display === 'block' ? 'none' : 'block';
      }
    });

    return item;
  };

  // --- 6. 핵심 로직 (이전 버전과 동일, 변경 없음) ---
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
    if (overwriteId) {
      const sessionIndex = allSessions.findIndex(s => s.id === overwriteId);
      if (sessionIndex !== -1) {
        if (!name) name = allSessions[sessionIndex].name;
        allSessions[sessionIndex] = { ...allSessions[sessionIndex], tabs: tabs, name: name };
        showToast(`🔄 '${name}' 세션을 업데이트했습니다.`);
      }
    } else {
      if (!name) name = `${CONSTANTS.DEFAULT_SESSION_PREFIX} ${formatDate(Date.now())}`;
      name = generateUniqueSessionName(name);
      allSessions.push({ id: generateUniqueId(), name, tabs });
      showToast(`💾 '${name}' 세션을 저장했습니다.`);
    }
    sessionInput.value = '';
    await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
    renderSessions();
  };

  const createTabsInBatches = async (windowId, tabsData, delayMs = 0) => {
    const results = [];
    for (let i = 0; i < tabsData.length; i++) {
      const tabData = tabsData[i];
      // 첫 탭을 제외하고, 다음 탭을 열기 전에 지정된 지연시간만큼 대기합니다.
      if (i > 0 && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      try {
        // 개별적으로 탭을 생성하고 결과를 수집합니다.
        const createdTab = await chrome.tabs.create({
          windowId,
          url: tabData.url,
          pinned: tabData.pinned,
          active: false
        });
        results.push(createdTab);
      } catch (error) {
        console.warn(`Failed to create tab: ${tabData.url}`, error);
        // 그룹 정보 매칭을 위해 배열 길이를 유지하도록 null을 추가합니다.
        results.push(null);
      }
    }
    return results;
  };

  const handleRestoreSession = async (sessionId) => {
    const session = allSessions.find(s => s.id === sessionId);
    if (!session) { showToast('⚠️ 세션을 찾을 수 없습니다.'); return; }
    showToast(`🚀 '${session.name}' 복원 중...${selectedDelay > 0 ? ` (${selectedDelay}초 지연)` : ''}`);
    try {
      let targetWindowId, initialTabId = null;
      if (selectedRestoreTarget === CONSTANTS.RESTORE_TARGETS.NEW_WINDOW) {
        const newWindow = await chrome.windows.create({ focused: true });
        targetWindowId = newWindow.id;
        initialTabId = newWindow.tabs[0].id;
      } else {
        targetWindowId = (await chrome.windows.getCurrent()).id;
      }
      const createdTabs = await createTabsInBatches(targetWindowId, session.tabs, selectedDelay * 1000);
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
      showToast(`✅ '${session.name}' 복원 완료!`);
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
    if (confirm(`'${newName}' 세션을 현재 모든 탭으로 덮어씁니까?\n(이름을 변경하려면 입력창을 수정하세요)`)) {
      await handleSaveSession(sessionId);
    } else {
      sessionInput.value = '';
    }
  };

  const handleDeleteSession = async (sessionId) => {
    const session = allSessions.find(s => s.id === sessionId);
    if (!session) return;
    if (confirm(`'${session.name}' 세션을 삭제합니까?`)) {
      allSessions = allSessions.filter(s => s.id !== sessionId);
      await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
      showToast(`🗑️ 세션을 삭제했습니다.`);
      renderSessions();
    }
  };
  
  const handleExport = () => {
    if (allSessions.length === 0) { showToast('⚠️ 내보낼 세션이 없습니다.'); return; }
    const dataStr = JSON.stringify(allSessions, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: `${CONSTANTS.BACKUP_FILENAME_PREFIX}${new Date().toISOString().slice(0, 10)}.json` });
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
        valid.forEach(s => { if (existingIds.has(s.id)) s.id = generateUniqueId(); });
        allSessions = [...allSessions, ...valid];
        await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
        renderSessions();
        showToast(`📥 ${valid.length}개의 세션을 가져왔습니다.`);
      } catch (error) { 
        showToast('❌ 잘못된 파일 형식입니다.'); 
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
    switch (btn.dataset.action) {
      case CONSTANTS.ACTIONS.RESTORE: handleRestoreSession(sessionId); break;
      case CONSTANTS.ACTIONS.UPDATE: handleUpdateSession(sessionId); break;
      case CONSTANTS.ACTIONS.DELETE: handleDeleteSession(sessionId); break;
    }
  };

  const handleOptionSelection = async (e) => {
    const btn = e.target.closest('.option-btn');
    if (!btn) return;
    if (btn.classList.contains('delay-btn')) {
        delayButtons.forEach(b => b.classList.remove('active'));
        selectedDelay = parseInt(btn.dataset.delay, 10);
        await storage.set(CONSTANTS.STORAGE_KEYS.DELAY, selectedDelay);
    } else if (btn.classList.contains('restore-target-btn')) {
        restoreTargetButtons.forEach(b => b.classList.remove('active'));
        selectedRestoreTarget = btn.dataset.target;
        await storage.set(CONSTANTS.STORAGE_KEYS.RESTORE_TARGET, selectedRestoreTarget);
    }
    btn.classList.add('active');
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