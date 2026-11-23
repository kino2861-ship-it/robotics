// 会話文と次の選択肢は uni-story.js に置く。
// story-compiler.js が既存の表示処理で使う形式へ変換する。
const CHAT_SCRIPTS = [window.compileUniStory(window.UNI_STORY), {
  ...window.UNI_STORY.grandfatherChat, messages: [], prompts: {}, troubleIds: [], troubleBranches: {}
}];

// 自分のアイコン画像。未設定なら従来の文字アイコンを表示する。
const SELF_AVATAR = '';
const IMAGE_DISPLAY_ERROR = '画像の表示に失敗しました';

const $ = selector => document.querySelector(selector);
const elements = {
  list: $('#conversation-items'), count: $('#list-count'),
  messages: $('#messages'), scroll: $('#chat-scroll'), suggestions: $('#suggestions'),
  input: $('#message-input'), form: $('#message-form'), send: $('#send-button'),
  name: $('.contact-name'), headerAvatar: $('.avatar-header'),
  notice: $('#notice'), choicePanel: $('#choice-panel'), promptActions: $('#prompt-actions'),
  suggestionHeading: $('#suggestion-heading'), pickerBack: $('#picker-back'), pickerEmpty: $('#picker-empty'),
  backdrop: $('#picker-backdrop'), shell: $('.app-shell')
};
// 操作説明は全トーク共通で、初回と全トークのリセット後に一度だけ表示する。
const TUTORIAL_STORAGE_KEY = 'chat-simulator:tutorial:v2';
const tutorial = {
  dialog: $('#chat-tutorial'), card: $('.tutorial-card'), spotlight: $('.tutorial-spotlight'),
  title: $('#tutorial-title'), description: $('#tutorial-description'), stepLabel: $('#tutorial-step'),
  next: $('#tutorial-next'), back: $('#tutorial-back'), step: 0, seen: false
};
try { tutorial.seen = localStorage.getItem(TUTORIAL_STORAGE_KEY) === 'done'; } catch (_) { /* 保存不可でもページ内では一度だけ。 */ }
const resetDialog = {
  dialog: $('#reset-dialog'), title: $('#reset-title'), description: $('#reset-description'),
  confirm: $('#reset-confirm'), cancel: $('#reset-cancel'), step: 0
};

// 文面の編集では履歴を消さない。進行データの形式を変える場合だけ番号を更新する。
const STORAGE_SCHEMA_VERSION = 1;
const LEGACY_STORAGE_KEYS = { uni: ['chat-simulator:uni:27r61r'] };

// 削除した仮チャットの保存履歴も片付ける。UNIや操作説明の保存には触れない。
try {
  for (const key of Object.keys(localStorage)) {
    if (/^chat-simulator:(?:[a-z0-9]+|(?:mio|haru):[a-z0-9]+)$/.test(key)) localStorage.removeItem(key);
  }
} catch (_) { /* 保存データにアクセスできなくてもUNIの会話を開始できる。 */ }

const chats = new Map(CHAT_SCRIPTS.map(script => [script.id, {
  script, storageKey: `chat-simulator:${script.id}:state-v${STORAGE_SCHEMA_VERSION}`, startedAt: Date.now(),
  transcript: [], undoHistory: [], completed: new Set(), activePromptId: null,
  visitedTroubles: new Set(), activeTroubleId: null, replayTroubleId: null,
  pendingJob: null, unreadCount: 0, hasOpened: false, generation: 0, draft: ''
}]));
let active = chats.values().next().value;
let noticeTimer;
let historyView = false;

