function createImageButton(image, downloadName) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'image-trigger';
  const description = image.getAttribute('aria-label') || image.alt || '画像';
  trigger.setAttribute('aria-label', description + 'を拡大');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.append(image);

  trigger.addEventListener('click', () => {
    const dialog = document.createElement('dialog');
    dialog.className = 'image-viewer';
    dialog.setAttribute('aria-label', description);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'image-viewer-close';
    close.setAttribute('aria-label', '拡大画像を閉じる');
    close.addEventListener('click', () => dialog.close());

    const enlarged = image.cloneNode(false);
    enlarged.removeAttribute('class');
    if (image instanceof HTMLCanvasElement) {
      enlarged.getContext('2d').drawImage(image, 0, 0);
    } else {
      enlarged.loading = 'eager';
    }
    close.append(enlarged);
    dialog.append(close);
    if (downloadName) {
      const save = document.createElement('a');
      save.className = 'image-viewer-save';
      save.href = image.src;
      save.download = downloadName;
      save.textContent = 'クリアカードを保存';
      dialog.append(save);
    }
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
  return trigger;
}
