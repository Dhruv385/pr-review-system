(() => {
  const STORAGE_TOKEN = 'prReview.accessToken';
  const STORAGE_USER = 'prReview.user';

  const els = {
    authView: document.getElementById('auth-view'),
    appView: document.getElementById('app-view'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    authError: document.getElementById('auth-error'),
    tabs: document.querySelectorAll('.tab'),
    userEmail: document.getElementById('user-email'),
    logoutBtn: document.getElementById('logout-btn'),
    connectGithub: document.getElementById('connect-github'),
    connectGitlab: document.getElementById('connect-gitlab'),
    refreshBtn: document.getElementById('refresh-btn'),
    chips: document.querySelectorAll('.chip'),
    prGrid: document.getElementById('pr-grid'),
    prEmpty: document.getElementById('pr-empty'),
    prLoading: document.getElementById('pr-loading'),
    toast: document.getElementById('toast'),
    overlay: document.getElementById('detail-overlay'),
    detailPanel: document.getElementById('detail-panel'),
    detailContent: document.getElementById('detail-content'),
    detailClose: document.getElementById('detail-close'),
  };

  let activePlatformFilter = '';

  // ---------------- Session ----------------

  function getToken() {
    return localStorage.getItem(STORAGE_TOKEN);
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_USER) || 'null');
    } catch {
      return null;
    }
  }

  function setSession(accessToken, user) {
    localStorage.setItem(STORAGE_TOKEN, accessToken);
    localStorage.setItem(STORAGE_USER, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
  }

  // ---------------- API helper ----------------

  async function api(path, options = {}) {
    const token = getToken();
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });

    if (res.status === 401) {
      clearSession();
      showAuthView();
      throw new Error('Session expired — please log in again.');
    }

    let data = null;
    try {
      data = await res.json();
    } catch {
      // no body
    }

    if (!res.ok) {
      throw new Error((data && data.message) || `Request failed (${res.status})`);
    }

    return data;
  }

  // ---------------- View switching ----------------

  function showAuthView() {
    els.authView.classList.remove('hidden');
    els.appView.classList.add('hidden');
  }

  function showAppView() {
    const user = getUser();
    els.authView.classList.add('hidden');
    els.appView.classList.remove('hidden');
    els.userEmail.textContent = user ? user.email : '';
    loadPullRequests();
  }

  // ---------------- Auth ----------------

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      els.tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      els.loginForm.classList.toggle('hidden', !isLogin);
      els.registerForm.classList.toggle('hidden', isLogin);
      hideAuthError();
    });
  });

  function showAuthError(message) {
    els.authError.textContent = message;
    els.authError.classList.remove('hidden');
  }

  function hideAuthError() {
    els.authError.classList.add('hidden');
  }

  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    const form = new FormData(els.loginForm);
    try {
      const result = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
        }),
      });
      setSession(result.accessToken, result.user);
      showAppView();
    } catch (err) {
      showAuthError(err.message);
    }
  });

  els.registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    const form = new FormData(els.registerForm);
    try {
      const result = await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
          platform: form.get('platform'),
          username: form.get('username'),
        }),
      });
      setSession(result.accessToken, result.user);
      showAppView();
    } catch (err) {
      showAuthError(err.message);
    }
  });

  els.logoutBtn.addEventListener('click', () => {
    clearSession();
    showAuthView();
  });

  // ---------------- Connect GitHub / GitLab ----------------
  // Fetch the authorization URL as JSON (same-origin, no CORS issue), then
  // hand off to a real browser navigation — never fetch() the provider URL
  // itself, since GitHub/GitLab don't send CORS headers back for that.

  async function connectProvider(provider) {
    try {
      const data = await api(`/accounts/${provider}/connect`);
      window.location.href = data.authorizationUrl;
    } catch (err) {
      showToast(err.message, true);
    }
  }

  els.connectGithub.addEventListener('click', () => connectProvider('github'));
  els.connectGitlab.addEventListener('click', () => connectProvider('gitlab'));

  // ---------------- Toast ----------------

  let toastTimer = null;

  function showToast(message, isError = false) {
    els.toast.innerHTML = `<div class="toast-inner" style="${isError ? 'background:var(--danger-soft);color:var(--danger);border-color:#fecaca' : ''}">${escapeHtml(message)}</div>`;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 5000);
  }

  // ---------------- Pull request list ----------------

  els.chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      els.chips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      activePlatformFilter = chip.dataset.platform;
      loadPullRequests();
    });
  });

  els.refreshBtn.addEventListener('click', loadPullRequests);

  async function loadPullRequests() {
    els.prLoading.classList.remove('hidden');
    els.prEmpty.classList.add('hidden');
    els.prGrid.innerHTML = '';

    try {
      const query = activePlatformFilter ? `?platform=${activePlatformFilter}` : '';
      const { pullRequests } = await api(`/pull-requests${query}`);
      els.prLoading.classList.add('hidden');

      if (!pullRequests.length) {
        els.prEmpty.classList.remove('hidden');
        return;
      }

      els.prGrid.innerHTML = pullRequests.map(renderPrCard).join('');
      els.prGrid.querySelectorAll('.pr-card').forEach((card) => {
        card.addEventListener('click', () => openPullRequest(card.dataset.id));
      });
    } catch (err) {
      els.prLoading.classList.add('hidden');
      showToast(err.message, true);
    }
  }

  function renderPrCard(pr) {
    const statusClass = { OPEN: 'badge-open', MERGED: 'badge-merged', CLOSED: 'badge-closed' }[pr.status] || 'badge-open';
    const platformLabel = pr.platform === 'GITHUB' ? 'GitHub' : 'GitLab';
    return `
      <div class="pr-card" data-id="${pr.id}">
        <div class="pr-card-top">
          <span class="platform-tag"><span class="dot ${pr.platform === 'GITHUB' ? 'dot-github' : 'dot-gitlab'}"></span>${platformLabel}</span>
          <span class="badge ${statusClass}">${pr.status}</span>
        </div>
        <p class="pr-title">${escapeHtml(pr.title)}</p>
        <p class="pr-repo">${escapeHtml(pr.repository)} #${pr.number}</p>
        <div class="pr-card-bottom">
          <span>${pr.reviewCount} review${pr.reviewCount === 1 ? '' : 's'}</span>
          <span>View details →</span>
        </div>
      </div>`;
  }

  // ---------------- Detail panel ----------------

  els.detailClose.addEventListener('click', closeDetail);
  els.overlay.addEventListener('click', (e) => {
    if (e.target === els.overlay) closeDetail();
  });

  function closeDetail() {
    els.overlay.classList.add('hidden');
  }

  async function openPullRequest(id) {
    els.overlay.classList.remove('hidden');
    els.detailContent.innerHTML = '<p class="muted">Loading…</p>';

    try {
      const [pr, reviewsRes] = await Promise.all([
        api(`/pull-requests/${id}`),
        api(`/pull-requests/${id}/reviews`),
      ]);
      renderDetail(pr, reviewsRes.reviews || []);
    } catch (err) {
      els.detailContent.innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
    }
  }

  function renderDetail(pr, reviews) {
    const statusClass = { OPEN: 'badge-open', MERGED: 'badge-merged', CLOSED: 'badge-closed' }[pr.status] || 'badge-open';
    const isMerged = pr.status === 'MERGED';

    // Past review history stays visible regardless of PR status — only the
    // "run a new AI review" action is unavailable once a PR is merged.
    const aiReviewSection = isMerged
      ? `<div class="detail-section">
           <h3>AI Review</h3>
           <p class="muted">This pull request is already merged — AI review is only available for open pull requests.</p>
         </div>`
      : `<div class="detail-section">
           <h3>AI Review</h3>
           <button id="ai-review-btn" class="btn btn-primary btn-sm" type="button">Run AI review</button>
           <div id="ai-review-result" style="margin-top:12px;"></div>
         </div>`;

    els.detailContent.innerHTML = `
      <span class="badge ${statusClass}">${pr.status}</span>
      <h2>${escapeHtml(pr.title)}</h2>
      <p class="detail-repo">${escapeHtml(pr.repository)} · #${pr.number} · ${pr.platform}</p>

      <div class="detail-section">
        <h3>Reviews (${reviews.length})</h3>
        <div id="review-list">
          ${reviews.length ? reviews.map(renderReview).join('') : '<p class="muted">No reviews yet.</p>'}
        </div>
      </div>

      ${aiReviewSection}
    `;

    if (!isMerged) {
      document.getElementById('ai-review-btn').addEventListener('click', () => runAiReview(pr.id));
    }
  }

  function renderReview(review) {
    const stateColor = { APPROVED: 'var(--success)', CHANGES_REQUESTED: 'var(--danger)', COMMENTED: 'var(--text-muted)' }[review.state] || 'var(--text-muted)';
    return `
      <div class="review-item">
        <div class="review-item-top">
          <span class="review-author">${escapeHtml(review.reviewer)}</span>
          <span class="badge" style="background:transparent;border:1px solid var(--border);color:${stateColor}">${review.state.replace('_', ' ')}</span>
        </div>
        ${review.comment ? `<p class="review-comment">${escapeHtml(review.comment)}</p>` : ''}
      </div>`;
  }

  async function runAiReview(prId) {
    const btn = document.getElementById('ai-review-btn');
    const resultEl = document.getElementById('ai-review-result');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Reviewing…';
    resultEl.innerHTML = '';

    try {
      const result = await api(`/pull-requests/${prId}/ai-review`, { method: 'POST' });
      const html = typeof marked !== 'undefined' ? marked.parse(result.body) : escapeHtml(result.body);
      resultEl.innerHTML = `
        <div class="ai-review-box markdown">${html}</div>
        <p class="muted" style="margin-top:8px;font-size:12px;">
          Posted to GitHub: <a href="${result.githubReviewUrl}" target="_blank" rel="noopener">${result.githubReviewUrl}</a>
        </p>`;
      showToast('AI review posted to GitHub');
    } catch (err) {
      resultEl.innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Run AI review';
    }
  }

  // ---------------- Utils ----------------

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
  }

  // ---------------- Boot ----------------

  function handleOAuthReturn() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('connected')) {
      const provider = params.get('connected') === 'github' ? 'GitHub' : 'GitLab';
      const username = params.get('username') || '';
      showToast(`${provider} connected${username ? ` as ${username}` : ''}`);
      window.history.replaceState({}, '', '/');
    }
  }

  if (getToken()) {
    showAppView();
  } else {
    showAuthView();
  }
  handleOAuthReturn();
})();