function clock(date = new Date()) {
  return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(date);
}
function dateLabel(date = new Date()) {
  return new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' }).format(date);
}
function saveState(chat) {
  try {
    localStorage.setItem(chat.storageKey, JSON.stringify({
      startedAt: chat.startedAt, transcript: chat.transcript,
      completed: [...chat.completed], activePromptId: chat.activePromptId,
      visitedTroubles: [...chat.visitedTroubles], activeTroubleId: chat.activeTroubleId,
      replayTroubleId: chat.replayTroubleId,
      pendingJob: chat.pendingJob, unreadCount: chat.unreadCount,
      hasOpened: chat.hasOpened, draft: chat.draft, undoHistory: chat.undoHistory
    }));
  } catch (_) { /* 保存できない環境でも会話は続けられます。 */ }
}
function mobileChatId() {
  if (location.hash === '#chat') return CHAT_SCRIPTS[0]?.id;
  const match = location.hash.match(/^#chat\/([^/]+)$/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch (_) { return null; }
}
function isChatSelected(chat) {
  return chat === active && location.hash !== '#list' &&
    (!matchMedia('(max-width: 700px)').matches || mobileChatId() === chat.script.id);
}
function isChatVisible(chat) {
  return !document.hidden && isChatSelected(chat);
}
function isChatUnlocked(chat) {
  const requirement = chat.script.requires;
  if (!requirement) return true;
  return chats.get(requirement.contactId)?.completed.has(requirement.completed) || false;
}
function normalized(value) {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}
function activePrompt(chat) {
  const prompt = chat.script.prompts?.[chat.activePromptId]
    ?? chat.script.messages.find(item => item.id === chat.activePromptId)?.freeText;
  return typeof prompt === 'string' ? chat.script.prompts?.[prompt] : prompt;
}
function hasAnyCompleted(chat, ids) {
  return (Array.isArray(ids) ? ids : [ids]).some(id => chat.completed.has(id));
}
function isStoryEnded(chat) {
  return chat.completed.has('result-miss') || chat.completed.has('game-clear');
}
function isUnlocked(chat, item) {
  const { all = [], any = [], none = [], notDuring = [] } = item.requires || {};
  return all.every(id => chat.completed.has(id)) &&
    none.every(id => !chat.completed.has(id)) &&
    notDuring.every(({ start, end }) => !chat.completed.has(start) || hasAnyCompleted(chat, end)) &&
    (any.length === 0 || any.some(id => chat.completed.has(id)));
}
function resetTroubleProgress(chat, id) {
  const branch = chat.script.troubleBranches[id];
  if (!branch) return;
  // 会話の表示履歴はそのままに、選択済みの場面だけ最初に戻す。
  for (const completedId of [...branch.sceneIds, ...branch.answerIds, branch.returnId]) {
    chat.completed.delete(completedId);
  }
}
function returnToTroubleMenu() {
  const chat = active;
  if (!chat.activeTroubleId || chat.pendingJob) return;
  chat.generation++;
  chat.pendingJob = null;
  chat.completed.add(chat.script.troubleBranches[chat.activeTroubleId].returnId);
  chat.activeTroubleId = null;
  chat.activePromptId = null;
  chat.replayTroubleId = null;
  chat.draft = '';
  historyView = false;
  elements.input.value = '';
  saveState(chat);
  renderConversation(chat);
}
function choiceText(chat, item) {
  return item.labelVariants?.find(variant => isUnlocked(chat, { requires: variant.when }))?.text || item.text;
}
function showNotice(message) {
  elements.notice.textContent = message;
  elements.notice.classList.add('visible');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => elements.notice.classList.remove('visible'), 3200);
}
function scrollToLatest() {
  requestAnimationFrame(() => { elements.scroll.scrollTop = elements.scroll.scrollHeight; });
}
function messageParts(message) {
  return typeof message === 'string' ? { text: message } : message || {};
}
function promptMessage(message, input) {
  const parts = messageParts(message);
  return typeof parts.text === 'string' && parts.text.includes('{input}')
    ? { ...parts, text: parts.text.replaceAll('{input}', input) } : parts;
}
function messageRecords(message, mine, iso = new Date().toISOString()) {
  const { text = '', image, alt, file } = messageParts(message);
  const details = { mine, iso, read: false };
  const records = [];
  if (text || (!image && !file)) records.push({ text, ...details });
  if (file) records.push({ text: '', file, ...details });
  if (image) records.push({ text: '', image, alt: alt || '画像', ...details });
  return records;
}
function messagePreview(message) {
  return message?.text || message?.file?.name || (message?.image ? message.alt || '写真' : 'メッセージを送って会話を始める');
}
function setAvatar(element, name, image) {
  element.replaceChildren();
  if (image) {
    const img = document.createElement('img');
    img.alt = '';
    img.addEventListener('error', () => {
      const fallback = document.createElement('span');
      fallback.className = 'avatar-image-error';
      fallback.textContent = IMAGE_DISPLAY_ERROR;
      img.replaceWith(fallback);
    }, { once: true });
    element.append(img);
    img.src = image;
  } else {
    element.textContent = name.slice(0, 1);
  }
}
function renderList() {
  const visibleChats = [...chats.values()].filter(isChatUnlocked);
  elements.count.textContent = String(visibleChats.length);
  const entries = visibleChats.sort((a, b) => {
    const aTime = Date.parse(a.transcript.at(-1)?.iso || 0) || 0;
    const bTime = Date.parse(b.transcript.at(-1)?.iso || 0) || 0;
    return bTime - aTime;
  });
  elements.list.replaceChildren(...entries.map(chat => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'conversation-item';
    item.dataset.chatId = chat.script.id;
    if (isChatSelected(chat)) item.setAttribute('aria-current', 'true');
    const unread = chat.unreadCount;
    item.setAttribute('aria-label', `${chat.script.contact}とのトークを開く${unread ? `、未読${unread}件` : ''}`);
    const avatar = document.createElement('span');
    avatar.className = 'avatar avatar-small';
    avatar.setAttribute('aria-hidden', 'true');
    setAvatar(avatar, chat.script.contact, chat.script.avatar);
    const summary = document.createElement('span');
    summary.className = 'conversation-summary';
    const title = document.createElement('span');
    title.className = 'conversation-title';
    title.textContent = chat.script.contact;
    const preview = document.createElement('span');
    preview.className = 'conversation-preview';
    preview.textContent = messagePreview(chat.transcript.at(-1));
    summary.append(title, preview);
    const side = document.createElement('span');
    side.className = 'conversation-side';
    const time = document.createElement('time');
    time.className = 'conversation-time';
    const last = chat.transcript.at(-1);
    if (last) {
      time.textContent = clock(new Date(last.iso));
      time.dateTime = last.iso;
    }
    const badge = document.createElement('span');
    badge.className = 'unread-badge';
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    side.append(time, badge);
    item.append(avatar, summary, side);
    return item;
  }));
}
function markRead(chat) {
  if (chat.unreadCount === 0 && chat.hasOpened) return;
  chat.hasOpened = true;
  chat.unreadCount = 0;
  saveState(chat);
  renderList();
}
function renderRecord(chat, record, index) {
  const row = document.createElement('div');
  row.className = `message-row ${record.mine ? 'mine' : 'theirs'}`;
  if (!record.mine) {
    const avatar = document.createElement('div');
    avatar.className = 'avatar message-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    setAvatar(avatar, chat.script.contact, chat.script.avatar);
    row.append(avatar);
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (record.text) {
    const caption = document.createElement('span');
    caption.className = 'message-text';
    caption.textContent = record.text;
    bubble.append(caption);
  }
  if (record.file) bubble.append(createFileCard(record.file, record.iso));
  // 旧履歴には生成後のファイル名が入っている場合もある。
  if (['./images/clearCard.jpg', './images/clearCard2.jpg'].includes(record.image) && chat.completed.has('game-clear')) {
    // 成功後は送信が閉じるため、最後の S0007 が受理された送信。旧版の履歴にも同じ時刻がある。
    const sent = chat.transcript.findLast(entry => entry.mine && normalized(entry.text) === 's0007');
    bubble.classList.add('image-only');
    if (sent) {
      bubble.append(createClearCard('./images/clearCard.jpg', chat.startedAt, Date.parse(sent.iso), scrollToLatest));
    } else {
      bubble.textContent = IMAGE_DISPLAY_ERROR;
    }
  } else if (record.image) {
    bubble.classList.add('has-image');
    if (!record.text) bubble.classList.add('image-only');
    const img = document.createElement('img');
    img.className = 'message-image';
    img.alt = record.alt || '画像';
    img.loading = 'lazy';
    img.addEventListener('load', scrollToLatest, { once: true });
    img.addEventListener('error', () => {
      const fallback = document.createElement('div');
      fallback.className = 'image-placeholder';
      fallback.textContent = IMAGE_DISPLAY_ERROR;
      img.replaceWith(fallback);
      scrollToLatest();
    }, { once: true });
    bubble.append(img);
    img.src = record.image;
  }
  const meta = document.createElement('time');
  meta.className = 'message-meta';
  meta.textContent = `${record.mine && record.read ? '既読  ' : ''}${clock(new Date(record.iso))}`;
  meta.dateTime = record.iso;
  row.dataset.index = index;
  if (record.mine) row.append(meta, bubble);
  else row.append(bubble, meta);
  return row;
}
function appendMessage(chat, message, mine = false) {
  const records = messageRecords(message, mine);
  const startIndex = chat.transcript.length;
  chat.transcript.push(...records);
  if (!mine && !isChatVisible(chat)) chat.unreadCount += records.length;
  if (chat === active) {
    elements.messages.querySelector('.empty-prompt')?.remove();
    elements.messages.append(...records.map((record, offset) => renderRecord(chat, record, startIndex + offset)));
    scrollToLatest();
  }
  saveState(chat);
  renderList();
  return records.map((_, offset) => startIndex + offset);
}
function startEndingFeed(chat) {
  if (chat.script.id !== 'uni' || !chat.completed.has('ending') ||
      chat.completed.has('ending-feed-complete') || chat.pendingJob) return;
  const replies = window.UNI_STORY.endingMessages.slice(1).map(messageParts);
  if (!replies.length) {
    chat.completed.add('ending-feed-complete');
    saveState(chat);
    return;
  }
  chat.pendingJob = {
    phase: 'replies', replies, nextIndex: 0,
    dueAt: Date.now() + (replies[0].delayMs ?? DEFAULT_REPLY_DELAY_MS),
    onComplete: 'ending-feed-complete'
  };
  saveState(chat);
  void runPending(chat, chat.generation);
}
function renderConversation(chat) {
  active = chat;
  if (chat.script.id === 'grandfather') {
    const uni = chats.get('uni');
    if (uni?.completed.has('game-clear') && !uni.completed.has('ending')) {
      uni.completed.add('ending');
      const firstMessage = window.UNI_STORY.endingMessages[0];
      appendMessage(uni, firstMessage, false);
      saveState(uni);
    }
    chat.completed.add('ending');
    saveState(chat);
  }
  startEndingFeed(chat);
  closePicker();
  elements.name.textContent = chat.script.contact;
  setAvatar(elements.headerAvatar, chat.script.contact, chat.script.avatar);
  elements.scroll.setAttribute('aria-label', `${chat.script.contact}とのトーク`);
  document.title = `${chat.script.contact}とのトーク | chatTalk`;
  elements.input.value = chat.draft;
  const date = document.createElement('div');
  date.className = 'date-label';
  date.textContent = dateLabel(new Date(chat.startedAt));
  elements.messages.replaceChildren(date, ...chat.transcript.map((record, i) => renderRecord(chat, record, i)));
  if (chat.transcript.length === 0) {
    const prompt = document.createElement('div');
    prompt.className = 'empty-prompt';
    prompt.textContent = 'メッセージを送って会話を始めましょう';
    elements.messages.append(prompt);
  }
  renderSuggestions();
  renderList();
  if (isChatVisible(chat)) markRead(chat);
  scrollToLatest();
}
function renderSuggestions() {
  const chat = active;
  const busy = !!chat.pendingJob;
  const freeText = activePrompt(chat);
  const menuAvailable = !isStoryEnded(chat) && !freeText && !chat.activeTroubleId &&
    chat.completed.has(chat.script.troubleUnlockAfter);
  const showingHistory = menuAvailable && historyView;
  elements.suggestions.replaceChildren();
  elements.promptActions.replaceChildren();
  elements.suggestionHeading.textContent = showingHistory ? '以前相談した内容' : '送れるメッセージ';
  elements.choicePanel.setAttribute('aria-label', showingHistory ? '以前相談した内容を選択' : '送れるメッセージを選択');
  elements.pickerBack.hidden = !showingHistory;
  elements.pickerEmpty.hidden = !showingHistory || chat.visitedTroubles.size > 0;
  if (chat.activeTroubleId && freeText && !busy) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'show-choices';
    button.textContent = '選択肢を表示';
    button.addEventListener('click', () => {
      elements.input.blur();
      if (elements.choicePanel.hidden) openPicker(); else closePicker();
    });
    elements.promptActions.append(button);
  }
  for (const action of freeText?.actions || []) {
    if (busy || action.hideAfter && chat.completed.has(action.hideAfter)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label || action.text;
    button.addEventListener('click', () => {
      chat.draft = action.text;
      elements.input.value = action.text;
      saveState(chat);
      renderSuggestions();
    });
    elements.promptActions.append(button);
  }
  elements.promptActions.hidden = !elements.promptActions.children.length;
  if (showingHistory) {
    for (const id of chat.script.troubleIds) {
      if (!chat.visitedTroubles.has(id)) continue;
      const item = chat.script.messages.find(candidate => candidate.id === id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'suggestion';
      button.disabled = busy;
      button.textContent = item.text;
      button.addEventListener('click', () => {
        chat.replayTroubleId = id;
        chat.draft = item.text;
        elements.input.value = item.text;
        saveState(chat);
        closePicker();
        renderSuggestions();
      });
      elements.suggestions.append(button);
    }
  } else if (!freeText && !isStoryEnded(chat)) {
    for (const item of chat.script.messages) {
      if (!isUnlocked(chat, item)) continue;
      const sent = chat.completed.has(item.id);
      const keepSentChoice = sent && item.retireAfter &&
        (!hasAnyCompleted(chat, item.retireAfter) || !!chat.pendingJob);
      if (sent && !keepSentChoice) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = sent ? 'suggestion is-sent' : 'suggestion';
      button.disabled = busy || sent;
      button.textContent = choiceText(chat, item);
      button.addEventListener('click', () => {
        chat.replayTroubleId = null;
        chat.draft = button.textContent;
        elements.input.value = button.textContent;
        saveState(chat);
        closePicker();
        renderSuggestions();
      });
      elements.suggestions.append(button);
    }
    if (menuAvailable) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'suggestion is-history-entry';
      button.textContent = '以前相談した内容について再び相談する';
      button.addEventListener('click', () => {
        historyView = true;
        chat.replayTroubleId = null;
        chat.draft = '';
        elements.input.value = '';
        saveState(chat);
        renderSuggestions();
      });
      elements.suggestions.append(button);
    }
  }
  if (chat.activeTroubleId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion is-return-entry';
    button.textContent = '他のトラブルについて相談する';
    button.disabled = busy;
    button.addEventListener('click', returnToTroubleMenu);
    elements.suggestions.append(button);
  }
  const noChoices = elements.suggestions.children.length === 0;
  elements.input.readOnly = !freeText;
  elements.input.setAttribute('inputmode', freeText ? 'text' : 'none');
  if (freeText) elements.input.removeAttribute('aria-haspopup');
  else elements.input.setAttribute('aria-haspopup', 'dialog');
  elements.input.disabled = busy || (!freeText && noChoices);
  elements.input.placeholder = !busy && !freeText && noChoices
    ? '送れるメッセージはありません' : 'メッセージを入力';
  elements.send.disabled = busy || (!freeText && noChoices) || !elements.input.value.trim();
}
function openPicker() {
  if (active.pendingJob || (active.activePromptId && !active.activeTroubleId)) return;
  renderSuggestions();
  elements.choicePanel.hidden = false;
  elements.backdrop.hidden = false;
  elements.input.setAttribute('aria-expanded', 'true');
}
function closePicker() {
  historyView = false;
  elements.choicePanel.hidden = true;
  elements.backdrop.hidden = true;
  elements.input.setAttribute('aria-expanded', 'false');
}
const tutorialSteps = [
  ['メッセージ欄をタッチ', '下の欄をタッチして、メッセージを選びます。文字入力を求められたら、ここに回答を入力します。'],
  ['送信ボタンをタッチ', 'メッセージを用意したら、右の送信ボタンをタッチ。相手からの返信を待ちましょう。'],
  ['メニュー', '「送信取り消し」で直近のメッセージの送信を取り消すことができます。「UNIとのトークをやり直す」から、UNIとのトーク履歴をリセットできます。'],
  ['右にスワイプして戻る', 'トーク画面を右にスワイプすると、トーク一覧に戻れます。左上の矢印からも戻れます。']
];
function tutorialStepCount() {
  return matchMedia('(max-width: 700px)').matches ? tutorialSteps.length : tutorialSteps.length - 1;
}
function renderTutorialStep() {
  const totalSteps = tutorialStepCount();
  tutorial.totalSteps = totalSteps;
  tutorial.step = Math.min(tutorial.step, totalSteps - 1);
  const isFinal = tutorial.step === totalSteps - 1;
  tutorial.dialog.dataset.step = String(tutorial.step);
  tutorial.stepLabel.textContent = `${tutorial.step + 1} / ${totalSteps}`;
  [tutorial.title.textContent, tutorial.description.textContent] = tutorialSteps[tutorial.step];
  tutorial.next.querySelector('span').textContent = isFinal ? 'はじめる' : '次へ';
  tutorial.back.hidden = tutorial.step === 0;
  positionTutorial();
}
function positionTutorial() {
  if (!tutorial.dialog.open) return;
  const viewport = window.visualViewport;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  Object.assign(tutorial.dialog.style, {
    left: `${viewport?.offsetLeft ?? 0}px`, top: `${viewport?.offsetTop ?? 0}px`,
    width: `${width}px`, height: `${height}px`
  });
  const origin = tutorial.dialog.getBoundingClientRect();
  const form = elements.form.getBoundingClientRect();
  const send = elements.send.getBoundingClientRect();
  const headerButton = tutorial.step >= 2
    ? $(tutorial.step === 2 ? '#header-reset' : '#back-to-list').getBoundingClientRect() : null;
  const isSend = tutorial.step === 1;
  const target = headerButton ? {
    left: headerButton.left - origin.left - 5, top: headerButton.top - origin.top - 5,
    width: headerButton.width + 10, height: headerButton.height + 10
  } : {
    left: (isSend ? send.left - 5 : form.left) - origin.left,
    top: (isSend ? send.top - 5 : form.top - 2) - origin.top,
    width: isSend ? send.width + 10 : send.left - form.left - 7,
    height: isSend ? send.height + 10 : form.height + 4
  };
  Object.assign(tutorial.spotlight.style, {
    left: `${target.left}px`, top: `${target.top}px`,
    width: `${target.width}px`, height: `${target.height}px`
  });
  // 短い横向き画面では本文だけをスクロールさせ、操作ボタンを残す。
  tutorial.card.style.maxHeight = `${Math.max(128, Math.min(
    headerButton ? height - target.top - target.height - 38 : target.top - 38,
    height - 32
  ))}px`;
  const card = tutorial.card.getBoundingClientRect();
  const center = target.left + target.width / 2;
  const left = Math.max(16, Math.min(center - card.width / 2, width - card.width - 16));
  tutorial.card.style.left = `${left}px`;
  tutorial.card.style.top = `${Math.max(16, Math.min(
    headerButton ? target.top + target.height + 22 : target.top - card.height - 22,
    height - card.height - 16
  ))}px`;
  tutorial.card.style.setProperty('--pointer-left', `${Math.max(24, Math.min(center - left, card.width - 24))}px`);
}
function closeTutorial(complete = true) {
  if (!tutorial.dialog.open) return;
  if (complete) {
    tutorial.seen = true;
    try { localStorage.setItem(TUTORIAL_STORAGE_KEY, 'done'); } catch (_) { /* メモリ内の表示済み状態は維持する。 */ }
  }
  tutorial.dialog.close();
  if (!document.hidden) {
    const target = isChatVisible(active) ? $('#chat-panel') : elements.list.querySelector('[aria-current="true"]');
    target?.focus({ preventScroll: true });
  }
}
function syncTutorial() {
  if (resetDialog.dialog.open || chatMenu.open) return;
  if (!isChatVisible(active)) {
    closeTutorial(false);
    return;
  }
  if (tutorial.seen) return;
  if (!tutorial.dialog.open) {
    closePicker();
    tutorial.dialog.showModal();
    renderTutorialStep();
    tutorial.next.focus({ preventScroll: true });
  } else {
    if (tutorial.totalSteps !== tutorialStepCount()) renderTutorialStep();
    else positionTutorial();
  }
}
function showTyping(chat) {
  if (chat !== active || !isChatVisible(chat)) return null;
  const row = document.createElement('div');
  row.className = 'message-row theirs typing';
  row.setAttribute('aria-label', `${chat.script.contact}が入力中`);
  const avatar = document.createElement('div');
  avatar.className = 'avatar message-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  setAvatar(avatar, chat.script.contact, chat.script.avatar);
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'typing-dot';
    bubble.append(dot);
  }
  row.append(avatar, bubble);
  elements.messages.append(row);
  scrollToLatest();
  return row;
}
const DEFAULT_REPLY_DELAY_MS = 2000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runPending(chat, token) {
  const job = chat.pendingJob;
  if (!job) return;
  if (job.phase === 'read') {
    await delay(Math.max(0, job.readAt - Date.now()));
    if (token !== chat.generation || chat.pendingJob !== job) return;
    for (const outgoingIndex of job.outgoingIndices || [job.outgoingIndex]) {
      const sent = chat.transcript[outgoingIndex];
      if (!sent) continue;
      sent.read = true;
      if (chat === active) {
        const meta = elements.messages.querySelector(`[data-index="${outgoingIndex}"] .message-meta`);
        if (meta) meta.textContent = `既読  ${clock(new Date(sent.iso))}`;
      }
    }
    job.phase = 'replies';
    job.dueAt = job.readAt + (job.replies[0]?.delayMs ?? job.firstDelayMs);
    saveState(chat);
  }
  while (job.nextIndex < job.replies.length) {
    const remaining = Math.max(0, job.dueAt - Date.now());
    const typing = remaining > 0 ? showTyping(chat) : null;
    if (remaining > 0) await delay(remaining);
    if (token !== chat.generation || chat.pendingJob !== job) {
      typing?.remove();
      return;
    }
    typing?.remove();
    const reply = job.replies[job.nextIndex++];
    if (job.nextIndex < job.replies.length) {
      job.dueAt = Date.now() + (job.replies[job.nextIndex].delayMs ?? DEFAULT_REPLY_DELAY_MS);
    }
    appendMessage(chat, reply, false);
  }
  if (token !== chat.generation || chat.pendingJob !== job) return;
  chat.pendingJob = null;
  if (job.onComplete) chat.completed.add(job.onComplete);
  if (job.finishTroubleId && job.finishTroubleId === chat.activeTroubleId) chat.activeTroubleId = null;
  if (job.followUpId) chat.activePromptId = job.followUpId;
  saveState(chat);
  renderList();
  if (chat === active) renderSuggestions();
}
async function send(raw) {
  const chat = active;
  const text = raw.trim();
  if (!text || chat.pendingJob) return;
  if (isStoryEnded(chat)) return showNotice('この先のトラブル選択は終了しています');
  const beforeSend = {
    length: chat.transcript.length, completed: [...chat.completed], visitedTroubles: [...chat.visitedTroubles],
    activePromptId: chat.activePromptId, activeTroubleId: chat.activeTroubleId,
    replayTroubleId: chat.replayTroubleId, draft: chat.draft, unreadCount: chat.unreadCount
  };
  if (chat.replayTroubleId) {
    const replayId = chat.replayTroubleId;
    chat.replayTroubleId = null;
    const replayItem = chat.script.messages.find(candidate => candidate.id === replayId);
    if (replayItem && normalized(replayItem.text) === normalized(text)) resetTroubleProgress(chat, replayId);
  }
  const prompt = activePrompt(chat);
  const answer = prompt?.answers.find(candidate =>
    candidate.matches.some(match => normalized(match) === normalized(text)));
  const matchingItems = prompt ? [] : chat.script.messages.filter(candidate =>
    [candidate.text, ...(candidate.aliases || [])].some(phrase => normalized(phrase) === normalized(text)));
  const item = matchingItems.find(candidate =>
    !chat.completed.has(candidate.id) && isUnlocked(chat, candidate))
    || matchingItems[0];
  if (item && chat.completed.has(item.id)) return showNotice('このメッセージは送信済みです');
  if (answer?.once && chat.completed.has(answer.id)) return showNotice('このメッセージは送信済みです');
  if (item && !isUnlocked(chat, item)) return showNotice(item.lockedHint || '先に必要なメッセージを送ってね');
  const startsConversation = chat.script.opening.length === 0 && chat.completed.size === 0;
  chat.undoHistory.push(beforeSend);
  closePicker();
  chat.draft = '';
  elements.input.value = '';
  if (item) {
    chat.completed.add(item.id);
    if (item.troubleId) {
      if (item.id === item.troubleId) chat.visitedTroubles.add(item.id);
      chat.activeTroubleId = item.troubleId;
    }
  }
  if (answer) {
    chat.completed.add(answer.id);
    chat.activePromptId = null;
  }
  const replyVariant = item?.replyVariants?.find(variant => isUnlocked(chat, { requires: variant.when }));
  const resultReplies = prompt
    ? (answer ? answer.replies : Array.isArray(prompt.invalidReply) ? prompt.invalidReply : [prompt.invalidReply])
    : item ? (replyVariant?.replies || item.replies) : [chat.script.fallback];
  const beforeReplies = (prompt?.beforeReplies || []).map(entry => promptMessage(entry, text));
  const replies = resultReplies.map(entry => prompt ? promptMessage(entry, text) : messageParts(entry));
  if (beforeReplies.length && replies.length && prompt.resultDelayMs != null) {
    replies[0] = { ...replies[0], delayMs: prompt.resultDelayMs };
  }
  const outgoingIndices = appendMessage(chat, item ? { text, image: item.image, alt: item.alt } : text, true);
  chat.pendingJob = {
    phase: 'read', outgoingIndex: outgoingIndices.at(-1), outgoingIndices,
    readAt: Date.now() + (chat.script.readDelayMs ?? 500),
    replies: [...beforeReplies, ...replies],
    nextIndex: 0, dueAt: null,
    firstDelayMs: startsConversation
      ? (chat.script.startReplyDelayMs ?? DEFAULT_REPLY_DELAY_MS)
      : DEFAULT_REPLY_DELAY_MS,
    finishTroubleId: item?.finishTrouble ? item.troubleId : null,
    followUpId: answer?.nextPromptId ?? (typeof item?.freeText === 'string' ? item.freeText : item?.freeText ? item.id : null)
  };
  if (answer?.onComplete) chat.pendingJob.onComplete = answer.onComplete;
  if (chat === active) renderSuggestions();
  saveState(chat);
  await runPending(chat, chat.generation);
}
function resetConversation(chat = active, render = true, startedAt = Date.now()) {
  chat.undoHistory.length = 0;
  chat.generation++;
  chat.startedAt = startedAt;
  chat.transcript = [];
  chat.completed.clear();
  chat.activePromptId = null;
  chat.visitedTroubles.clear();
  chat.activeTroubleId = null;
  chat.replayTroubleId = null;
  historyView = false;
  chat.pendingJob = null;
  chat.unreadCount = 0;
  chat.hasOpened = false;
  chat.draft = '';
  for (const message of chat.script.opening) {
    chat.transcript.push(...messageRecords(message, false));
  }
  chat.unreadCount = chat.transcript.length;
  saveState(chat);
  if (!render) return;
  if (chat === active) renderConversation(chat);
  else renderList();
}
function renderResetStep() {
  const finalStep = resetDialog.step === 1;
  resetDialog.title.textContent = finalStep ? '最終確認' : 'リセットの確認';
  resetDialog.description.textContent = finalStep
    ? 'この操作は取り消せません。よろしいですか？'
    : 'UNIのすべてのトーク履歴とメモリをリセットしますか？この処理は取り消しできません。';
  resetDialog.confirm.textContent = finalStep ? 'はい' : 'リセットする';
  resetDialog.cancel.textContent = finalStep ? 'いいえ' : 'リセットしない';
  resetDialog.cancel.focus({ preventScroll: true });
}
function openResetDialog() {
  if (resetDialog.dialog.open) return;
  closePicker();
  closeTutorial(false);
  resetDialog.step = 0;
  renderResetStep();
  resetDialog.dialog.showModal();
  resetDialog.cancel.focus({ preventScroll: true });
}
function closeResetDialog() {
  resetDialog.dialog.close();
  scheduleViewportUpdate();
}
function resetAllConversations() {
  closeTutorial(false);
  // 先に一覧へ戻し、初期化中にトークを既読にしたり操作説明を開いたりしない。
  backToList();
  try {
    // シナリオ変更前の履歴も含めて、このアプリの保存データだけを削除する。
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('chat-simulator:')) localStorage.removeItem(key);
    }
  } catch (_) { /* 保存できない環境でもメモリ上の会話を初期化する。 */ }
  tutorial.seen = false;
  tutorial.step = 0;
  for (const chat of chats.values()) resetConversation(chat, false);
  active = chats.values().next().value;
  clearTimeout(noticeTimer);
  elements.notice.classList.remove('visible');
  renderConversation(active);
  syncMobileView();
  resetDialog.dialog.close();
  $('#list-title').focus({ preventScroll: true });
}
function restoreConversation(chat) {
  let saved;
  let migrated = false;
  for (const key of [chat.storageKey, ...(LEGACY_STORAGE_KEYS[chat.script.id] || [])]) {
    let candidate;
    try { candidate = JSON.parse(localStorage.getItem(key)); } catch (_) { continue; }
    if (!candidate || !Array.isArray(candidate.transcript) || !Array.isArray(candidate.completed)) continue;
    if (!candidate.transcript.every(record => typeof record.text === 'string' &&
      (!record.image || typeof record.image === 'string') &&
      typeof record.mine === 'boolean' && !Number.isNaN(Date.parse(record.iso)))) continue;
    saved = candidate;
    migrated = key !== chat.storageKey;
    break;
  }
  if (!saved) return false;
  const history = Array.isArray(saved.undoHistory) ? saved.undoHistory : [saved.lastSend];
  chat.undoHistory = history.filter(state => state && Number.isInteger(state.length) &&
    state.length >= 0 && saved.transcript[state.length]?.mine &&
    Array.isArray(state.completed) && Array.isArray(state.visitedTroubles));
  chat.startedAt = Number.isFinite(saved.startedAt) ? saved.startedAt : Date.now();
  chat.transcript = saved.transcript;
  for (const record of chat.transcript) {
    if (record.image === './images/zipファイルイラスト.jpg') {
      record.file = window.UNI_STORY.grandfatherChat.opening.find(message => message.file)?.file;
      if (record.file) {
        delete record.image;
        delete record.alt;
        migrated = true;
      }
    }
  }
  chat.completed = new Set(saved.completed);
  chat.activePromptId = saved.activePromptId || null;
  chat.visitedTroubles = new Set([
    ...(Array.isArray(saved.visitedTroubles) ? saved.visitedTroubles : []),
    ...chat.script.troubleIds.filter(id => chat.completed.has(id))
  ].filter(id => chat.script.troubleIds.includes(id)));
  if ('activeTroubleId' in saved) {
    chat.activeTroubleId = chat.script.troubleIds.includes(saved.activeTroubleId) ? saved.activeTroubleId : null;
  } else {
    chat.activeTroubleId = chat.script.troubleIds.find(id => chat.completed.has(id) &&
      (chat.script.troubleBranches[id].promptIds.includes(chat.activePromptId) ||
        !chat.script.troubleBranches[id].endIds.some(endId => chat.completed.has(endId)))) || null;
    migrated = true;
  }
  chat.replayTroubleId = chat.script.troubleIds.includes(saved.replayTroubleId) && !chat.activeTroubleId
    ? saved.replayTroubleId : null;
  chat.pendingJob = saved.pendingJob || null;
  chat.unreadCount = Number.isInteger(saved.unreadCount) && saved.unreadCount > 0 ? saved.unreadCount : 0;
  if (chat.script.id === 'grandfather') {
    const zipName = 'SaR2_data.zip';
    const cardIndex = chat.transcript.findIndex(record => !record.mine && record.file?.name === zipName);
    const duplicateIndex = cardIndex + 1;
    const duplicate = chat.transcript[duplicateIndex];
    if (cardIndex >= 0 && duplicate && !duplicate.mine && !duplicate.file && !duplicate.image &&
        duplicate.text.trim() === zipName) {
      if (duplicateIndex >= chat.transcript.length - chat.unreadCount) chat.unreadCount--;
      chat.transcript.splice(duplicateIndex, 1);
      for (const state of chat.undoHistory) {
        if (state.length > duplicateIndex) state.length--;
      }
      migrated = true;
    }
  }
  if (typeof saved.hasOpened === 'boolean') {
    chat.hasOpened = saved.hasOpened;
  } else {
    // 旧版では最初から届いたメッセージを未読として数えていなかった。
    // 送信履歴のないトークだけ、未開封の最初のメッセージとして移行する。
    chat.hasOpened = saved.transcript.some(record => record.mine) || saved.completed.length > 0;
    const openingRecords = chat.script.opening.flatMap(message => messageRecords(message, false));
    const untouchedOpening = openingRecords.length > 0 &&
      openingRecords.every((record, index) => saved.transcript[index]?.text === record.text &&
        saved.transcript[index]?.image === record.image && saved.transcript[index]?.mine === false) &&
      saved.transcript.length === openingRecords.length;
    if (!chat.hasOpened && untouchedOpening && chat.unreadCount === 0) {
      chat.unreadCount = openingRecords.length;
    }
  }
  chat.draft = typeof saved.draft === 'string' ? saved.draft : '';
  if (migrated) saveState(chat);
  if (chat.pendingJob) void runPending(chat, chat.generation);
  return true;
}

