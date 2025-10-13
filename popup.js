document.addEventListener('DOMContentLoaded', () => {

  const CONSTANTS = {
    UI: {
      TOAST_DURATION: 4000,
      SESSION_NAME_MAX_LENGTH: 200,
      SEARCH_DEBOUNCE_TIME: 200,
    },
    DEFAULTS: {
      SESSION_PREFIX: '',
    },
    PROTOCOLS: {
      SAFE: ['http:', 'https:'],
    },
    TIMING: {
      TAB_CREATION_DELAY: 100, // 이 상수는 현재 코드에서 직접 사용되지는 않음
      EXPORT_URL_REVOKE_DELAY: 60000, // 60초
    },
    STORAGE_KEYS: {
      SESSIONS: 'sessions',
      DELAY: 'restoreDelay',
      RESTORE_TARGET: 'restoreTarget'
    },
    ACTIONS: {
      RESTORE: 'restore',
      COPY: 'copy',
      UPDATE: 'update',
      RENAME: 'rename',
      PIN: 'pin',
      DELETE: 'delete'
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
      createSessionDeletedMessage: (name) => `🗑️ '${escapeHtml(name)}' 세션을 삭제했습니다.`,
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
  
  // --- DOM 요소 ---
  const sessionInput = document.getElementById('session-input');
  const saveBtn = document.getElementById('save-session-btn');
  const sessionListEl = document.getElementById('session-list');
  const toastEl = document.getElementById('toast');
  const sessionItemTemplate = document.getElementById('session-item-template');

  // 메뉴바 요소
  const saveCurrentBtn = document.getElementById('save-current-btn');
  const importBtn = document.getElementById('import-btn');
  const importFileInput = document.getElementById('import-file-input');
  const exportBtn = document.getElementById('export-btn');
  const delayBtnGroup = document.querySelector('.delay-btn-group');
  const restoreTargetBtnGroup = document.querySelector('.restore-target-btn-group');

  // --- 상태 관리 ---
  let allSessions = [];
  let toastTimeout;
  let selectedDelay = 0;
  let selectedRestoreTarget;
  let inputDebounce;

  const storage = {
    get: async (key, defaultValue = []) => {
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

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CONSTANTS.STORAGE_KEYS.SESSIONS]) {
      allSessions = changes[CONSTANTS.STORAGE_KEYS.SESSIONS].newValue || [];
      renderSessions();
    }
  });

  // --- 유틸리티 함수 ---
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

  const showToast = (message, duration = CONSTANTS.UI.TOAST_DURATION, undoCallback = null) => {
    clearTimeout(toastTimeout);
    toastEl.innerHTML = '';
    
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    toastEl.appendChild(messageSpan);

    if (undoCallback) {
        const undoButton = document.createElement('button');
        undoButton.textContent = '실행 취소';
        undoButton.className = 'toast-undo-btn';
        undoButton.onclick = () => {
            clearTimeout(toastTimeout);
            toastEl.classList.remove('show');
            undoCallback();
        };
        toastEl.appendChild(undoButton);
    }
    
    toastEl.classList.add('show');
    toastTimeout = setTimeout(() => {
        toastEl.classList.remove('show');
    }, duration);
  };
  
  const escapeHtml = (str) => String(str).replace(/[&<>"'\/]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' }[s]));
  
  const isValidUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      return CONSTANTS.PROTOCOLS.SAFE.includes(parsed.protocol);
    } catch { return false; }
  };

  const isValidTab = (tab) => {
    if (!tab || typeof tab.url !== 'string' || !isValidUrl(tab.url)) return false;
    const titleOk = ('title' in tab) ? typeof tab.title === 'string' : true;
    const pinnedOk = ('pinned' in tab) ? typeof tab.pinned === 'boolean' : true;
    const groupOk = !('groupId' in tab) || typeof tab.groupId === 'number';
    return titleOk && pinnedOk && groupOk;
  };

  const isValidSession = (session) => {
    return session &&
      (typeof session.id === 'number' || typeof session.id === 'string') &&
      typeof session.name === 'string' &&
      session.name.length > 0 &&
      session.name.length <= CONSTANTS.UI.SESSION_NAME_MAX_LENGTH &&
      Array.isArray(session.tabs) &&
      session.tabs.length > 0 &&
      session.tabs.every(isValidTab);
  };

  const isDuplicateSessionName = (name, excludeId = null) => allSessions.some(s => String(s.id) !== String(excludeId) && s.name === name);
  const generateUniqueId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const findSessionById = (id) => allSessions.find(s => String(s.id) === String(id));
  const findSessionIndexById = (id) => allSessions.findIndex(s => String(s.id) === String(id));
  
  // ▼▼▼ [수정됨] 세션 탐색 및 오류 처리 로직 중앙화 ▼▼▼
  const findSessionDataOrShowError = (id) => {
    const index = findSessionIndexById(id);
    if (index === -1) {
      showToast(CONSTANTS.MESSAGES.SESSION_NOT_FOUND);
      return null;
    }
    return { session: allSessions[index], index };
  };
  // ▲▲▲ [수정됨] ▲▲▲

  const getSessionTimestamp = (session) => {
    const id = session.id;
    return typeof id === 'string' ? parseInt(id.split('-')[0], 10) : id;
  };

  const createActionButton = (action, title, icon) => {
    const button = document.createElement('button');
    button.className = `beos-icon-button ${action.toLowerCase()}-btn`;
    button.dataset.action = action;
    button.title = title;
    button.textContent = icon;
    return button;
  };

  const withLoadingState = async (elements, asyncFunc) => {
    const elementsArray = Array.isArray(elements) || elements instanceof NodeList ? Array.from(elements) : [elements];

    if (elementsArray.some(el => !el || el.disabled)) return;

    elementsArray.forEach(el => el.disabled = true);
    document.body.style.cursor = 'wait';
    try {
      await asyncFunc();
    } finally {
      elementsArray.forEach(el => {
        if (document.body.contains(el)) {
          el.disabled = false;
        }
      });
      document.body.style.cursor = 'default';
    }
  };

  // --- UI 렌더링 ---
  const renderSessions = () => {
    const fragment = document.createDocumentFragment();
    const searchTerm = sessionInput.value.trim().toLowerCase();
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
      p.style.textAlign = 'center';
      p.style.padding = '20px 0';
      p.textContent = allSessions.length === 0 ? "저장된 세션이 없습니다." : "검색 결과가 없습니다.";
      sessionListEl.replaceChildren(p);
      return;
    }

    const sortedSessions = [...filteredSessions].sort((a, b) => {
      if (a.isPinned !== b.isPinned) {
        return a.isPinned ? -1 : 1;
      }
      return getSessionTimestamp(b) - getSessionTimestamp(a);
    });

    sortedSessions.forEach(session => fragment.appendChild(createSessionListItem(session)));
    sessionListEl.replaceChildren(fragment);
  };
  
  const createSessionListItem = (session) => {
    const item = sessionItemTemplate.content.cloneNode(true).firstElementChild;
    item.dataset.sessionId = session.id;

    if (session.isPinned) {
      item.classList.add('pinned');
    }
  
    const groupCount = new Set(session.tabs.map(t => t.groupId).filter(Boolean)).size;
    const sessionIdNum = getSessionTimestamp(session);
    const dateMeta = formatDate(sessionIdNum);
    const countMeta = `탭: ${session.tabs.length}${groupCount > 0 ? `, 그룹: ${groupCount}` : ''}`;
    
    // ▼▼▼ [수정됨] 긴 세션 이름에 마우스를 올리면 전체 이름이 보이도록 title 속성 추가 ▼▼▼
    const sessionNameEl = item.querySelector('.session-name');
    sessionNameEl.textContent = session.name;
    sessionNameEl.title = session.name;
    // ▲▲▲ [수정됨] ▲▲▲
    
    item.querySelector('.session-meta-date').textContent = dateMeta;
    item.querySelector('.session-meta-count').textContent = countMeta;
    
    const sessionActions = item.querySelector('.session-actions');
    
    const actions = [
      { action: CONSTANTS.ACTIONS.RESTORE, title: '복원(열기)', icon: '🚀' },
      { action: CONSTANTS.ACTIONS.COPY, title: 'URL 복사', icon: '📋' },
      { action: CONSTANTS.ACTIONS.UPDATE, title: '덮어쓰기', icon: '🔄' },
      { action: CONSTANTS.ACTIONS.RENAME, title: '이름 변경', icon: '✏️' },
      { action: CONSTANTS.ACTIONS.PIN, title: session.isPinned ? '고정 해제' : '세션 고정', icon: session.isPinned ? '📍' : '📌' },
      { action: CONSTANTS.ACTIONS.DELETE, title: '삭제', icon: '🗑️' },
    ];

    actions.forEach(({ action, title, icon }) => {
      sessionActions.appendChild(createActionButton(action, title, icon));
    });
  
    const detailsList = item.querySelector('.session-details-list');
    session.tabs.forEach(tab => {
      const tabItem = document.createElement('li');
      tabItem.textContent = tab.url;
      detailsList.appendChild(tabItem);
    });
  
    const sessionHeader = item.querySelector('.session-header');
    const sessionDetails = item.querySelector('.session-details');
    sessionHeader.addEventListener('click', (e) => {
      if (!e.target.closest('.beos-icon-button')) {
        sessionDetails.style.display = sessionDetails.style.display === 'block' ? 'none' : 'block';
      }
    });
  
    return item;
  };

  // --- 핵심 로직 ---

  const updateAndSaveSessions = async (updateFunction, { errorMessagePrefix }) => {
    const originalSessions = JSON.parse(JSON.stringify(allSessions));
    try {
        const successMessage = await updateFunction();
        if (successMessage === null) return; 
        
        await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
        renderSessions();
        if (successMessage) showToast(successMessage);
    } catch (e) {
        allSessions = originalSessions;
        renderSessions();
        showToast(`❌ ${errorMessagePrefix}: ${escapeHtml(e.message)}`);
    }
  };

  const getTabsToSave = async () => {
    try {
      const tabs = await chrome.tabs.query({});
      if (tabs.length === 0) return [];
      const windows = await chrome.windows.getAll();
      
      let allTabGroups = [];
      try {
        allTabGroups = (await Promise.all(windows.map(w => chrome.tabGroups.query({ windowId: w.id })))).flat();
      } catch (e) {
        showToast(CONSTANTS.MESSAGES.GET_TAB_GROUPS_FAILED);
      }

      const validTabs = tabs.filter(tab => tab.url && isValidUrl(tab.url));
      return validTabs.map(tab => ({ 
        url: tab.url, 
        title: tab.title, 
        pinned: tab.pinned, 
        groupId: tab.groupId,
        groupInfo: tab.groupId > -1 ? allTabGroups.find(g => g.id === tab.groupId) : null,
        windowId: tab.windowId
      }));
    } catch (error) {
      showToast(CONSTANTS.MESSAGES.GET_TABS_FAILED);
      return [];
    }
  };
  
  const generateUniqueSessionName = (baseName) => {
    if (!isDuplicateSessionName(baseName)) return baseName;
    let counter = 2, newName = `${baseName} (${counter})`;
    while (isDuplicateSessionName(newName)) newName = `${baseName} (${++counter})`;
    showToast(CONSTANTS.MESSAGES.createDuplicateNameWarning(newName));
    return newName;
  };

  const handleSaveSession = async (overwriteId = null, overwriteName = null) => {
    const tabs = await getTabsToSave();
    if (tabs.length === 0) {
      showToast(CONSTANTS.MESSAGES.NO_VALID_TABS_TO_SAVE);
      return;
    }

    await updateAndSaveSessions(
      () => {
        if (overwriteId) {
          const sessionIndex = allSessions.findIndex(s => String(s.id) === String(overwriteId));
          if (sessionIndex === -1) {
            showToast(CONSTANTS.MESSAGES.UPDATE_SESSION_NOT_FOUND);
            return null;
          }
          const name = overwriteName;
          allSessions[sessionIndex] = { ...allSessions[sessionIndex], tabs: tabs, name: name };
          return CONSTANTS.MESSAGES.createSessionUpdatedMessage(name);
        } else {
          let name = sessionInput.value.trim();
          if (!name) name = `${CONSTANTS.DEFAULTS.SESSION_PREFIX} ${formatDate(Date.now())}`;
          name = generateUniqueSessionName(name);
          allSessions.push({ id: generateUniqueId(), name, tabs, isPinned: false });
          sessionInput.value = '';
          return CONSTANTS.MESSAGES.createSessionSavedMessage(name);
        }
      },
      {
        errorMessagePrefix: CONSTANTS.MESSAGES.SESSION_SAVE_FAILED
      }
    );
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
        results.push(null);
      }
    }
    return results;
  };

  const getTargetWindow = async (restoreTarget) => {
    if (restoreTarget === CONSTANTS.RESTORE_TARGETS.NEW_WINDOW) {
      const newWindow = await chrome.windows.create({ focused: true });
      return { targetWindowId: newWindow.id, initialTabId: newWindow.tabs[0].id };
    }
    const currentWindow = await chrome.windows.getCurrent();
    return { targetWindowId: currentWindow.id, initialTabId: null };
  };

  const applyTabGroups = async (sessionTabs, createdTabs, targetWindowId) => {
    const groupsToCreate = new Map();
    sessionTabs.forEach((original, index) => {
      const newTab = createdTabs[index];
      if (newTab && original.groupId > -1 && original.groupInfo) {
        if (!groupsToCreate.has(original.groupId)) {
          groupsToCreate.set(original.groupId, { tabIds: [], info: original.groupInfo });
        }
        groupsToCreate.get(original.groupId).tabIds.push(newTab.id);
      }
    });

    for (const group of groupsToCreate.values()) {
      if (group.tabIds.length === 0) continue;
      try {
        const newGroupId = await chrome.tabs.group({ tabIds: group.tabIds, createProperties: { windowId: targetWindowId } });
        const updateProperties = {
          title: group.info?.title || 'Group',
          color: group.info?.color || 'grey'
        };
        if (typeof group.info?.collapsed === 'boolean') {
          updateProperties.collapsed = group.info.collapsed;
        }
        await chrome.tabGroups.update(newGroupId, updateProperties);
      } catch (e) {
        console.warn('TabHaiku: 탭 그룹 생성 또는 업데이트에 실패했습니다.', e);
      }
    }
  };

  const finalizeRestoration = async (validCreatedTabs, targetWindowId, initialTabId) => {
    const firstUnpinnedTab = validCreatedTabs.find(tab => !tab.pinned);
    const tabToActivate = firstUnpinnedTab || validCreatedTabs[0];

    if (tabToActivate) {
      await chrome.tabs.update(tabToActivate.id, { active: true });
    }

    if (chrome.windows.update) {
      await chrome.windows.update(targetWindowId, { focused: true });
    }
    if (initialTabId && validCreatedTabs.length > 0) {
      try { await chrome.tabs.remove(initialTabId); } catch (e) {}
    }
  };

  const handleRestoreSession = async (sessionId) => {
    const session = findSessionById(sessionId);
    if (!session) {
      showToast(CONSTANTS.MESSAGES.SESSION_NOT_FOUND);
      return;
    }

    showToast(CONSTANTS.MESSAGES.createSessionRestoreStartedMessage(session.name, selectedDelay));

    try {
      const { targetWindowId, initialTabId } = await getTargetWindow(selectedRestoreTarget);
      const createdTabs = await createTabsSequentiallyWithDelay(targetWindowId, session.tabs, selectedDelay * 1000);
      const validCreatedTabs = createdTabs.filter(Boolean);

      if (validCreatedTabs.length === 0 && selectedRestoreTarget === CONSTANTS.RESTORE_TARGETS.NEW_WINDOW && initialTabId) {
          showToast(CONSTANTS.MESSAGES.SESSION_RESTORE_FAILED);
          return;
      }
      
      await applyTabGroups(session.tabs, createdTabs, targetWindowId);
      await finalizeRestoration(validCreatedTabs, targetWindowId, initialTabId);

      if (validCreatedTabs.length > 0) {
          showToast(CONSTANTS.MESSAGES.createSessionRestoreCompletedMessage(session.name));
      } else {
          showToast(CONSTANTS.MESSAGES.SESSION_RESTORE_FAILED);
      }
    } catch (error) {
      showToast(CONSTANTS.MESSAGES.SESSION_RESTORE_ERROR);
    }
  };
  
  const handleUpdateSession = async (sessionId) => {
    const session = findSessionById(sessionId);
    if (!session) return;
    
    if (!confirm(CONSTANTS.MESSAGES.createConfirmUpdateMessage(session.name))) {
      return;
    }
    await handleSaveSession(sessionId, session.name);
  };

  const handleDeleteSession = async (sessionId) => {
    const sessionIndex = findSessionIndexById(sessionId);
    if (sessionIndex === -1) return;

    const sessionToDelete = allSessions[sessionIndex];
    
    allSessions.splice(sessionIndex, 1);
    
    try {
        await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
        renderSessions();

        const undoCallback = async () => {
            allSessions.push(sessionToDelete);
            try {
                await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
                renderSessions();
                showToast(CONSTANTS.MESSAGES.SESSION_RESTORED);
            } catch (e) {
                showToast(`❌ 복원 실패: ${escapeHtml(e.message)}`);
            }
        };

        showToast(
            CONSTANTS.MESSAGES.createSessionDeletedMessage(sessionToDelete.name), 
            CONSTANTS.UI.TOAST_DURATION, 
            undoCallback
        );
    } catch (e) {
        allSessions.splice(sessionIndex, 0, sessionToDelete);
        renderSessions();
        showToast(`❌ ${CONSTANTS.MESSAGES.DELETE_FAILED}: ${escapeHtml(e.message)}`);
    }
  };
  
  // ▼▼▼ [수정됨] 새 헬퍼 함수를 사용하도록 리팩토링 ▼▼▼
  const handleRenameSession = async (sessionId) => {
    const sessionData = findSessionDataOrShowError(sessionId);
    if (!sessionData) return;
    const { session, index: sessionIndex } = sessionData;

    const originalName = session.name;
    const newName = prompt('새 세션 이름을 입력하세요:', originalName);

    if (newName === null) return;
    const trimmedNewName = newName.trim();
    
    if (!trimmedNewName) {
      showToast(CONSTANTS.MESSAGES.NAME_CANNOT_BE_EMPTY);
      return;
    }
    if (trimmedNewName.length > CONSTANTS.UI.SESSION_NAME_MAX_LENGTH) {
      showToast(CONSTANTS.MESSAGES.createNameTooLongMessage(CONSTANTS.UI.SESSION_NAME_MAX_LENGTH));
      return;
    }
    if (trimmedNewName === originalName) return;
    if (isDuplicateSessionName(trimmedNewName, session.id)) {
      showToast(CONSTANTS.MESSAGES.createNameAlreadyExistsMessage(trimmedNewName));
      return;
    }
    
    await updateAndSaveSessions(
        () => {
            allSessions[sessionIndex].name = trimmedNewName;
            return CONSTANTS.MESSAGES.createNameChangedMessage(trimmedNewName);
        },
        {
            errorMessagePrefix: CONSTANTS.MESSAGES.RENAME_FAILED
        }
    );

    if (sessionInput.value.trim()) {
      sessionInput.value = '';
      renderSessions();
    }
  };
  // ▲▲▲ [수정됨] ▲▲▲

  // ▼▼▼ [수정됨] 새 헬퍼 함수를 사용하도록 리팩토링 ▼▼▼
  const handlePinSession = async (sessionId) => {
    const sessionData = findSessionDataOrShowError(sessionId);
    if (!sessionData) return;
    const { index: sessionIndex } = sessionData;
    
    await updateAndSaveSessions(
        () => {
            const session = allSessions[sessionIndex];
            session.isPinned = !session.isPinned;
            return session.isPinned ? CONSTANTS.MESSAGES.SESSION_PINNED : CONSTANTS.MESSAGES.SESSION_UNPINNED;
        },
        {
            errorMessagePrefix: CONSTANTS.MESSAGES.PIN_FAILED
        }
    );
  };
  // ▲▲▲ [수정됨] ▲▲▲
  
  // ▼▼▼ [수정됨] 새 헬퍼 함수를 사용하도록 리팩토링 ▼▼▼
  const handleCopySessionUrls = async (sessionId) => {
    const sessionData = findSessionDataOrShowError(sessionId);
    if (!sessionData) return;
    const { session } = sessionData;

    const urlsToCopy = session.tabs.map(tab => tab.url).join('\n');
    if (!urlsToCopy) {
        showToast(CONSTANTS.MESSAGES.NO_URLS_TO_COPY);
        return;
    }

    try {
        await navigator.clipboard.writeText(urlsToCopy);
        showToast(CONSTANTS.MESSAGES.URLS_COPIED);
    } catch (err) {
        showToast(CONSTANTS.MESSAGES.COPY_FAILED);
    }
  };
  // ▲▲▲ [수정됨] ▲▲▲

  const handleExport = () => {
    if (allSessions.length === 0) { showToast(CONSTANTS.MESSAGES.NO_SESSIONS_TO_EXPORT); return; }
    const dataStr = JSON.stringify(allSessions, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const filename = `${year}${month}${day}_TabHaiku_Backup.json`;
    
    chrome.downloads.download({ url, filename }, (downloadId) => {
      if (downloadId === undefined && chrome.runtime.lastError) {
        URL.revokeObjectURL(url);
      } else {
        setTimeout(() => URL.revokeObjectURL(url), CONSTANTS.TIMING.EXPORT_URL_REVOKE_DELAY);
      }
    });
    showToast(CONSTANTS.MESSAGES.EXPORT_SUCCESS);
  };

  const handleImport = () => {
    const file = importFileInput.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast(CONSTANTS.MESSAGES.IMPORT_FILE_TOO_LARGE);
      return importFileInput.value = '';
    }
    const reader = new FileReader();

    reader.onerror = () => {
        showToast(CONSTANTS.MESSAGES.IMPORT_FILE_READ_ERROR);
        importFileInput.value = '';
    };

    reader.onload = async (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported)) throw new Error("Invalid format");
        
        const valid = [];
        for (const s of imported) {
            if (isValidSession(s)) {
                if (!s.hasOwnProperty('isPinned')) {
                    s.isPinned = false;
                }
                valid.push(s);
            }
        }
        
        if (valid.length === 0) throw new Error(CONSTANTS.MESSAGES.IMPORT_NO_VALID_SESSIONS);
        
        const combinedSessions = [...allSessions];
        const combinedSessionNames = new Set(allSessions.map(s => s.name));
        const combinedSessionIds = new Set(allSessions.map(s => String(s.id)));

        for (const sessionToImport of valid) {
            if (combinedSessionIds.has(String(sessionToImport.id))) {
                sessionToImport.id = generateUniqueId();
            }
            
            let newName = sessionToImport.name;
            while (combinedSessionNames.has(newName)) {
                 const match = newName.match(/^(.*) \((\d+)\)$/);
                 if (match) {
                     newName = `${match[1]} (${parseInt(match[2], 10) + 1})`;
                 } else {
                     newName = `${newName} (2)`;
                 }
            }
            sessionToImport.name = newName;
            
            combinedSessions.push(sessionToImport);
            combinedSessionNames.add(sessionToImport.name);
            combinedSessionIds.add(String(sessionToImport.id));
        }

        allSessions = combinedSessions;
        await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, allSessions);
        renderSessions();
        showToast(CONSTANTS.MESSAGES.createImportSuccessMessage(valid.length));
      } catch (error) {
        showToast(error.message.startsWith('저장 공간') ? `❌ ${escapeHtml(error.message)}` : CONSTANTS.MESSAGES.IMPORT_INVALID_FORMAT);
      } finally {
        importFileInput.value = '';
      }
    };
    reader.readText(file);
  };

  const handleSessionAction = (e) => {
    const btn = e.target.closest('.beos-icon-button');
    if (!btn) return;
    const sessionItem = btn.closest('.session-item');
    if (!sessionItem) return;
    const sessionId = sessionItem.dataset.sessionId;

    const allActionButtons = sessionItem.querySelectorAll('.beos-icon-button');
    withLoadingState(allActionButtons, async () => {
      switch (btn.dataset.action) {
        case CONSTANTS.ACTIONS.RESTORE: await handleRestoreSession(sessionId); break;
        case CONSTANTS.ACTIONS.COPY: await handleCopySessionUrls(sessionId); break;
        case CONSTANTS.ACTIONS.UPDATE: await handleUpdateSession(sessionId); break;
        case CONSTANTS.ACTIONS.RENAME: await handleRenameSession(sessionId); break;
        case CONSTANTS.ACTIONS.PIN: await handlePinSession(sessionId); break;
        case CONSTANTS.ACTIONS.DELETE: await handleDeleteSession(sessionId); break;
      }
    });
  };

  const handleOptionChange = async (e) => {
    const btn = e.target.closest('.option-btn');
    if (!btn || btn.classList.contains('active')) return;

    const { key, value } = btn.dataset;
    const parsedValue = /^\d+$/.test(value) ? parseInt(value, 10) : value;
    
    const buttonGroup = btn.parentElement;
    buttonGroup.querySelector('.active')?.classList.remove('active');
    btn.classList.add('active');
    
    const stateUpdateMap = {
      [CONSTANTS.STORAGE_KEYS.DELAY]: (val) => { selectedDelay = val; },
      [CONSTANTS.STORAGE_KEYS.RESTORE_TARGET]: (val) => { selectedRestoreTarget = val; }
    };

    if (stateUpdateMap[key]) {
      stateUpdateMap[key](parsedValue);
    }

    try {
        await storage.set(key, parsedValue);
    } catch (err) {
        showToast(`${CONSTANTS.MESSAGES.OPTIONS_SAVE_FAILED}: ${escapeHtml(err.message)}`);
    }
  };

  const cleanup = () => {
    if (toastTimeout) clearTimeout(toastTimeout);
    if (inputDebounce) clearTimeout(inputDebounce);
  };

  const setActiveOptionButton = (groupSelector, value) => {
    document.querySelectorAll(`${groupSelector} .option-btn`).forEach(b => {
      const isActive = String(b.dataset.value) === String(value);
      b.classList.toggle('active', isActive);
    });
  };

  // --- 초기화 및 이벤트 리스너 ---
  const initialize = async () => {
    sessionInput.maxLength = CONSTANTS.UI.SESSION_NAME_MAX_LENGTH;

    const [delay, restoreTarget, sessions] = await Promise.all([
        storage.get(CONSTANTS.STORAGE_KEYS.DELAY, 0),
        storage.get(CONSTANTS.STORAGE_KEYS.RESTORE_TARGET, CONSTANTS.RESTORE_TARGETS.CURRENT_WINDOW),
        storage.get(CONSTANTS.STORAGE_KEYS.SESSIONS, [])
    ]);

    selectedDelay = delay;
    selectedRestoreTarget = restoreTarget;
    allSessions = sessions;
    
    setActiveOptionButton('.delay-btn-group', selectedDelay);
    setActiveOptionButton('.restore-target-btn-group', selectedRestoreTarget);

    renderSessions();
    
    saveBtn.addEventListener('click', () => withLoadingState(saveBtn, handleSaveSession));

    saveCurrentBtn.addEventListener('click', (e) => { e.preventDefault(); saveBtn.click(); });
    sessionInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); } });
    
    sessionInput.addEventListener('input', () => {
      clearTimeout(inputDebounce);
      inputDebounce = setTimeout(renderSessions, CONSTANTS.UI.SEARCH_DEBOUNCE_TIME);
    });
    
    exportBtn.addEventListener('click', (e) => { e.preventDefault(); handleExport(); });
    importBtn.addEventListener('click', (e) => { e.preventDefault(); importFileInput.click(); });
    importFileInput.addEventListener('change', handleImport);
    
    sessionListEl.addEventListener('click', handleSessionAction);
    
    delayBtnGroup.addEventListener('click', handleOptionChange);
    restoreTargetBtnGroup.addEventListener('click', handleOptionChange);

    window.addEventListener('pagehide', cleanup);
  };

  initialize();
});