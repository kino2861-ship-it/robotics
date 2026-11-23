/* 編集用プレビュー。会話状態を保存せず、uni-story.js の内容をそのまま表示する。 */
(function () {
  const story = window.UNI_STORY;
  const scenes = [story.setup.request, ...story.troubles];
  const byId = new Map(scenes.map(scene => [scene.id, scene]));
  const select = document.querySelector('#scene-select');
  const content = document.querySelector('#scene-content');
  const choices = document.querySelector('#next-choices');
  const copyButton = document.querySelector('#copy-chat-text');
  const copyStatus = document.querySelector('#copy-status');

  function lineText(line) {
    const part = typeof line === 'string' ? { text: line } : line;
    if (part.file) return `${part.file.name}（${part.file.size}）`;
    return part.image ? `${part.alt || '画像'}（${part.image}）`
      : part.text.replaceAll('{input}', '（入力された言葉）');
  }

  function scenarioText() {
    const lines = [];
    const addHeading = text => lines.push(`【${text}】`);
    const addLine = (speaker, line) => lines.push(`${speaker}: ${lineText(line)}`);
    const addReplies = replies => replies.forEach(line => addLine('UNI', line));

    addHeading('最初のメッセージ');
    addReplies(story.opening);
    addHeading(story.setup.request.id);
    addLine('自分', story.setup.request.send);
    if (story.setup.request.image) addLine('自分', {
      image: story.setup.request.image,
      alt: story.setup.request.alt
    });
    addReplies(story.setup.request.uni);

    for (const [id, prompt] of Object.entries(story.setup.prompts)) {
      addHeading(`文字入力：${id}`);
      addReplies(prompt.beforeReplies || []);
      for (const answer of prompt.answers) {
        addHeading(`回答：${answer.id}`);
        addLine('自分', answer.matches[0]);
        addReplies(answer.replies);
      }
      addHeading(`誤答：${id}`);
      addReplies(prompt.invalidReply || []);
    }

    for (const scene of story.troubles) {
      addHeading(scene.id);
      addLine('自分', scene.send);
      if (scene.image) addLine('自分', { image: scene.image, alt: scene.alt });
      addReplies(scene.uni);
      for (const variant of scene.firstLineVariants || []) {
        addHeading(`${scene.id}：${variant.label}`);
        addReplies([variant.text, ...scene.uni.slice(1)]);
      }
    }
    return lines.join('\n');
  }

  async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard copy was not available');
  }

  async function copyChatText() {
    const text = scenarioText();
    if (!text) {
      copyStatus.textContent = 'コピーするチャット内容がありません。';
      return;
    }
    try {
      await writeClipboard(text);
      copyStatus.textContent = 'シナリオ全体をコピーしました。';
    } catch (error) {
      copyStatus.textContent = 'コピーに失敗しました。ブラウザーの権限を確認してください。';
    }
  }

  function bubble(line, mine = false) {
    const part = typeof line === 'string' ? { text: line } : line;
    if (part.delayMs != null) {
      const timing = document.createElement('p');
      timing.className = 'timing';
      timing.textContent = `この返信まで約${part.delayMs / 1000}秒。`;
      content.append(timing);
    }
    const element = document.createElement('div');
    element.className = `bubble${mine ? ' mine' : ''}${part.image ? ' image' : ''}`;
    if (part.file) {
      element.append(createFileCard(part.file));
    } else if (part.image) {
      const img = document.createElement('img');
      img.alt = part.alt || '画像';
      img.loading = 'lazy';
      const fallback = document.createElement('div');
      fallback.className = 'image-fallback';
      fallback.setAttribute('role', 'img');
      fallback.setAttribute('aria-label', img.alt);
      fallback.textContent = part.placeholder || `画像を表示できません：${img.alt}`;
      fallback.hidden = true;
      img.addEventListener('error', () => {
        img.hidden = true;
        fallback.hidden = false;
      }, { once: true });
      element.append(img, fallback);
      img.src = part.image;
    } else {
      element.textContent = part.text.replaceAll('{input}', '（入力された言葉）');
    }
    content.append(element);
  }
  function heading(text) {
    const element = document.createElement('div');
    element.className = 'scene-heading';
    element.textContent = text;
    content.append(element);
  }
  function option(text, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', action);
    choices.append(button);
  }
  function menu() {
    for (const id of story.troubleMenu.choices) option(byId.get(id).send, () => showScene(id));
  }
  function showScene(id, variantIndex = -1) {
    const scene = byId.get(id);
    select.value = id;
    content.replaceChildren();
    choices.replaceChildren();
    heading(`${scene.id} · ${scene.send}`);
    bubble(scene.send, true);
    if (scene.image) bubble({ image: scene.image, alt: scene.alt }, true);
    if (scene.firstLineVariants?.length) {
      const switcher = document.createElement('div');
      switcher.className = 'variant-switch';
      for (const [index, label] of ['通常の返答', ...scene.firstLineVariants.map(variant => variant.label)].entries()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.setAttribute('aria-pressed', String(index - 1 === variantIndex));
        button.addEventListener('click', () => showScene(id, index - 1));
        switcher.append(button);
      }
      content.append(switcher);
    }
    if (scene.waitMs) {
      const timing = document.createElement('p');
      timing.className = 'timing';
      timing.textContent = `最初の返答まで約${scene.waitMs / 1000}秒。その後は通常約2秒間隔。`;
      content.append(timing);
    }
    const lines = variantIndex < 0 ? scene.uni
      : [scene.firstLineVariants[variantIndex].text, ...scene.uni.slice(1)];
    for (const line of lines) bubble(line);
    if (scene.nextPrompt) option(`質問へ：${scene.nextPrompt}`, () => showPrompt(scene.nextPrompt));
    else if (scene.next === 'menu') menu();
    else for (const nextId of scene.next) option(byId.get(nextId).send, () => {
      const next = byId.get(nextId);
      const index = next.firstLineVariants?.findIndex(variant =>
        (variant.when?.all || []).includes(scene.id)) ?? -1;
      showScene(nextId, index);
    });
    if (!choices.children.length) heading('次の選択肢はありません');
  }
  function showPrompt(id) {
    const prompt = story.setup.prompts[id];
    select.value = `prompt:${id}`;
    content.replaceChildren();
    choices.replaceChildren();
    heading(`文字入力 · ${id}`);
    for (const line of prompt.beforeReplies || []) bubble(line);
    for (const answer of prompt.answers) option(`入力：${answer.matches[0]}`, () => {
      content.replaceChildren();
      choices.replaceChildren();
      heading(`文字入力 · ${id}`);
      bubble(answer.matches[0], true);
      for (const line of answer.replies) bubble(line);
      if (answer.nextPromptId) option(`次の質問へ：${answer.nextPromptId}`, () => showPrompt(answer.nextPromptId));
      else if (answer.id === story.troubleMenu.unlockAfter) menu();
    });
    option('誤答の場合', () => {
      content.replaceChildren();
      choices.replaceChildren();
      heading(`文字入力 · ${id}：誤答`);
      for (const line of prompt.invalidReply || []) bubble(line);
      option('再入力する', () => showPrompt(id));
    });
  }
  function showOpening() {
    select.value = 'opening';
    content.replaceChildren();
    choices.replaceChildren();
    heading('最初のメッセージ');
    for (const line of story.opening) bubble(line);
    option(story.setup.request.send, () => showScene(story.setup.request.id));
  }

  try {
    copyButton.addEventListener('click', copyChatText);
    window.compileUniStory(story);
    select.add(new Option('最初のメッセージ', 'opening'));
    select.add(new Option(story.grandfatherChat.contact, 'grandfather'));
    for (const scene of scenes) select.add(new Option(`${scene.send}（${scene.id}）`, scene.id));
    for (const id of Object.keys(story.setup.prompts)) select.add(new Option(`文字入力：${id}`, `prompt:${id}`));
    select.addEventListener('change', () => {
      if (select.value === 'opening') showOpening();
      else if (select.value === 'grandfather') {
        content.replaceChildren();
        choices.replaceChildren();
        heading(story.grandfatherChat.contact);
        for (const line of story.grandfatherChat.opening) bubble(line);
      }
      else if (select.value.startsWith('prompt:')) showPrompt(select.value.slice(7));
      else showScene(select.value);
    });
    showOpening();
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'error';
    message.textContent = error.message;
    content.replaceChildren(message);
  }
})();
