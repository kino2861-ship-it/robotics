function createFileCard(file, sentAt = new Date()) {
  const expiry = new Date(sentAt);
  expiry.setDate(expiry.getDate() + 7);
  const time = expiry.getHours() + ':' + String(expiry.getMinutes()).padStart(2, '0');
  const card = document.createElement('div');
  card.className = 'file-card';
  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.setAttribute('aria-hidden', 'true');
  const details = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = file.name;
  const deadline = document.createElement('div');
  deadline.textContent = `有効期限：${expiry.getMonth() + 1}/${expiry.getDate()} ${time}`;
  const size = document.createElement('div');
  size.textContent = `サイズ：${file.size}`;
  details.append(name, deadline, size);
  card.append(icon, details);
  return card;
}
