function createClearCard(source, startedAt, finishedAt, onLoad) {
  const date = new Date(startedAt);
  const pad = value => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
  const seconds = Math.max(0, Math.floor((finishedAt - startedAt) / 1000));
  const duration = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(pad).join(':');
  const caption = `${day} 修理時間　${duration}`;
  const alt = `修理完了のクリアカード　${caption}`;
  const container = document.createElement('span');
  container.textContent = 'クリアカードを作成中…';

  const background = new Image();
  const glyphs = new Image();
  background.src = source;
  glyphs.src = './images/clear-card-glyphs.png';
  Promise.all([background.decode(), glyphs.decode()]).then(() => {
    const canvas = document.createElement('canvas');
    canvas.width = background.naturalWidth;
    canvas.height = background.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(background, 0, 0);

    // 1280×720 の原画は下端の82pxが黒帯。16pxの字形を整数倍で描く。
    const scale = 3;
    const margin = 32;
    const y = canvas.height - 41 - 16 * scale / 2;
    const digits = '0123456789/:';
    const kanji = '修理時間';
    ctx.imageSmoothingEnabled = false;
    function drawText(text, x) {
      for (const char of text) {
        const wide = kanji.includes(char) || char === '　';
        const width = wide ? 16 : 8;
        if (char !== '　') {
          const left = wide ? digits.length * 8 + kanji.indexOf(char) * 16 : digits.indexOf(char) * 8;
          ctx.drawImage(glyphs, left, 0, width, 16, x, y, width * scale, 16 * scale);
        }
        x += width * scale;
      }
    }
    drawText(day, margin);
    const timeWidth = ((kanji.length + 1) * 16 + duration.length * 8) * scale;
    drawText(`${kanji}　${duration}`, canvas.width - margin - timeWidth);

    // ローカルファイルを直接開き、ブラウザーがJPEG書き出しを制限する場合も絵を表示する。
    let jpeg;
    try {
      jpeg = canvas.toDataURL('image/jpeg', 0.95);
    } catch (error) {
      if (error.name !== 'SecurityError') throw error;
      canvas.className = 'message-image';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', alt);
      container.replaceChildren(canvas);
      onLoad();
      return;
    }
    const link = document.createElement('a');
    link.href = jpeg;
    link.download = 'clearCard2.jpg';
    link.setAttribute('aria-label', 'クリアカードを保存　' + caption);
    const img = new Image();
    img.className = 'message-image';
    img.alt = alt;
    img.addEventListener('load', onLoad, { once: true });
    img.src = jpeg;
    link.append(img);
    container.replaceChildren(link);
  }).catch(() => {
    container.textContent = 'クリアカードを作成できませんでした。' + caption;
    onLoad();
  });
  return container;
}