elements.form.addEventListener('submit', event => {
  event.preventDefault();
  void send(elements.input.value);
});
elements.input.addEventListener('click', () => {
  if (active.activePromptId) return;
  if (elements.choicePanel.hidden) openPicker(); else closePicker();
});
elements.input.addEventListener('keydown', event => {
  if (!active.activePromptId && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault(); openPicker();
  }
});
elements.input.addEventListener('input', () => {
  active.draft = elements.input.value;
  saveState(active);
  renderSuggestions();
});
elements.backdrop.addEventListener('click', closePicker);
elements.pickerBack.addEventListener('click', () => {
  historyView = false;
  renderSuggestions();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closePicker(); });
const chatMenu = $('#chat-menu');
const undoButton = $('#menu-undo');
function openChatMenu() {
  closePicker();
  closeTutorial(false);
  undoButton.disabled = active.undoHistory.length === 0;
  chatMenu.showModal();
}
$('#header-reset').addEventListener('click', openChatMenu);
$('#rail-reset').addEventListener('click', openChatMenu);
$('#menu-reset').addEventListener('click', () => {
  chatMenu.close();
  openResetDialog();
});
undoButton.addEventListener('click', () => {
  chatMenu.close();
  resetDialog.step = 'undo';
  resetDialog.title.textContent = '送信取り消し';
  resetDialog.description.textContent = '直近の送信と、それに続く返信を取り消しますか？';
  resetDialog.confirm.textContent = 'はい';
  resetDialog.cancel.textContent = 'いいえ';
  resetDialog.dialog.showModal();
  resetDialog.cancel.focus();
});
function undoLastSend(chat) {
  const state = chat.undoHistory.pop();
  if (!state) return;
  chat.generation++;
  chat.pendingJob = null;
  chat.transcript.length = state.length;
  chat.completed = new Set(state.completed);
  chat.visitedTroubles = new Set(state.visitedTroubles);
  chat.activePromptId = state.activePromptId;
  chat.activeTroubleId = state.activeTroubleId;
  chat.replayTroubleId = state.replayTroubleId;
  chat.draft = state.draft;
  chat.unreadCount = state.unreadCount;
  saveState(chat);
  renderConversation(chat);
}
resetDialog.cancel.addEventListener('click', closeResetDialog);
resetDialog.confirm.addEventListener('click', event => {
  // 同じ場所の連続クリックで、2段階の確認を一度に通過させない。
  if (event.detail > 1) return;
  if (resetDialog.step === 'undo') {
    closeResetDialog();
    undoLastSend(active);
  } else if (resetDialog.step === 0) {
    resetDialog.step = 1;
    renderResetStep();
  } else {
    resetAllConversations();
  }
});
resetDialog.dialog.addEventListener('cancel', event => {
  event.preventDefault();
  closeResetDialog();
});
tutorial.next.addEventListener('click', () => {
  if (tutorial.step === tutorial.totalSteps - 1) return closeTutorial();
  tutorial.step++;
  renderTutorialStep();
});
tutorial.back.addEventListener('click', () => {
  tutorial.step = Math.max(0, tutorial.step - 1);
  renderTutorialStep();
  tutorial.next.focus({ preventScroll: true });
});
tutorial.dialog.addEventListener('cancel', event => {
  event.preventDefault();
  closeTutorial();
});
// フォントの読み込みなどで説明文の高さが変わっても、強調箇所との間隔を保つ。
const tutorialResizeObserver = new ResizeObserver(() => {
  if (tutorial.dialog.open) scheduleViewportUpdate();
});
tutorialResizeObserver.observe(tutorial.card);
tutorialResizeObserver.observe(elements.form);

