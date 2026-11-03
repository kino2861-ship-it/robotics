/* 編集用プレビュー。会話状態を保存せず、uni-story.js の内容をそのまま表示する。 */
(function () {
  const story = window.UNI_STORY;
  const scenes = [story.setup.request, ...story.troubles];
  const byId = new Map(scenes.map(scene => [scene.id, scene]));
  const select = document.querySelector('#scene-select');
  const content = document.querySelector('#scene-content');
  const choices = document.querySelector('#next-choices');

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
    element.textContent = part.image ? `${part.alt || '画像'}（${part.image}）`
      : part.text.replaceAll('{input}', '（入力された言葉）');
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
    window.compileUniStory(story);
    select.add(new Option('最初のメッセージ', 'opening'));
    for (const scene of scenes) select.add(new Option(`${scene.send}（${scene.id}）`, scene.id));
    for (const id of Object.keys(story.setup.prompts)) select.add(new Option(`文字入力：${id}`, `prompt:${id}`));
    select.addEventListener('change', () => {
      if (select.value === 'opening') showOpening();
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
