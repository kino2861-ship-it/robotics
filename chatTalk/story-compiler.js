/* UNI の場面形式を、チャット表示が使う形式に変換する。会話文は uni-story.js に置く。 */
(function () {
  function fail(message) { throw new Error(`UNI の会話設定: ${message}`); }
  function unique(ids, label) {
    if (new Set(ids).size !== ids.length) fail(`${label} に重複した ID があります`);
  }
  function normalized(text) {
    return text.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  }
  function validateLines(lines, label) {
    if (!Array.isArray(lines)) fail(`${label} は配列にしてください`);
    for (const line of lines) {
      if (typeof line === 'string' && line.length > 0) continue;
      if (line && typeof line === 'object' &&
          (typeof line.text === 'string' && line.text.length > 0 || typeof line.image === 'string' && line.image.length > 0)) continue;
      fail(`${label} に空のメッセージがあります`);
    }
  }

  function compileUniStory(story) {
    if (!story || !story.setup?.request || !Array.isArray(story.troubles) || !story.troubleMenu) {
      fail('setup・troubles・troubleMenu を確認してください');
    }
    validateLines(story.opening, 'opening');
    const request = story.setup.request;
    const scenes = [request, ...story.troubles];
    const ids = scenes.map(scene => scene.id);
    unique(ids, '場面');
    const byId = new Map(scenes.map(scene => [scene.id, scene]));
    const menu = story.troubleMenu.choices;
    if (!Array.isArray(menu) || menu.length === 0) fail('トラブル選択肢がありません');
    unique(menu, 'トラブル選択肢');
    for (const id of menu) if (!byId.has(id) || id === request.id) fail(`選択肢 ${id} が見つかりません`);
    const promptIds = Object.keys(story.setup.prompts || {});
    if (!promptIds.includes(request.nextPrompt)) fail(`質問 ${request.nextPrompt} が見つかりません`);
    const answerIds = [];
    for (const [promptId, prompt] of Object.entries(story.setup.prompts)) {
      validateLines(prompt.beforeReplies || [], `${promptId} の判定前`);
      validateLines(prompt.invalidReply || [], `${promptId} の誤答`);
      if (!Array.isArray(prompt.answers) || prompt.answers.length === 0) fail(`${promptId} に回答がありません`);
      for (const answer of prompt.answers) {
        answerIds.push(answer.id);
        if (!Array.isArray(answer.matches) || answer.matches.length === 0) fail(`${answer.id} に正解がありません`);
        validateLines(answer.replies, `${answer.id} の返答`);
        if (answer.nextPromptId && !promptIds.includes(answer.nextPromptId)) fail(`質問 ${answer.nextPromptId} が見つかりません`);
      }
      for (const action of prompt.actions || []) {
        if (action.label != null && (typeof action.label !== 'string' || !action.label.trim())) {
          fail(`${promptId} の選択肢の表示文が不正です`);
        }
        if (typeof action.text !== 'string' || !prompt.answers.some(answer =>
          answer.matches.some(match => normalized(match) === normalized(action.text)))) {
          fail(`${promptId} の選択肢に対応する回答がありません`);
        }
        if (action.hideAfter && !prompt.answers.some(answer => answer.id === action.hideAfter)) {
          fail(`${promptId} の選択肢の非表示条件 ${action.hideAfter} が見つかりません`);
        }
      }
    }
    unique(answerIds, '質問の回答');
    if (!answerIds.includes(story.troubleMenu.unlockAfter)) fail('トラブル選択の解放条件が見つかりません');

    const predecessors = new Map();
    for (const scene of scenes) {
      if (typeof scene.id !== 'string' || typeof scene.send !== 'string' || !scene.send.trim()) fail('場面の ID または送信文がありません');
      validateLines(scene.uni, `${scene.id} の返答`);
      if (scene.nextPrompt && !promptIds.includes(scene.nextPrompt)) fail(`質問 ${scene.nextPrompt} が見つかりません`);
      for (const id of scene.hideAfter || []) if (!byId.has(id)) fail(`${scene.id} の非表示条件 ${id} が見つかりません`);
      for (const variant of scene.firstLineVariants || []) {
        if (!scene.uni.length || typeof variant.text !== 'string' || !variant.text) fail(`${scene.id} の条件付き返答が不正です`);
        for (const id of [...(variant.when?.all || []), ...(variant.when?.none || [])]) {
          if (!byId.has(id)) fail(`${scene.id} の返答条件 ${id} が見つかりません`);
        }
      }
      if (scene.waitMs != null && (!Number.isFinite(scene.waitMs) || scene.waitMs < 0 || scene.uni.length === 0)) {
        fail(`${scene.id} の待ち時間が不正です`);
      }
      if (scene === request) continue;
      if (scene.next === 'menu') continue;
      if (!Array.isArray(scene.next) || scene.next.length === 0) fail(`${scene.id} の次の選択肢がありません`);
      unique(scene.next, `${scene.id} の次の選択肢`);
      const labels = scene.next.map(id => {
        const next = byId.get(id);
        if (!next || next === request) fail(`${scene.id} の分岐先 ${id} が見つかりません`);
        if (!predecessors.has(id)) predecessors.set(id, []);
        predecessors.get(id).push(scene.id);
        return normalized(next.send);
      });
      unique(labels, `${scene.id} の選択肢の文面`);
    }
    unique(menu.map(id => normalized(byId.get(id).send)), 'トラブル選択肢の文面');

    const branchEnds = new Map();
    const branchOf = new Map();
    const depth = new Map();
    function follow(id, start, path, ends) {
      if (path.has(id)) fail(`${id} で会話が循環しています`);
      const previousBranch = branchOf.get(id);
      if (previousBranch && previousBranch !== start) fail(`${id} が複数のトラブルから使われています`);
      branchOf.set(id, start);
      if (!depth.has(id) || path.size < depth.get(id)) depth.set(id, path.size);
      const scene = byId.get(id);
      if (scene.next === 'menu') { ends.add(id); return; }
      const nextPath = new Set(path);
      nextPath.add(id);
      for (const nextId of scene.next) follow(nextId, start, nextPath, ends);
    }
    for (const start of menu) {
      const scene = byId.get(start);
      const ends = new Set();
      if (scene.next === 'menu') ends.add(start);
      else follow(start, start, new Set(), ends);
      // 途中で一覧へ戻った場合も、その枝の選択肢を閉じて別の相談を解放する。
      ends.add(`__returned__:${start}`);
      branchEnds.set(start, [...ends]);
    }
    for (const scene of story.troubles) {
      if (!menu.includes(scene.id) && !branchOf.has(scene.id)) fail(`${scene.id} はどの選択肢からも到達できません`);
    }

    const messages = scenes.map(scene => {
      const toReplies = lines => lines.map((line, index) => {
        if (index !== 0 || scene.waitMs == null) return line;
        return typeof line === 'string' ? { text: line, delayMs: scene.waitMs }
          : { ...line, delayMs: scene.waitMs };
      });
      const item = { id: scene.id, text: scene.send, replies: toReplies(scene.uni) };
      if (scene !== request) {
        item.troubleId = branchOf.get(scene.id) || (menu.includes(scene.id) ? scene.id : null);
        if (scene.next === 'menu' && !scene.keepActive) item.finishTrouble = true;
      }
      if (scene.nextPrompt) item.freeText = scene.nextPrompt;
      if (scene.firstLineVariants) item.replyVariants = scene.firstLineVariants.map(variant => ({
        when: variant.when, replies: toReplies([variant.text, ...scene.uni.slice(1)])
      }));
      if (scene.image) item.image = scene.image;
      if (scene.alt) item.alt = scene.alt;
      if (scene.lockedHint) item.lockedHint = scene.lockedHint;
      if (scene === request) {
        return item;
      }
      if (menu.includes(scene.id)) {
        item.requires = {
          all: [story.troubleMenu.unlockAfter],
          notDuring: [...branchEnds].filter(([start]) => start !== scene.id)
            .map(([start, ends]) => ({ start, end: ends.length === 1 ? ends[0] : ends }))
        };
        const ends = branchEnds.get(scene.id);
        if (ends) item.retireAfter = ends.length === 1 ? ends[0] : ends;
      } else {
        const parents = predecessors.get(scene.id);
        if (!parents?.length) fail(`${scene.id} の前の場面が見つかりません`);
        // 同じ完了選択肢に複数の段階から進める場合は、最も早い段階で解放する。
        const firstParent = parents.reduce((best, id) => depth.get(id) < depth.get(best) ? id : best);
        const ends = branchEnds.get(branchOf.get(scene.id)) || [];
        const none = [...new Set([...ends.filter(id => id !== scene.id), ...(scene.hideAfter || [])])];
        item.requires = { all: [firstParent] };
        if (none.length) item.requires.none = none;
      }
      if (scene.aliases) item.aliases = scene.aliases;
      if (scene.labelVariants) item.labelVariants = scene.labelVariants;
      return item;
    });
    // 再相談では該当する枝の進行状態だけ消す。表示済みのトーク履歴は残す。
    const troubleBranches = Object.fromEntries(menu.map(start => {
      const sceneIds = [start, ...[...branchOf].filter(([id, branch]) => branch === start && id !== start)
        .map(([id]) => id)];
      const promptIds = new Set();
      function collectPrompt(id) {
        if (promptIds.has(id)) return;
        promptIds.add(id);
        for (const answer of story.setup.prompts[id].answers) {
          if (answer.nextPromptId) collectPrompt(answer.nextPromptId);
        }
      }
      for (const id of sceneIds) if (byId.get(id).nextPrompt) collectPrompt(byId.get(id).nextPrompt);
      return [start, {
        sceneIds,
        endIds: branchEnds.get(start),
        returnId: `__returned__:${start}`,
        promptIds: [...promptIds],
        answerIds: [...promptIds].flatMap(id => story.setup.prompts[id].answers.map(answer => answer.id))
      }];
    }));
    const compiled = {
      id: story.id, contact: story.contact, opening: story.opening,
      readDelayMs: story.readDelayMs, messages,
      prompts: story.setup.prompts, fallback: story.fallback,
      troubleIds: menu, troubleUnlockAfter: story.troubleMenu.unlockAfter, troubleBranches
    };
    if (story.avatar) compiled.avatar = story.avatar;
    if (story.startReplyDelayMs != null) compiled.startReplyDelayMs = story.startReplyDelayMs;
    return compiled;
  }

  window.compileUniStory = compileUniStory;
})();