let viewportUpdateQueued = false;
function scheduleViewportUpdate() {
  if (viewportUpdateQueued) return;
  viewportUpdateQueued = true;
  requestAnimationFrame(() => {
    viewportUpdateQueued = false;
    if (!matchMedia('(max-width: 700px)').matches) {
      elements.shell.style.removeProperty('--visual-height');
      elements.shell.style.removeProperty('--visual-top');
      elements.shell.classList.remove('keyboard-open');
    } else {
      const viewport = window.visualViewport;
      elements.shell.style.setProperty('--visual-height', `${Math.round(viewport?.height ?? window.innerHeight)}px`);
      elements.shell.style.setProperty('--visual-top', `${Math.round(viewport?.offsetTop ?? 0)}px`);
      const typing = document.activeElement === elements.input && !elements.input.readOnly;
      elements.shell.classList.toggle('keyboard-open', typing);
      if (typing) scrollToLatest();
    }
    syncTutorial();
  });
}
function syncMobileView() {
  const mobile = matchMedia('(max-width: 700px)').matches;
  const id = mobileChatId();
  const open = mobile && !!id && chats.has(id);
  elements.shell.classList.toggle('mobile-chat-open', open);
  const listOnly = location.hash === '#list' || (mobile && !open);
  elements.shell.classList.toggle('list-only', listOnly);
  if (open && active !== chats.get(id)) renderConversation(chats.get(id));
  closePicker();
  if (open && isChatVisible(active)) markRead(active);
  if (listOnly) document.title = 'トーク | chatTalk';
  renderList();
  scheduleViewportUpdate();
}
function openChat(chat) {
  if (matchMedia('(max-width: 700px)').matches) {
    if (mobileChatId() !== chat.script.id) {
      history.pushState({ view: 'chat', id: chat.script.id }, '', `#chat/${encodeURIComponent(chat.script.id)}`);
    }
    elements.shell.classList.add('mobile-chat-open');
  } else if (location.hash === '#list' || (mobileChatId() && mobileChatId() !== chat.script.id)) {
    history.replaceState({ view: 'chat', id: chat.script.id }, '', `#chat/${encodeURIComponent(chat.script.id)}`);
  }
  renderConversation(chat);
  syncMobileView();
}
function backToList() {
  history.replaceState({ view: 'list' }, '', location.pathname + location.search + '#list');
  syncMobileView();
}
// iOS Safari では hover 状態を作るだけで最初の click が遅れることがある。
// 指のタップは touchend で確定し、後続の合成 click を抑止する。
let listTap = null;
elements.list.addEventListener('touchstart', event => {
  if (event.touches.length !== 1) { listTap = null; return; }
  const button = event.target.closest('[data-chat-id]');
  const touch = event.changedTouches[0];
  listTap = button ? { id: button.dataset.chatId, x: touch.clientX, y: touch.clientY } : null;
}, { passive: true });
elements.list.addEventListener('touchmove', event => {
  if (!listTap) return;
  const touch = event.changedTouches[0];
  if (Math.hypot(touch.clientX - listTap.x, touch.clientY - listTap.y) > 12) listTap = null;
}, { passive: true });
elements.list.addEventListener('touchend', event => {
  if (!listTap) return;
  const touch = event.changedTouches[0];
  const button = event.target.closest('[data-chat-id]');
  const tap = listTap;
  listTap = null;
  if (button?.dataset.chatId !== tap.id ||
      Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) > 12) return;
  event.preventDefault();
  openChat(chats.get(tap.id));
}, { passive: false });
elements.list.addEventListener('touchcancel', () => { listTap = null; });
elements.list.addEventListener('click', event => {
  const button = event.target.closest('[data-chat-id]');
  if (button) openChat(chats.get(button.dataset.chatId));
});
$('#back-to-list').addEventListener('click', backToList);
window.addEventListener('popstate', syncMobileView);
window.addEventListener('hashchange', syncMobileView);
document.addEventListener('visibilitychange', () => {
  if (isChatVisible(active)) markRead(active);
  scheduleViewportUpdate();
});
window.addEventListener('focus', () => {
  if (isChatVisible(active)) markRead(active);
  scheduleViewportUpdate();
});
window.addEventListener('resize', () => { syncMobileView(); scheduleViewportUpdate(); });
window.visualViewport?.addEventListener('resize', scheduleViewportUpdate);
window.visualViewport?.addEventListener('scroll', scheduleViewportUpdate);
elements.input.addEventListener('focus', () => { scheduleViewportUpdate(); setTimeout(scheduleViewportUpdate, 280); });
elements.input.addEventListener('blur', () => { scheduleViewportUpdate(); setTimeout(scheduleViewportUpdate, 280); });

