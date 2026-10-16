// A single sidebar used by all app pages.
(function () {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const scriptUrl = document.currentScript.src;
  const root = new URL('../', scriptUrl);
  const pages = [
    ['Home', 'home'],
    ['Chat', 'chat'],
    ['Library', 'library'],
    ['Tags', 'tags']
  ];
  const current = document.body.dataset.page;
  const pageUrl = name => new URL(`pages/${name}.html`, root).href;

  sidebar.className = 'sidebar';
  sidebar.innerHTML = `
    <a class="brand" href="${pageUrl('home')}" aria-label="Traxy home">
      <span class="brand-copy"><span class="brand-name">Traxy</span><span class="brand-version">Version 1.0</span></span>
    </a>
    <nav class="nav" aria-label="Main navigation">
      ${pages.map(([label, name]) => `
        <a href="${pageUrl(name)}" ${current === name ? 'class="active" aria-current="page"' : ''}>${label}</a>
      `).join('')}
    </nav>
    <a class="sidebar-account" href="${pageUrl('profile')}" aria-label="Account settings" title="Account settings" ${current === 'profile' ? 'aria-current="page"' : ''}>
      <span class="sidebar-username" id="sidebar-username">Account settings</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-.6 2.2-2 .9-2.1-.6-2 3.5 1.5 1.7v2.6L2.3 15l2 3.5 2.1-.6 2 .9L9 21h4l.6-2.2 2-.9 2.1.6 2-3.5-1.5-1.7v-2.6L19.7 9l-2-3.5-2.1.6-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/></svg>
    </a>
  `;

  import('./supabase.js').then(({ supabase }) => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
      const name = data?.display_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Account settings';
      const username = sidebar.querySelector('#sidebar-username');
      if (username) username.textContent = name;
    }).catch(() => {});
  });

  if (document.startViewTransition) {
    document.documentElement.classList.add('view-transitions-ready');
  }
})();
