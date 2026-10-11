(() => {
  const initial = JSON.parse(document.querySelector('#catalog-data').textContent);
  const labels = {ptg: 'PTG 발언문', spec: '설계 제안', notes: '기술 노트'};
  const list = document.querySelector('#docs');
  const filter = document.querySelector('#filter');
  const sort = document.querySelector('#sort');
  const buttons = [...document.querySelectorAll('[data-category]')];
  const status = document.querySelector('#status');
  const cacheKey = 'hong-p-docs-catalog-v1';
  let documents = initial;
  let category = 'all';
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(cacheKey) || '{}') || {}; } catch (_) { /* Storage is optional. */ }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function categoryFor(path) {
    return path.endsWith('-ptg.html') || path === 'ptg-speaking-notes.html' ? 'ptg' : path.startsWith('specs/') ? 'spec' : 'notes';
  }
  function dateLabel(value) {
    return new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(value)).replaceAll('-', '. ');
  }
  function byUpdated(a, b) {
    return (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0) || a.title.localeCompare(b.title, 'ko');
  }
  function renderRecent() {
    const fragment = document.createDocumentFragment();
    for (const entry of [...documents].sort(byUpdated).slice(0, 5)) {
      const item = node('li');
      const link = node('a', 'featured');
      link.href = './' + entry.path.split('/').map(encodeURIComponent).join('/');
      link.append(node('span', 'featured-label', labels[entry.category]), node('h3', '', entry.title), node('p', '', entry.description));
      const meta = node('div', 'featured-meta');
      const date = node(entry.updated ? 'time' : 'span', '', entry.updated ? dateLabel(entry.updated) : '수정일 미확인');
      if (entry.updated) date.dateTime = entry.updated;
      const arrow = node('span', '', '↗');
      arrow.setAttribute('aria-hidden', 'true');
      meta.append(date, arrow); link.append(meta); item.append(link); fragment.append(item);
    }
    document.querySelector('#recent-docs').replaceChildren(fragment);
  }
  function render() {
    renderRecent();
    const query = filter.value.trim().toLocaleLowerCase();
    const visible = documents.filter(entry => (category === 'all' || entry.category === category) &&
      `${entry.title} ${entry.description} ${entry.path} ${labels[entry.category]}`.toLocaleLowerCase().includes(query));
    visible.sort((a, b) => {
      const titleOrder = a.title.localeCompare(b.title, 'ko');
      return sort.value === 'title' ? titleOrder : byUpdated(a, b);
    });
    const fragment = document.createDocumentFragment();
    for (const entry of visible) {
      const item = node('li');
      const link = node('a', 'document');
      link.href = './' + entry.path.split('/').map(encodeURIComponent).join('/');
      const body = node('div', 'document-body');
      body.append(node('span', `tag ${entry.category}`, labels[entry.category]), node('h3', '', entry.title), node('p', '', entry.description));
      const meta = node('div', 'document-meta');
      const date = node(entry.updated ? 'time' : 'span', entry.updated ? '' : 'unknown-date', entry.updated ? dateLabel(entry.updated) : '수정일 미확인');
      if (entry.updated) { date.dateTime = entry.updated; date.title = '마지막 수정 · ' + new Date(entry.updated).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'}) + ' (KST)'; }
      const arrow = node('span', 'arrow', '↗');
      arrow.setAttribute('aria-hidden', 'true');
      meta.append(date, arrow);
      link.append(body, meta); item.append(link); fragment.append(item);
    }
    if (!visible.length) {
      const empty = node('li', 'empty', '조건에 맞는 문서가 없습니다. 다른 검색어나 문서 종류를 선택해 보세요.');
      const reset = node('button', '', '전체 문서 보기');
      reset.type = 'button';
      reset.addEventListener('click', () => { filter.value = ''; setCategory('all'); filter.focus(); });
      empty.append(reset); fragment.append(empty);
    }
    list.replaceChildren(fragment);
    document.querySelector('#count').textContent = visible.length;
    document.querySelector('#total').textContent = documents.length;
  }
  function setCategory(value) {
    category = value;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === value)));
    render();
  }
  buttons.forEach(button => button.addEventListener('click', () => setCategory(button.dataset.category)));
  filter.addEventListener('input', render);
  sort.addEventListener('change', render);
  document.querySelector('#controls').hidden = false;
  render();

  async function json(url) {
    const response = await fetch(url, {headers: {Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  async function refresh() {
    const api = 'https://api.github.com/repos/hong-p/docs';
    try {
      const tree = await json(`${api}/git/trees/main?recursive=1`);
      if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Incomplete document list');
      const pending = [];
      documents = tree.tree.filter(item => item.type === 'blob' && item.path.endsWith('.html') && item.path !== 'index.html' && !item.path.startsWith('_static/'))
        .map(item => {
          const known = initial.find(entry => entry.path === item.path);
          const saved = cache[item.path];
          const current = saved?.sha === item.sha && saved.updated ? saved : known?.sha === item.sha ? known : null;
          const entry = {...(known || {path: item.path, title: item.path.split('/').pop().replace(/\.html$/, '').replace(/[-_]/g, ' '), description: '', category: categoryFor(item.path)}), sha: item.sha, updated: current?.updated || null};
          if (current?.title) entry.title = current.title;
          if (!current) pending.push(entry);
          return entry;
        });
      render();
      // Unchanged documents use embedded or cached dates; only changed files need a request.
      let failed = false;
      async function worker() {
        while (pending.length && !failed) {
          const entry = pending.shift();
          try {
            const commits = await json(`${api}/commits?sha=main&path=${encodeURIComponent(entry.path)}&per_page=1`);
            const updated = commits[0]?.commit?.committer?.date;
            if (!updated || !Number.isFinite(Date.parse(updated))) throw new Error('Missing commit date');
            entry.updated = updated;
            cache[entry.path] = entry;
          } catch (_) { failed = true; }
        }
      }
      await Promise.all([worker(), worker(), worker()]);
      try { localStorage.setItem(cacheKey, JSON.stringify(cache)); } catch (_) { /* Browsing works without persistence. */ }
      status.textContent = failed ? '일부 수정일을 불러오지 못했습니다. 날짜가 없는 문서는 목록 아래에 표시됩니다.' : '수정일은 문서의 마지막 커밋 기준입니다. · 한국 시간';
      render();
    } catch (_) {
      status.textContent = '저장된 문서 목록을 표시하고 있습니다. 수정일은 마지막 커밋 기준입니다.';
    }
  }
  refresh();
})();
