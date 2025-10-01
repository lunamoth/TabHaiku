(() => {
  'use strict';

  const CONSTANTS = {
    UI: {
      TOAST_DURATION: 4000,
      SESSION_NAME_MAX_LENGTH: 200,
      SEARCH_DEBOUNCE_TIME: 200,
    },
    PROTOCOLS: {
      SAFE: ['http:', 'https:'],
    },
    TIMING: {
      EXPORT_URL_REVOKE_DELAY: 60000,
    },
    STORAGE_KEYS: {
      SESSIONS: 'sessions',
      DELAY: 'restoreDelay',
      RESTORE_TARGET: 'restoreTarget'
    },
    ACTIONS: {
      RESTORE: 'restore', COPY: 'copy', UPDATE: 'update',
      RENAME: 'rename', PIN: 'pin', DELETE: 'delete'
    },
    RESTORE_TARGETS: {
      NEW_WINDOW: 'new-window',
      CURRENT_WINDOW: 'current-window'
    },
    MESSAGES: {
      STORAGE_ERROR: '저장 공간이 부족하거나 쓰기 오류가 발생했습니다.',
      GET_TABS_FAILED: '⚠️ 탭 정보를 가져오는데 실패했습니다.',
      GET_TAB_GROUPS_FAILED: '⚠️ 탭 그룹 정보를 가져오지 못했습니다.',
      NO_VALID_TABS_TO_SAVE: '⚠️ 저장할 유효한 탭이 없습니다.',
      UPDATE_SESSION_NOT_FOUND: '⚠️ 업데이트할 세션을 찾을 수 없습니다.',
      SESSION_SAVE_FAILED: '세션 저장 실패',
      SESSION_NOT_FOUND: '⚠️ 세션을 찾을 수 없습니다.',
      SESSION_RESTORE_FAILED: '⚠️ 탭 복원에 실패했습니다.',
      SESSION_RESTORE_ERROR: '❌ 세션 복원 중 오류가 발생했습니다.',
      SESSION_DELETED: '🗑️ 세션을 삭제했습니다.',
      SESSION_RESTORED: '✅ 세션을 복원했습니다.',
      DELETE_FAILED: '삭제 실패',
      NAME_CANNOT_BE_EMPTY: '⚠️ 이름은 비워둘 수 없습니다.',
      RENAME_FAILED: '이름 변경 실패',
      SESSION_PINNED: '📍 세션을 고정했습니다.',
      SESSION_UNPINNED: '📌 고정을 해제했습니다.',
      PIN_FAILED: '고정 실패',
      NO_URLS_TO_COPY: '⚠️ 복사할 URL이 없습니다.',
      URLS_COPIED: '📋 모든 URL을 클립보드에 복사했습니다.',
      COPY_FAILED: '❌ 클립보드 복사에 실패했습니다.',
      NO_SESSIONS_TO_EXPORT: '⚠️ 내보낼 세션이 없습니다.',
      EXPORT_SUCCESS: '📤 모든 세션을 내보냈습니다.',
      IMPORT_FILE_TOO_LARGE: '❌ 파일이 너무 큽니다 (최대 10MB)',
      IMPORT_FILE_READ_ERROR: '❌ 파일을 읽는 중 오류가 발생했습니다.',
      IMPORT_INVALID_FORMAT: '❌ 잘못된 파일 형식입니다.',
      IMPORT_NO_VALID_SESSIONS: '유효한 세션이 없습니다.',
      OPTIONS_SAVE_FAILED: '❌ 옵션 저장 실패',
      createDuplicateNameWarning: (name) => `⚠️ 중복된 이름입니다. '${name}'(으)로 저장합니다.`,
      createSessionUpdatedMessage: (name) => `🔄 '${escapeHtml(name)}' 세션을 업데이트했습니다.`,
      createSessionSavedMessage: (name) => `💾 '${escapeHtml(name)}' 세션을 저장했습니다.`,
      createSessionRestoreStartedMessage: (name, delay) => `🚀 '${escapeHtml(name)}' 복원 중...${delay > 0 ? ` (${delay}초 지연)` : ''}`,
      createSessionRestoreCompletedMessage: (name) => `✅ '${escapeHtml(name)}' 복원 완료!`,
      createConfirmUpdateMessage: (name) => `'${escapeHtml(name)}' 세션을 현재 모든 탭으로 덮어씁니까?`,
      createNameTooLongMessage: (max) => `⚠️ 이름은 ${max}자를 초과할 수 없습니다.`,
      createNameAlreadyExistsMessage: (name) => `⚠️ '${escapeHtml(name)}' 이름이 이미 존재합니다.`,
      createNameChangedMessage: (name) => `✅ 이름이 '${escapeHtml(name)}'(으)로 변경되었습니다.`,
      createImportSuccessMessage: (count) => `📥 ${count}개의 세션을 가져왔습니다.`
    }
  };

  const DOM = {
    sessionInput: document.getElementById('session-input'),
    saveBtn: document.getElementById('save-session-btn'),
    sessionListEl: document.getElementById('session-list'),
    toastEl: document.getElementById('toast'),
    sessionItemTemplate: document.getElementById('session-item-template'),
    saveCurrentBtn: document.getElementById('save-current-btn'),
    importBtn: document.getElementById('import-btn'),
    importFileInput: document.getElementById('import-file-input'),
    exportBtn: document.getElementById('export-btn'),
    delayBtnGroup: document.querySelector('.delay-btn-group'),
    restoreTargetBtnGroup: document.querySelector('.restore-target-btn-group'),
  };

  let allSessions = [];
  let appState = {
    toastTimeout: null,
    inputDebounce: null,
    lastDeletedSession: null,
    options: {
      restoreDelay: 0,
      restoreTarget: CONSTANTS.RESTORE_TARGETS.CURRENT_WINDOW,
    }
  };

  const storage = {
    get: async (key, defaultValue = null) => {
      const result = await chrome.storage.local.get(key);
      return result[key] ?? defaultValue;
    },
    set: async (key, value) => {
      try {
        await chrome.storage.local.set({ [key]: value });
      } catch (error) {
        throw new Error(CONSTANTS.MESSAGES.STORAGE_ERROR);
      }
    },
  };

  const escapeHtml = (str) => String(str).replace(/[&<>"'\/]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' }[s]));
  const generateUniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const isValidUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    try {
      return CONSTANTS.PROTOCOLS.SAFE.includes(new URL(url).protocol);
    } catch { return false; }
  };
  const isDuplicateSessionName = (name, excludeId = null) => allSessions.some(s => String(s.id) !== String(excludeId) && s.name === name);
  const findSessionById = (id) => allSessions.find(s => String(s.id) === String(id));
  const findSessionIndexById = (id) => allSessions.findIndex(s => String(s.id) === String(id));
  const getSessionTimestamp = (session) => parseInt(String(session.id).split('-')[0], 10);

  async function updateAndSaveSessions(updateFunction, { successMessage, errorMessagePrefix }) {
    const originalSessions = JSON.parse(JSON.stringify(allSessions));
    try {
      if (await updateFunction() === false) return;
      await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
      renderSessions();
      const finalSuccessMessage = typeof successMessage === 'function' ? successMessage() : successMessage;
      if (finalSuccessMessage) showToast(finalSuccessMessage);
    } catch (e) {
      allSessions = originalSessions;
      renderSessions();
      showToast(`❌ ${errorMessagePrefix}: ${escapeHtml(e.message)}`);
    }
  }

  function formatDate(timestamp) {
    const d = new Date(timestamp);
    const datePart = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    let hours = d.getHours();
    const ampm = hours >= 12 ? '오후' : '오전';
    hours %= 12;
    if (hours === 0) hours = 12;
    const timePart = `${ampm} ${String(hours).padStart(2, ' ')}시 ${String(d.getMinutes()).padStart(2, '0')}분`;
    return `${datePart} ${timePart}`;
  }

  function showToast(message, duration = CONSTANTS.UI.TOAST_DURATION, undoCallback = null) {
    clearTimeout(appState.toastTimeout);
    DOM.toastEl.innerHTML = '';
    
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    DOM.toastEl.appendChild(messageSpan);

    if (undoCallback) {
        const undoButton = document.createElement('button');
        undoButton.textContent = '실행 취소';
        undoButton.className = 'toast-undo-btn';
        undoButton.onclick = () => {
            clearTimeout(appState.toastTimeout);
            DOM.toastEl.classList.remove('show');
            undoCallback();
        };
        DOM.toastEl.appendChild(undoButton);
    }
    
    DOM.toastEl.classList.add('show');
    appState.toastTimeout = setTimeout(() => {
        DOM.toastEl.classList.remove('show');
        if (undoCallback) appState.lastDeletedSession = null;
    }, duration);
  }

  function createActionButton(action, title, icon) {
    const button = document.createElement('button');
    button.className = `beos-icon-button ${action.toLowerCase()}-btn`;
    button.dataset.action = action;
    button.title = title;
    button.textContent = icon;
    return button;
  }

  function createSessionListItem(session) {
    const item = DOM.sessionItemTemplate.content.cloneNode(true).firstElementChild;
    item.dataset.sessionId = session.id;
    if (session.isPinned) item.classList.add('pinned');
  
    const groupCount = new Set(session.tabs.map(t => t.groupId).filter(Boolean)).size;
    
    item.querySelector('.session-name').textContent = session.name;
    item.querySelector('.session-meta-date').textContent = formatDate(getSessionTimestamp(session));
    item.querySelector('.session-meta-count').textContent = `탭: ${session.tabs.length}${groupCount > 0 ? `, 그룹: ${groupCount}` : ''}`;
    
    const sessionActions = item.querySelector('.session-actions');
    const actions = [
      { action: CONSTANTS.ACTIONS.RESTORE, title: '복원(열기)', icon: '🚀' },
      { action: CONSTANTS.ACTIONS.COPY, title: 'URL 복사', icon: '📋' },
      { action: CONSTANTS.ACTIONS.UPDATE, title: '덮어쓰기', icon: '🔄' },
      { action: CONSTANTS.ACTIONS.RENAME, title: '이름 변경', icon: '✏️' },
      { action: CONSTANTS.ACTIONS.PIN, title: session.isPinned ? '고정 해제' : '세션 고정', icon: session.isPinned ? '📍' : '📌' },
      { action: CONSTANTS.ACTIONS.DELETE, title: '삭제', icon: '🗑️' },
    ];
    actions.forEach(({ action, title, icon }) => sessionActions.appendChild(createActionButton(action, title, icon)));
  
    const detailsList = item.querySelector('.session-details-list');
    session.tabs.forEach(tab => {
      const tabItem = document.createElement('li');
      tabItem.textContent = tab.url;
      detailsList.appendChild(tabItem);
    });
  
    item.querySelector('.session-header').addEventListener('click', (e) => {
      if (!e.target.closest('.beos-icon-button')) {
        const details = item.querySelector('.session-details');
        details.hidden = !details.hidden;
      }
    });
  
    return item;
  }

  function renderSessions() {
    const searchTerm = DOM.sessionInput.value.trim().toLowerCase();
    const filteredSessions = searchTerm 
      ? allSessions.filter(s => 
          s.name.toLowerCase().includes(searchTerm) || 
          s.tabs.some(t => 
              t.url.toLowerCase().includes(searchTerm) ||
              (t.title && t.title.toLowerCase().includes(searchTerm))
          )
        ) 
      : allSessions;

    if (filteredSessions.length === 0) {
      const p = document.createElement('p');
      p.style.cssText = 'text-align: center; padding: 20px 0;';
      p.textContent = allSessions.length === 0 ? "저장된 세션이 없습니다." : "검색 결과가 없습니다.";
      DOM.sessionListEl.replaceChildren(p);
      return;
    }

    const sortedSessions = [...filteredSessions].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return getSessionTimestamp(b) - getSessionTimestamp(a);
    });
    
    const fragment = document.createDocumentFragment();
    sortedSessions.forEach(session => fragment.appendChild(createSessionListItem(session)));
    DOM.sessionListEl.replaceChildren(fragment);
  }

  async function withLoadingState(element, asyncAction) {
    if (element && element.disabled) return;
    if (element) element.disabled = true;
    document.body.style.cursor = 'wait';
    try {
      await asyncAction();
    } finally {
      if (element) element.disabled = false;
      document.body.style.cursor = 'default';
    }
  }

  async function getTabsToSave() {
    try {
      const tabs = await chrome.tabs.query({});
      if (tabs.length === 0) return [];

      const windows = await chrome.windows.getAll({ populate: false });
      let allTabGroups = [];
      try {
        allTabGroups = (await Promise.all(windows.map(w => chrome.tabGroups.query({ windowId: w.id })))).flat();
      } catch (e) {
        showToast(CONSTANTS.MESSAGES.GET_TAB_GROUPS_FAILED);
      }
      
      return tabs
        .filter(tab => isValidUrl(tab.url))
        .map(tab => ({ 
          url: tab.url, 
          title: tab.title, 
          pinned: tab.pinned, 
          groupId: tab.groupId,
          groupInfo: tab.groupId > -1 ? allTabGroups.find(g => g.id === tab.groupId) : null,
        }));
    } catch (error) {
      showToast(CONSTANTS.MESSAGES.GET_TABS_FAILED);
      return [];
    }
  }

  async function handleSaveSession(overwriteId = null, overwriteName = null) {
    const tabs = await getTabsToSave();
    if (tabs.length === 0) {
      showToast(CONSTANTS.MESSAGES.NO_VALID_TABS_TO_SAVE);
      return;
    }
    
    let successMessage;
    await updateAndSaveSessions(
      () => {
        if (overwriteId) {
          const sessionIndex = findSessionIndexById(overwriteId);
          if (sessionIndex === -1) {
            showToast(CONSTANTS.MESSAGES.UPDATE_SESSION_NOT_FOUND);
            return false;
          }
          allSessions[sessionIndex] = { ...allSessions[sessionIndex], tabs, name: overwriteName };
          successMessage = CONSTANTS.MESSAGES.createSessionUpdatedMessage(overwriteName);
        } else {
          let name = DOM.sessionInput.value.trim() || `세션 ${formatDate(Date.now())}`;
          if (isDuplicateSessionName(name)) {
            let counter = 2;
            let newName;
            do { newName = `${name} (${counter++})`; } while (isDuplicateSessionName(newName));
            name = newName;
            showToast(CONSTANTS.MESSAGES.createDuplicateNameWarning(name));
          }
          allSessions.push({ id: generateUniqueId(), name, tabs, isPinned: false });
          successMessage = CONSTANTS.MESSAGES.createSessionSavedMessage(name);
          DOM.sessionInput.value = '';
        }
        return true;
      },
      {
        get successMessage() { return successMessage; },
        errorMessagePrefix: CONSTANTS.MESSAGES.SESSION_SAVE_FAILED,
      }
    );
  }

  async function handleRestoreSession(sessionId) {
    const session = findSessionById(sessionId);
    if (!session) return showToast(CONSTANTS.MESSAGES.SESSION_NOT_FOUND);

    showToast(CONSTANTS.MESSAGES.createSessionRestoreStartedMessage(session.name, appState.options.restoreDelay));
    try {
      const { restoreTarget, restoreDelay } = appState.options;
      const targetWindow = await (async () => {
        if (restoreTarget === CONSTANTS.RESTORE_TARGETS.NEW_WINDOW) {
          const newWindow = await chrome.windows.create({ focused: true, url: 'about:blank' });
          return { id: newWindow.id, initialTabId: newWindow.tabs[0].id };
        }
        return { id: (await chrome.windows.getCurrent()).id, initialTabId: null };
      })();

      const delayMs = restoreDelay * 1000;
      const createdTabs = [];
      for (const tabData of session.tabs) {
        if (createdTabs.length > 0 && delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        createdTabs.push(await chrome.tabs.create({ windowId: targetWindow.id, url: tabData.url, pinned: tabData.pinned, active: false }));
      }
      
      const groupsToCreate = new Map();
      session.tabs.forEach((original, index) => {
        if (original.groupId > -1 && original.groupInfo) {
          if (!groupsToCreate.has(original.groupId)) {
            groupsToCreate.set(original.groupId, { tabIds: [], info: original.groupInfo });
          }
          groupsToCreate.get(original.groupId).tabIds.push(createdTabs[index].id);
        }
      });
      for (const group of groupsToCreate.values()) {
        try {
          const newGroupId = await chrome.tabs.group({ tabIds: group.tabIds, createProperties: { windowId: targetWindow.id } });
          await chrome.tabGroups.update(newGroupId, { title: group.info.title, color: group.info.color, collapsed: group.info.collapsed });
        } catch (e) { /* silent fail on group creation */ }
      }

      const firstUnpinnedTab = createdTabs.find(tab => !tab.pinned);
      if (firstUnpinnedTab) await chrome.tabs.update(firstUnpinnedTab.id, { active: true });
      if (chrome.windows.update) await chrome.windows.update(targetWindow.id, { focused: true });
      if (targetWindow.initialTabId) {
        try { await chrome.tabs.remove(targetWindow.initialTabId); } catch (e) { /* silent fail */ }
      }
      showToast(CONSTANTS.MESSAGES.createSessionRestoreCompletedMessage(session.name));
    } catch (error) {
      showToast(CONSTANTS.MESSAGES.SESSION_RESTORE_ERROR);
    }
  }

  async function handleDeleteSession(sessionId) {
    const sessionIndex = findSessionIndexById(sessionId);
    if (sessionIndex === -1) return;

    const sessionToDelete = allSessions[sessionIndex];
    appState.lastDeletedSession = { session: sessionToDelete, index: sessionIndex };

    allSessions.splice(sessionIndex, 1);
    
    try {
      await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
      renderSessions();
      const undoCallback = async () => {
        if (!appState.lastDeletedSession) return;
        allSessions.splice(appState.lastDeletedSession.index, 0, appState.lastDeletedSession.session);
        await updateAndSaveSessions(() => true, {
          successMessage: CONSTANTS.MESSAGES.SESSION_RESTORED,
          errorMessagePrefix: "복원 실패"
        });
        appState.lastDeletedSession = null;
      };
      showToast(CONSTANTS.MESSAGES.SESSION_DELETED, CONSTANTS.UI.TOAST_DURATION, undoCallback);
    } catch (e) {
      allSessions.splice(sessionIndex, 0, sessionToDelete);
      appState.lastDeletedSession = null;
      renderSessions();
      showToast(`❌ ${CONSTANTS.MESSAGES.DELETE_FAILED}: ${escapeHtml(e.message)}`);
    }
  }
  
  const actionHandlers = new Map([
    [CONSTANTS.ACTIONS.RESTORE, handleRestoreSession],
    [CONSTANTS.ACTIONS.COPY, async (sessionId) => {
      const session = findSessionById(sessionId);
      if (!session) return showToast(CONSTANTS.MESSAGES.SESSION_NOT_FOUND);
      const urlsToCopy = session.tabs.map(tab => tab.url).join('\n');
      if (!urlsToCopy) return showToast(CONSTANTS.MESSAGES.NO_URLS_TO_COPY);
      try {
        await navigator.clipboard.writeText(urlsToCopy);
        showToast(CONSTANTS.MESSAGES.URLS_COPIED);
      } catch (err) {
        showToast(CONSTANTS.MESSAGES.COPY_FAILED);
      }
    }],
    [CONSTANTS.ACTIONS.UPDATE, async (sessionId) => {
      const session = findSessionById(sessionId);
      if (session && confirm(CONSTANTS.MESSAGES.createConfirmUpdateMessage(session.name))) {
        await handleSaveSession(sessionId, session.name);
      }
    }],
    [CONSTANTS.ACTIONS.RENAME, async (sessionId) => {
      const sessionIndex = findSessionIndexById(sessionId);
      if (sessionIndex === -1) return showToast(CONSTANTS.MESSAGES.SESSION_NOT_FOUND);
      const session = allSessions[sessionIndex];
      const newName = prompt('새 세션 이름을 입력하세요:', session.name);
      if (newName === null) return;
      const trimmed = newName.trim();
      if (!trimmed) return showToast(CONSTANTS.MESSAGES.NAME_CANNOT_BE_EMPTY);
      if (trimmed.length > CONSTANTS.UI.SESSION_NAME_MAX_LENGTH) return showToast(CONSTANTS.MESSAGES.createNameTooLongMessage(CONSTANTS.UI.SESSION_NAME_MAX_LENGTH));
      if (trimmed !== session.name && isDuplicateSessionName(trimmed, session.id)) return showToast(CONSTANTS.MESSAGES.createNameAlreadyExistsMessage(trimmed));
      if (trimmed !== session.name) {
        await updateAndSaveSessions(
          () => { allSessions[sessionIndex].name = trimmed; return true; },
          { successMessage: CONSTANTS.MESSAGES.createNameChangedMessage(trimmed), errorMessagePrefix: CONSTANTS.MESSAGES.RENAME_FAILED }
        );
      }
    }],
    [CONSTANTS.ACTIONS.PIN, async (sessionId) => {
      const sessionIndex = findSessionIndexById(sessionId);
      if (sessionIndex === -1) return showToast(CONSTANTS.MESSAGES.SESSION_NOT_FOUND);
      let isNowPinned;
      await updateAndSaveSessions(
        () => {
          isNowPinned = !allSessions[sessionIndex].isPinned;
          allSessions[sessionIndex].isPinned = isNowPinned;
          return true;
        },
        { successMessage: () => isNowPinned ? CONSTANTS.MESSAGES.SESSION_PINNED : CONSTANTS.MESSAGES.SESSION_UNPINNED, errorMessagePrefix: CONSTANTS.MESSAGES.PIN_FAILED }
      );
    }],
    [CONSTANTS.ACTIONS.DELETE, handleDeleteSession]
  ]);

  async function handleSessionAction(e) {
    const btn = e.target.closest('.beos-icon-button');
    const sessionId = btn?.closest('.session-item')?.dataset.sessionId;
    if (!btn || !sessionId) return;
    
    const action = btn.dataset.action;
    const handler = actionHandlers.get(action);
    if (handler) {
      await withLoadingState(btn, () => handler(sessionId));
    }
  }
  
  function handleExport() {
    if (allSessions.length === 0) return showToast(CONSTANTS.MESSAGES.NO_SESSIONS_TO_EXPORT);
    const dataStr = JSON.stringify(allSessions, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const filename = `${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_TabHaiku_Backup.json`;
    
    chrome.downloads.download({ url, filename }, () => {
      setTimeout(() => URL.revokeObjectURL(url), CONSTANTS.TIMING.EXPORT_URL_REVOKE_DELAY);
    });
    showToast(CONSTANTS.MESSAGES.EXPORT_SUCCESS);
  }

  function handleImport() {
    const file = DOM.importFileInput.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return showToast(CONSTANTS.MESSAGES.IMPORT_FILE_TOO_LARGE);
    
    const reader = new FileReader();
    reader.onerror = () => showToast(CONSTANTS.MESSAGES.IMPORT_FILE_READ_ERROR);
    reader.onload = async (e) => {
      try {
        const importedData = JSON.parse(e.target.result);
        if (!Array.isArray(importedData)) throw new Error("Invalid format");
        
        const validSessions = importedData.filter(s => s && s.id && s.name && Array.isArray(s.tabs));
        if (validSessions.length === 0) throw new Error(CONSTANTS.MESSAGES.IMPORT_NO_VALID_SESSIONS);

        const existingIds = new Set(allSessions.map(s => String(s.id)));
        const sessionsToMerge = validSessions.map(s => {
          const newSession = { ...s, isPinned: s.isPinned || false };
          if (existingIds.has(String(newSession.id))) {
            newSession.id = generateUniqueId();
          }
          return newSession;
        });
        
        allSessions = [...allSessions, ...sessionsToMerge];
        
        await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
        renderSessions();
        showToast(CONSTANTS.MESSAGES.createImportSuccessMessage(validSessions.length));
      } catch (error) {
        const message = error.message.startsWith('저장 공간') ? `❌ ${escapeHtml(error.message)}` : CONSTANTS.MESSAGES.IMPORT_INVALID_FORMAT;
        showToast(message);
      } finally {
        DOM.importFileInput.value = '';
      }
    };
    reader.readAsText(file);
  }
  
  async function handleOptionChange(e) {
    const btn = e.target.closest('.option-btn');
    if (!btn || btn.classList.contains('active')) return;

    const { key, value } = btn.dataset;
    const parsedValue = /^\d+$/.test(value) ? parseInt(value, 10) : value;
    
    btn.parentElement.querySelector('.active')?.classList.remove('active');
    btn.classList.add('active');
    
    appState.options[key] = parsedValue;

    try {
      await storage.set(key, parsedValue);
    } catch (err) {
      showToast(`${CONSTANTS.MESSAGES.OPTIONS_SAVE_FAILED}: ${escapeHtml(err.message)}`);
    }
  }

  async function loadInitialData() {
    const [delay, restoreTarget, sessions] = await Promise.all([
        storage.get(CONSTANTS.STORAGE_KEYS.DELAY, 0),
        storage.get(CONSTANTS.STORAGE_KEYS.RESTORE_TARGET, CONSTANTS.RESTORE_TARGETS.CURRENT_WINDOW),
        storage.get(CONSTANTS.STORAGE_KEYS.SESSIONS, [])
    ]);

    appState.options.restoreDelay = delay;
    appState.options.restoreTarget = restoreTarget;
    allSessions = sessions;
    
    document.querySelector(`.delay-btn-group .option-btn[data-value="${delay}"]`)?.classList.add('active');
    document.querySelector(`.restore-target-btn-group .option-btn[data-value="${restoreTarget}"]`)?.classList.add('active');

    renderSessions();
  }

  function setupEventListeners() {
    const onSaveClick = () => withLoadingState(DOM.saveBtn, handleSaveSession);
    
    DOM.saveBtn.addEventListener('click', onSaveClick);
    DOM.saveCurrentBtn.addEventListener('click', (e) => { e.preventDefault(); onSaveClick(); });
    DOM.sessionInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); onSaveClick(); } });
    DOM.sessionInput.addEventListener('input', () => { 
      clearTimeout(appState.inputDebounce); 
      appState.inputDebounce = setTimeout(renderSessions, CONSTANTS.UI.SEARCH_DEBOUNCE_TIME); 
    });
    
    DOM.exportBtn.addEventListener('click', (e) => { e.preventDefault(); handleExport(); });
    DOM.importBtn.addEventListener('click', (e) => { e.preventDefault(); DOM.importFileInput.click(); });
    DOM.importFileInput.addEventListener('change', handleImport);
    
    DOM.sessionListEl.addEventListener('click', handleSessionAction);
    DOM.delayBtnGroup.addEventListener('click', handleOptionChange);
    DOM.restoreTargetBtnGroup.addEventListener('click', handleOptionChange);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && CONSTANTS.STORAGE_KEYS.SESSIONS in changes) {
        allSessions = changes[CONSTANTS.STORAGE_KEYS.SESSIONS].newValue || [];
        renderSessions();
      }
    });

    window.addEventListener('pagehide', () => {
      clearTimeout(appState.toastTimeout);
      clearTimeout(appState.inputDebounce);
      appState.lastDeletedSession = null;
    });
  }

  async function init() {
    DOM.sessionInput.maxLength = CONSTANTS.UI.SESSION_NAME_MAX_LENGTH;
    await loadInitialData();
    setupEventListeners();
  }
  
  document.addEventListener('DOMContentLoaded', init);

})();