let swipeStart = null;
$('#chat-panel').addEventListener('touchstart', event => {
  const touch = event.changedTouches[0];
  swipeStart = touch.clientX >= 28 && elements.choicePanel.hidden &&
    !event.target.closest('.composer') ? { x: touch.clientX, y: touch.clientY } : null;
}, { passive: true });
$('#chat-panel').addEventListener('touchend', event => {
  if (!swipeStart || !matchMedia('(max-width: 700px)').matches) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - swipeStart.x;
  if (dx > 90 && dx > Math.abs(touch.clientY - swipeStart.y) * 1.5) backToList();
  swipeStart = null;
}, { passive: true });

for (const chat of chats.values()) {
  if (!restoreConversation(chat)) resetConversation(chat, true, performance.timeOrigin);
}
setAvatar($('.rail-avatar'), 'あ', SELF_AVATAR);
const direct = chats.get(mobileChatId());
renderConversation(direct || active);
syncMobileView();

// 対応ブラウザでは、画面と同じ操作をエージェントにも公開します。
if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'send_scripted_message', title: 'メッセージを送る',
      description: '指定したトークの解放済みメッセージを送り、返信を待ちます。',
      inputSchema: { type: 'object', properties: {
        contactId: { type: 'string', description: 'CHAT_SCRIPTS 内の相手の id' },
        id: { type: 'string', description: '送信メッセージの id' }
      }, required: ['contactId', 'id'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const chat = chats.get(input?.contactId);
        if (!chat) throw new Error('トーク相手が見つかりません。');
        const item = chat.script.messages.find(candidate => candidate.id === input?.id);
        if (!item) throw new Error('メッセージIDが見つかりません。');
        if (chat.pendingJob || chat.activePromptId || chat.completed.has(item.id) || !isUnlocked(chat, item)) {
          throw new Error('このメッセージは今は送れません。');
        }
        openChat(chat);
        await send(item.text);
        return { contactId: chat.script.id, sent: item.id, awaitingFreeText: !!chat.activePromptId };
      }
    })).catch(() => {});
    Promise.resolve(document.modelContext.registerTool({
      name: 'send_free_text_reply', title: '文字で返信する',
      description: '指定したトークの文字入力を求める質問に返信します。',
      inputSchema: { type: 'object', properties: {
        contactId: { type: 'string', description: 'CHAT_SCRIPTS 内の相手の id' },
        text: { type: 'string', minLength: 1 }
      }, required: ['contactId', 'text'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const chat = chats.get(input?.contactId);
        if (!chat?.activePromptId || chat.pendingJob || typeof input.text !== 'string' || !input.text.trim()) {
          throw new Error('このトークは今、文字入力を受け付けていません。');
        }
        openChat(chat);
        await send(input.text);
        return { contactId: chat.script.id, sent: input.text, awaitingFreeText: !!chat.activePromptId };
      }
    })).catch(() => {});
  } catch (_) { /* 未対応ブラウザでは通常の画面操作を続けます。 */ }
}
