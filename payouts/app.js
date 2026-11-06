/* Bird's Nest Auctions — Payout Portal */
(function () {
  'use strict';
  const M = window.PayoutMath;
  const qs = new URLSearchParams(location.search);
  const API = qs.get('api') || 'https://bna-proxy.onrender.com/payouts/api';
  const REVIEW_LINK = 'https://search.google.com/local/writereview?placeid=ChIJv0xlwrWt44kRfNifnhs712o';
  const WEBSITE = 'www.birdsnestauctions.com';
  const CONTACT = 'hello@birdsnestauctions.com';
  const DAY = 86400000;
  const app = document.getElementById('app');

  // ---------- small helpers ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = M.money;
  const truthy = M.truthy;
  const nowIso = () => new Date().toISOString();
  const fmtDate = d => { const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  const fmtShort = d => { const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} },
  };
  let session = store.get('bna_payout_session');
  let me = JSON.parse(store.get('bna_payout_user') || 'null');

  function toast(msg, err) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : ''); t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), err ? 7000 : 2500);
  }
  async function api(path, body) {
    const r = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => { throw new Error('Can’t reach the portal server. It may be waking up; try again in a minute.'); });
    const json = await r.json().catch(() => ({}));
    if (r.status === 401) { signOut(json.error || 'Please sign in again.'); throw new Error(json.error || 'Signed out'); }
    if (!r.ok) throw new Error(json.error || `Request failed (${r.status})`);
    return json;
  }
  const save = (tab, rows) => api('/save', { tab, rows });
  function signOut(msg) { session = null; me = null; store.set('bna_payout_session', null); store.set('bna_payout_user', null); renderLogin(msg); }
  function loading(text) { app.innerHTML = nav() + `<div class="wrap"><p class="sub">${esc(text || 'Loading…')}</p></div>`; }
  function fail(e) { app.innerHTML = nav() + `<div class="wrap"><div class="badbox">${esc(e.message)}</div></div>`; }

  function nav() {
    const h = location.hash;
    const on = k => (k === 'pending' ? (!h || h === '#' || h.startsWith('#sale') || h.startsWith('#statement')) : h.startsWith('#' + k)) ? ' class="on"' : '';
    return `<nav class="top noprint"><div class="in"><a href="#"><img src="logo.webp" alt="Bird’s Nest Auctions"></a>
      <div class="links"><a href="#"${on('pending')}>Sales</a><a href="#refunds"${on('refunds')}>Refunds</a><a href="#paid"${on('paid')}>Paid</a></div>
      <div class="who">${esc(me ? me.name : '')} <button class="btn small" data-act="signout">Sign out</button></div></div></nav>`;
  }

  // ---------- login ----------
  function renderLogin(msg) {
    app.innerHTML = `<div class="wrap"><div class="login panel"><img src="logo.webp" alt="Bird’s Nest Auctions">
      <h1>Payout Portal</h1><p class="sub">Sign in with your BidPath login.</p>
      ${msg ? `<div class="warnbox">${esc(msg)}</div>` : ''}
      <form id="login-form"><label class="field" for="lg-user">BidPath username<input type="text" id="lg-user" autocomplete="username" required></label>
      <label class="field" for="lg-pass">Password<input type="password" id="lg-pass" autocomplete="current-password" required></label>
      <button class="btn primary" type="submit" id="lg-btn">Sign in</button></form></div></div>`;
    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = document.getElementById('lg-btn'); btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const r = await api('/login', { username: document.getElementById('lg-user').value.trim(), password: document.getElementById('lg-pass').value });
        session = r.session; me = r.user;
        store.set('bna_payout_session', session); store.set('bna_payout_user', JSON.stringify(me));
        route();
      } catch (err) { btn.disabled = false; btn.textContent = 'Sign in'; toast(err.message, true); }
    });
  }

  // ---------- shared: sale state ----------
  function dueInfo(closeDate) {
    const d = M.dueDates(closeDate);
    if (!d) return { chip: '<span class="chip plain">No close date</span>', days: 9999 };
    const days = Math.round((d.target - new Date(new Date().toDateString())) / DAY);
    let chip;
    if (days < 0) chip = `<span class="chip bad">${-days} day${days === -1 ? '' : 's'} past 3 weeks</span>`;
    else if (days <= 7) chip = `<span class="chip warn">${days === 0 ? 'Due today' : `In ${days} day${days === 1 ? '' : 's'}`}</span>`;
    else chip = `<span class="chip ok">In ${days} days</span>`;
    return { chip, days, target: d.target, contract: d.contract };
  }
  function stageOf(sale, payees) {
    if (sale.stage === 'paid') return { n: 4, text: 'Paid' };
    const open = Number(sale.openCount) || 0;
    const due = payees.filter(p => p.rate !== 'house' && Number(p.payout) > 0);
    const paid = due.filter(p => p.paidAt).length;
    if (open) return { n: 1, text: `${open} decision${open === 1 ? '' : 's'} needed` };
    if (paid) return { n: 3, text: `${paid} of ${due.length} paid` };
    if (due.some(p => truthy(p.printed) || p.checkNo)) return { n: 3, text: 'Closing out' };
    return { n: 2, text: 'Ready to close out' };
  }

  // ---------- sales dashboard ----------
  const isPresale = s => /^P/.test(String(s.auctionId));
  const isClosedSale = s => !isPresale(s) && (s.bidpathStatus ? s.bidpathStatus === 'CLOSED' : true);
  async function renderPending() {
    loading('Loading sales…');
    let data;
    try { data = await api('/overview'); } catch (e) { return fail(e); }
    const live = data.Sales.filter(s => s.stage !== 'paid' && !isClosedSale(s));
    const sales = data.Sales.filter(s => s.stage !== 'paid' && isClosedSale(s));
    let total = 0, late = 0, lateN = 0, soon = 0, soonN = 0, owed = 0, open = 0, checks = 0;
    const rows = sales.map(s => {
      const payees = data.Payees.filter(p => String(p.auctionId) === String(s.auctionId));
      const d = dueInfo(s.closeDate), est = Number(s.estPayout) || 0;
      total += est; checks += Number(s.checks) || 0; open += Number(s.openCount) || 0; owed += Number(s.owedByBuyers) || 0;
      if (d.days < 0) { late += est; lateN++; } else if (d.days <= 7) { soon += est; soonN++; }
      const st = stageOf(s, payees);
      const owedCell = s.invoiceAccess === 'no' ? '<span class="meta">No invoice access</span>'
        : Number(s.owedByBuyers) > 0 ? `<b style="color:var(--bad)">${money(s.owedByBuyers)}</b>` : '<span class="meta">$0.00</span>';
      return { days: d.days, html: `<tr class="click" data-go="#sale/${esc(s.auctionId)}">
        <td><b>${esc(s.name)}</b><div class="meta">${s.type === 'consignment' ? 'Consignment' : 'Estate sale'}${s.clientName ? ' · ' + esc(s.clientName) : ''}${s.saleNo ? ' · Sale ' + esc(s.saleNo) : ''}</div></td>
        <td>${fmtShort(s.closeDate)}</td><td class="r">${money(s.soldTotal)}</td><td class="r">${owedCell}</td>
        <td class="r"><b>${money(est)}</b></td><td class="r">${esc(s.checks || 0)}</td>
        <td style="white-space:nowrap">${d.target ? fmtShort(d.target) : '—'}<br>${d.chip}<div class="meta">Contract: ${d.contract ? fmtShort(d.contract) : '—'}</div></td>
        <td><div style="font-weight:500">${esc(st.text)}</div><div class="steps">${[1, 2, 3].map(i => `<i class="${i < st.n ? 'on' : ''}"></i>`).join('')}</div></td></tr>` };
    }).sort((a, b) => a.days - b.days);
    const liveRows = live.map(s => {
      const pre = isPresale(s);
      const status = pre ? '<span class="chip plain">Not in BidPath yet</span>'
        : s.bidpathStatus === 'UPCOMING' ? '<span class="chip plain">Upcoming in BidPath</span>'
        : `<span class="chip ok">Live${s.closeDate ? ', closes ' + fmtShort(s.closeDate) : ''}</span>`;
      return `<tr class="click" data-go="#sale/${esc(s.auctionId)}"><td><b>${esc(s.name)}</b>${s.presaleName && s.presaleName !== s.name ? `<div class="meta">${esc(s.presaleName)}</div>` : ''}
        <div class="meta">${s.type === 'consignment' ? 'Consignment' : 'Estate sale'}${s.clientName ? ' · ' + esc(s.clientName) : ''}</div></td>
        <td>${status}</td><td>${s.photoDate ? fmtShort(s.photoDate + 'T12:00:00') : '—'}</td><td class="r">${(() => { const ft = M.compute({ sale: s, lots: [], fees: (data.Fees || []).filter(f => String(f.auctionId) === String(s.auctionId)) }).feeTotal; return ft ? '−' + money(ft) : '—'; })()}</td></tr>`;
    }).join('');
    app.innerHTML = nav() + `<div class="wrap">
      <div class="head"><div><h1>Sales</h1><div class="sub">Mail checks within 3 weeks of close; the contract allows 30 days.</div></div>
        <div class="row"><button class="btn primary" data-act="new-sale">New sale</button><button class="btn" data-act="add-sale">Add from BidPath</button></div></div>
      <section class="stats">
        <div class="stat lead"><div class="label">Set aside for payouts</div><div class="v">${money(total)}</div><div class="n">${sales.length} closed sale${sales.length === 1 ? '' : 's'}, ${checks} checks · estimate</div></div>
        <div class="stat ${late ? 'bad' : ''}"><div class="label">Past 3 weeks</div><div class="v">${money(late)}</div><div class="n">${lateN} sale${lateN === 1 ? '' : 's'}</div></div>
        <div class="stat"><div class="label">Due in 7 days</div><div class="v">${money(soon)}</div><div class="n">${soonN} sale${soonN === 1 ? '' : 's'}</div></div>
        <div class="stat ${owed ? 'bad' : ''}"><div class="label">Still owed by buyers</div><div class="v">${money(owed)}</div><div class="n">Collect before paying out</div></div>
        <div class="stat"><div class="label">Open decisions</div><div class="v">${open}</div><div class="n">Refunds, tags and rates</div></div>
      </section>
      <section class="panel" style="padding:12px 0 0"><h2 style="padding:0 16px">Pending payouts</h2><div class="tbl"><table>
        <thead><tr><th>Sale</th><th>Closed</th><th class="r">Sold for</th><th class="r">Owed by buyers</th><th class="r">Est. payout</th><th class="r">Checks</th><th>Mail by</th><th>Stage</th></tr></thead>
        <tbody>${rows.map(r => r.html).join('') || '<tr><td colspan="8" class="empty" style="padding:16px">No closed sales waiting on a payout.</td></tr>'}</tbody>
      </table></div></section>
      <section class="panel" style="padding:12px 0 0"><h2 style="padding:0 16px">In progress</h2><p class="meta" style="padding:0 16px;margin:0 0 6px">Sales being photographed, edited or live. Log fees here as they happen.</p><div class="tbl"><table>
        <thead><tr><th>Sale</th><th>Status</th><th>Photo day</th><th class="r">Fees logged</th></tr></thead>
        <tbody>${liveRows || '<tr><td colspan="4" class="empty" style="padding:16px">Nothing in progress. Use “New sale” on photo day.</td></tr>'}</tbody>
      </table></div></section>
      <p class="meta">Estimates update each time a sale is opened, and every morning once the portal’s daily refresh is set up.</p></div>`;
  }

  function newSaleModal() {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="ns-title"><h2 id="ns-title">New sale</h2>
      <p class="sub">Use this on photo day, before the sale is in BidPath. Link it to the BidPath auction once Heather sends it over.</p>
      <form id="ns-form" style="display:grid;gap:12px">
        <label class="field" for="ns-name">Sale name, as it reads in AssetTrax<input type="text" id="ns-name" required placeholder="e.g. 12 Oak St, Derry"></label>
        <fieldset style="border:none;padding:0;margin:0;display:flex;gap:16px;flex-wrap:wrap"><legend class="label" style="margin-bottom:4px">Type</legend>
          <label><input type="radio" name="ns-type" value="estate" checked> Estate sale</label><label><input type="radio" name="ns-type" value="consignment"> Consignment</label></fieldset>
        <div class="row"><label class="field" for="ns-client">Client name<input type="text" id="ns-client"></label><label class="field" for="ns-email">Client email<input type="email" id="ns-email"></label></div>
        <div class="row"><label class="field" for="ns-photo">Photo day<input type="date" id="ns-photo"></label><label class="field" for="ns-at">AssetTrax sale number<input type="text" id="ns-at" placeholder="Optional"></label></div>
        <div class="row"><button class="btn primary" type="submit" id="ns-go">Create sale</button><button class="btn" type="button" data-close>Cancel</button></div>
      </form></div>`;
    document.body.appendChild(bg);
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) bg.remove(); });
    document.getElementById('ns-form').addEventListener('submit', async e => {
      e.preventDefault();
      const b = document.getElementById('ns-go'); b.disabled = true;
      try {
        const r = await api('/create', { name: document.getElementById('ns-name').value.trim(), type: bg.querySelector('input[name=ns-type]:checked').value,
          clientName: document.getElementById('ns-client').value.trim(), clientEmail: document.getElementById('ns-email').value.trim(),
          photoDate: document.getElementById('ns-photo').value, assettraxNo: document.getElementById('ns-at').value.trim() });
        bg.remove(); toast('Sale created.'); location.hash = '#sale/' + r.id;
      } catch (err) { b.disabled = false; toast(err.message, true); }
    });
    document.getElementById('ns-name').focus();
  }

  async function addSaleModal() {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-title"><h2 id="add-title">Add from BidPath</h2><p class="sub">Loading auctions from BidPath…</p></div>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
    let list, have;
    try { [list, have] = await Promise.all([api('/auctions'), api('/overview')]); }
    catch (e) { bg.querySelector('.modal').innerHTML = `<div class="badbox">${esc(e.message)}</div><button class="btn" data-close>Close</button>`; return; }
    const known = new Set(have.Sales.map(s => String(s.auctionId)));
    const fresh = list.filter(a => !known.has(String(a.id)));
    bg.querySelector('.modal').innerHTML = `<h2 id="add-title">Add from BidPath</h2><p class="sub">For a sale with no record yet. If you already made it with “New sale,” open it and use Link instead, so its fees come along.</p>
      <form id="add-form" style="display:grid;gap:12px">
      <label class="field" for="add-auction">Auction<select id="add-auction" required><option value="">Choose a sale…</option>
        ${fresh.map(a => `<option value="${esc(a.id)}">${esc(a.name)} · ${a.status === 'CLOSED' ? 'closed' : a.status === 'UPCOMING' ? 'upcoming, closes' : 'live, closes'} ${fmtShort(a.closeDate)}</option>`).join('')}</select></label>
      <fieldset style="border:none;padding:0;margin:0;display:flex;gap:16px"><legend class="label" style="margin-bottom:4px">Type</legend>
        <label><input type="radio" name="add-type" value="estate" checked> Estate sale (one client)</label>
        <label><input type="radio" name="add-type" value="consignment"> Consignment (several consignors)</label></fieldset>
      <div class="row" id="add-client"><label class="field" for="add-name">Client name<input type="text" id="add-name"></label>
        <label class="field" for="add-email">Client email<input type="email" id="add-email"></label></div>
      <div class="row"><button class="btn primary" type="submit" id="add-go">Add and pull lots</button><button class="btn" type="button" data-close>Cancel</button></div>
      </form><p class="meta">Once the auction closes, the portal saves each lot’s sold price. Any later drop in price, or a lot changing to unsold, shows up as a refund to review.</p>`;
    bg.querySelectorAll('input[name=add-type]').forEach(r => r.addEventListener('change', () => {
      document.getElementById('add-client').hidden = bg.querySelector('input[name=add-type]:checked').value !== 'estate';
    }));
    document.getElementById('add-form').addEventListener('submit', async e => {
      e.preventDefault();
      const id = document.getElementById('add-auction').value; if (!id) return;
      const type = bg.querySelector('input[name=add-type]:checked').value;
      const btn = document.getElementById('add-go'); btn.disabled = true; btn.textContent = 'Pulling lots from BidPath…';
      try {
        const r = await api('/sync', { auctionId: id, type, clientName: document.getElementById('add-name').value.trim(), clientEmail: document.getElementById('add-email').value.trim() });
        close(); toast(`Pulled ${r.synced} lots.`); location.hash = '#sale/' + id;
      } catch (err) { btn.disabled = false; btn.textContent = 'Add and pull lots'; toast(err.message, true); }
    });
  }

  // ---------- sale page ----------
  let S = null; // { id, data, result, base, selected }
  async function loadSale(id) {
    const data = await api('/sale/' + id);
    if (!data.Sales.length) throw new Error('This sale isn’t in the portal yet.');
    if (!S || S.id !== String(id)) feeKind = 'sort';
    S = { id: String(id), data, selected: S && S.id === String(id) ? S.selected : null };
    recompute();
  }
  function baselineLots() {
    const adj = {}; S.data.Adjustments.filter(a => a.status !== 'void').forEach(a => { adj[String(a.lotNo)] = a; });
    return S.data.Lots.map(l => adj[String(l.lotNo)] ? { ...l, price: adj[String(l.lotNo)].origPrice, status: 'SOLD' } : l);
  }
  function recompute() {
    const d = S.data, sale = d.Sales[0];
    const input = { sale, lots: d.Lots, fees: d.Fees, adjustments: d.Adjustments, payees: d.Payees };
    S.result = M.compute(input);
    S.base = M.compute({ ...input, lots: baselineLots(), adjustments: [] });
    persistSummary();
  }
  let persistTimer = null;
  function persistSummary() {
    clearTimeout(persistTimer);
    const cur = S; // keep this sale even if the page changes before the save runs
    persistTimer = setTimeout(async () => {
      const S = cur;
      const sale = S.data.Sales[0], r = S.result;
      const want = { soldTotal: r.soldTotal, estPayout: r.payoutTotal, feeTotal: r.feeTotal, checks: r.checks, openCount: r.openCount };
      const changed = Object.keys(want).some(k => String(sale[k]) !== String(want[k]));
      const payeeRows = r.payees.filter(p => String((p.row || {}).payout) !== String(p.payout))
        .map(p => ({ auctionId: S.id, payeeKey: p.key, name: p.name, email: p.email, rate: p.rate, payout: p.payout }));
      try {
        if (changed) { await save('Sales', [{ auctionId: S.id, ...want }]); Object.assign(sale, want); }
        if (payeeRows.length) {
          await save('Payees', payeeRows);
          payeeRows.forEach(pr => { const row = S.data.Payees.find(p => String(p.payeeKey) === pr.payeeKey); row ? Object.assign(row, pr) : S.data.Payees.push(pr); });
        }
      } catch (e) { toast('Couldn’t save the payout estimate: ' + e.message, true); }
    }, 600);
  }

  async function renderSale(id) {
    if (!S || S.id !== String(id)) { loading('Loading sale…'); try { await loadSale(id); } catch (e) { return fail(e); } }
    else recompute();
    let sale = S.data.Sales[0];
    // A live auction whose close date has passed: pull it once so the snapshot happens.
    if (!isPresale(sale) && sale.bidpathStatus && sale.bidpathStatus !== 'CLOSED' && sale.closeDate && new Date(sale.closeDate) < new Date() && !S.autoSynced) {
      S.autoSynced = true;
      try { await api('/sync', { auctionId: S.id }); S = null; await loadSale(id); S.autoSynced = true; sale = S.data.Sales[0]; } catch (e) { toast(e.message, true); }
    }
    const r = S.result, d = dueInfo(sale.closeDate), pre = isPresale(sale), closed = isClosedSale(sale);
    const blocking = r.flags.length;
    const sub = pre ? `Not in BidPath yet${sale.photoDate ? ' · photo day ' + fmtDate(sale.photoDate + 'T12:00:00') : ''}`
      : !closed ? `Sale ${esc(sale.saleNo)} · ${sale.bidpathStatus === 'UPCOMING' ? 'upcoming' : 'live'} in BidPath · closes ${fmtDate(sale.closeDate)}`
      : `Sale ${esc(sale.saleNo)} · closed ${fmtDate(sale.closeDate)} · mail by ${d.target ? fmtDate(d.target) : '—'} ${d.chip} · contract deadline ${d.contract ? fmtDate(d.contract) : '—'}`;
    app.innerHTML = nav() + `<div class="wrap">
      <div class="head"><div><a href="#" class="meta">← Sales</a><h1>${esc(sale.name)}</h1>
        ${sale.presaleName && sale.presaleName !== sale.name ? `<div class="meta">${esc(sale.presaleName)}</div>` : ''}<div class="sub">${sub}</div></div>
        ${pre ? '' : '<div class="row"><button class="btn" data-act="sync">Refresh from BidPath</button></div>'}</div>
      ${pre ? linkHtml() : `<div class="meta">Last pulled from BidPath ${sale.lastSync ? new Date(sale.lastSync).toLocaleString() : 'never'}${sale.invoiceAccess === 'no' ? ' · <b>Invoices are blocked for your BidPath login</b>, so buyer balances and refunds made before this sale was added can’t be checked.' : ''}</div>`}
      ${saleSettings(sale)}
      ${closed ? `<section class="stats">
        <div class="stat lead"><div class="label">Estimated payout</div><div class="v">${money(r.payoutTotal)}</div><div class="n">${r.checks} check${r.checks === 1 ? '' : 's'}${blocking ? ' · not final yet' : ''}</div></div>
        <div class="stat"><div class="label">Sold for</div><div class="v">${money(r.soldTotal)}</div><div class="n">After refunds</div></div>
        <div class="stat ${Number(sale.owedByBuyers) > 0 ? 'bad' : ''}"><div class="label">Still owed by buyers</div><div class="v">${sale.invoiceAccess === 'no' ? '—' : money(sale.owedByBuyers)}</div><div class="n">Unpaid invoices</div></div>
        <div class="stat ${blocking ? 'bad' : ''}"><div class="label">Needs a decision</div><div class="v">${blocking}</div><div class="n">${blocking ? 'Resolve before close-out' : 'All clear'}</div></div>
      </section>
      <section class="panel"><h2>Needs a decision</h2>${flagsHtml()}</section>
      <section class="panel"><h2>Who gets paid</h2>${payeesHtml()}</section>
      ${S.selected ? `<section class="panel" id="closeout">${closeoutHtml(S.selected)}</section>` : ''}` : `<section class="stats">
        <div class="stat"><div class="label">Fees logged</div><div class="v">${money(r.feeTotal)}</div><div class="n">Deducted from the payout</div></div>
        ${pre ? '' : `<div class="stat"><div class="label">Current bids</div><div class="v">${money(r.soldTotal)}</div><div class="n">Not final until the auction closes</div></div>`}
      </section>`}
      <section class="panel"><h2>Fees</h2>${feesHtml()}</section>
      ${closed ? `<section class="panel"><h2>Refunds on this sale</h2>${saleRefundsHtml()}</section>` : ''}
      ${pre ? '' : `<section class="panel"><h2>Lots</h2>${lotsHtml()}</section>`}
    </div>`;
  }

  function linkHtml() {
    return `<section class="panel"><h2>Link to BidPath</h2><p class="meta">Once Heather sends this sale from AssetTrax, choose its BidPath auction. Fees and details move over, and lots start syncing.</p>
      <div class="row" id="link-row"><button class="btn" data-act="load-link">Find the BidPath auction</button></div></section>`;
  }

  function saleSettings(sale) {
    const est = sale.type !== 'consignment';
    return `<section class="panel"><div class="row">
      <label class="field" for="st-type">Type<select id="st-type" data-sale="type"><option value="estate" ${est ? 'selected' : ''}>Estate sale</option><option value="consignment" ${!est ? 'selected' : ''}>Consignment</option></select></label>
      ${est ? `<label class="field" for="st-name">Client name<input type="text" id="st-name" data-sale="clientName" value="${esc(sale.clientName)}"></label>
      <label class="field" for="st-email">Client email<input type="email" id="st-email" data-sale="clientEmail" value="${esc(sale.clientEmail)}"></label>` : ''}
      <label class="field" for="st-sname">Sale name<input type="text" id="st-sname" data-sale="name" value="${esc(sale.name)}"></label>
      <span class="meta">${est ? 'Client gets 50% up to $10,000 of sales and 65% above. Gold & Silver 65%, vehicles 90%; both count toward the $10,000.' : '50% to each consignor, Gold & Silver 65%, vehicles 90%, staff 100%.'}</span></div></section>`;
  }

  // ----- flags -----
  function adjFor(lotNo) { return S.data.Adjustments.find(a => String(a.lotNo) === String(lotNo) && a.status !== 'void'); }
  function lotRow(lotNo) { return S.data.Lots.find(l => String(l.lotNo) === String(lotNo)); }
  function flagsHtml() {
    const fl = S.result.flags, info = S.result.pending.map(x => `<div class="warnbox">${esc(x.text)}</div>`).join('');
    if (!fl.length) return info + '<p class="empty">Nothing to decide. This sale is ready to close out.</p>';
    return info + `<div class="flags">${fl.map((f, i) => {
      if (f.kind === 'refund' || f.kind === 'highValue') return refundEditor(adjFor(f.lotNo), 'sale');
      const l = lotRow(f.lotNo) || {};
      if (f.kind === 'metal') return `<div class="flag"><div class="t">${esc(f.text)}</div><div class="meta">${esc(l.name)} · ${money(l.price)}</div>
        <div class="row"><button class="btn small primary" data-lot-set="${esc(f.lotNo)}" data-field="lotRate" data-val="gs">Pay at 65% (Gold & Silver)</button>
        <button class="btn small" data-lot-set="${esc(f.lotNo)}" data-field="lotRate" data-val="general">Not gold or sterling, regular rate</button></div></div>`;
      if (f.kind === 'vehicle') return `<div class="flag"><div class="t">${esc(f.text)}</div><div class="meta">${esc(l.name)} · ${esc(l.category)} · ${money(l.closePrice || l.price)}</div>
        <div class="row"><button class="btn small primary" data-lot-set="${esc(f.lotNo)}" data-field="lotRate" data-val="vehicle">Vehicle or equipment, 90%</button>
        <button class="btn small" data-lot-set="${esc(f.lotNo)}" data-field="lotRate" data-val="general">Not a vehicle, regular rate</button></div></div>`;
      if (f.kind === 'houseInRun') return `<div class="flag"><div class="t">${esc(f.text)}</div><div class="meta">${esc(l.name)} · ${money(l.price)}</div>
        <div class="row"><button class="btn small primary" data-lot-set="${esc(f.lotNo)}" data-field="payeeOverride" data-val="${esc(f.payee)}">Move to ${esc(f.payee)}</button>
        <button class="btn small" data-lot-set="${esc(f.lotNo)}" data-field="payeeOverride" data-val="BNA">It’s ours, keep as BNA</button></div></div>`;
      if (f.kind === 'unassigned') {
        const un = S.result.payees.find(p => p.key === 'UNASSIGNED');
        const keys = S.result.payees.filter(p => p.key !== 'UNASSIGNED').map(p => p.key);
        return `<div class="flag"><div class="t">${esc(f.text)}</div><div class="meta">Give each lot a consignor. Use initials or the consignor’s email.</div>
          ${un.lots.map(x => `<div class="row"><span style="min-width:0;flex:1">Lot ${esc(x.lot.lotNo)} · ${esc(x.lot.name)} · ${money(x.price)}</span>
            <input type="text" list="payee-keys" id="un-${esc(x.lot.lotNo)}" placeholder="Initials or email" style="width:170px">
            <button class="btn small" data-assign="${esc(x.lot.lotNo)}">Assign</button></div>`).join('')}
          <datalist id="payee-keys">${keys.map(k => `<option value="${esc(k)}">`).join('')}</datalist></div>`;
      }
      return `<div class="flag"><div class="t">${esc(f.text)}</div></div>`;
    }).join('')}</div>`;
  }

  // Shared refund editor. where = 'sale' | 'refunds'
  function refundEditor(a, where) {
    if (!a) return '';
    const amt = M.adjAmount(a);
    const r = M.REASONS[a.reason];
    const suggested = a.invoiceNote ? M.suggestReason(a.invoiceNote) : '';
    const sel = a.reason || suggested;
    const paid = M.clientPaid({ ...a, reason: sel });
    const decided = a.status === 'classified';
    const hv = amt >= M.HIGH_VALUE;
    const id = esc(a.id);
    const opts = Object.keys(M.GROUPS).map(g => `<optgroup label="${M.GROUPS[g]}">${Object.entries(M.REASONS).filter(([, v]) => v.g === g)
      .map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v.name}${v.describe ? ' (describe)' : ''}</option>`).join('')}</optgroup>`).join('');
    const paidCtl = a.kind === 'partial'
      ? `<label class="field" for="pd-${id}">Pay the client on<select id="pd-${id}" data-adj-field="clientPaid"><option value="false" ${!paid ? 'selected' : ''}>Reduced price ${money(a.newPrice)}</option><option value="true" ${paid ? 'selected' : ''}>Original price ${money(a.origPrice)}</option></select></label>`
      : `<label class="field" for="pd-${id}">Does the client still get paid?<select id="pd-${id}" data-adj-field="clientPaid"><option value="" ${paid == null ? 'selected' : ''}>Choose…</option><option value="true" ${paid === true ? 'selected' : ''}>Yes, on ${money(a.origPrice)}</option><option value="false" ${paid === false ? 'selected' : ''}>No</option></select></label>`;
    const showFix = (r || M.REASONS[sel] || {}).g === 'ours';
    return `<div class="flag ${decided && !(hv && !truthy(a.highValueOk)) ? 'done' : ''}" data-adj="${id}">
      <div class="t">Lot ${esc(a.lotNo)} · ${esc(a.itemName)}${where === 'refunds' ? ` <span class="meta">· ${esc(a.saleName)}</span>` : ''}</div>
      <div class="meta">${a.kind === 'partial' ? `Price lowered from ${money(a.origPrice)} to ${money(a.newPrice)}` : `Refunded in full, sold for ${money(a.origPrice)}`} · ${money(amt)} refunded${hv ? ' · <b>High value: confirm who gets paid</b>' : ''}${decided ? ` · decided by ${esc(a.decidedBy)}` : ''}</div>
      ${a.invoiceNote ? `<div class="note">Invoice note: ${esc(a.invoiceNote)}</div>` : ''}
      <div class="row">
        <label class="field" for="rs-${id}">Reason<select id="rs-${id}" data-adj-field="reason"><option value="">Choose a reason…</option>${opts}</select></label>
        ${paidCtl}
      </div>
      <div class="row">
        <label class="field" for="tx-${id}" style="flex:1;min-width:220px">What happened${(M.REASONS[sel] || {}).describe ? ' (required)' : ''}<input type="text" id="tx-${id}" data-adj-field="text" value="${esc(a.text)}" placeholder="Short description"></label>
        ${showFix ? `<label class="field" for="fx-${id}" style="flex:1;min-width:220px">What should change on our end?<input type="text" id="fx-${id}" data-adj-field="fix" value="${esc(a.fix)}" placeholder="e.g. Double-box glass over 8 inches"></label>` : ''}
      </div>
      ${hv ? `<label><input type="checkbox" id="hv-${id}" data-adj-field="highValueOk" ${truthy(a.highValueOk) ? 'checked' : ''}> I checked who gets paid on this ${money(amt)} refund</label>` : ''}
      <div class="row"><button class="btn small primary" data-adj-save="${id}">${decided ? 'Update' : 'Save decision'}</button>${suggested && !a.reason ? `<span class="meta">Reason suggested from the invoice note.</span>` : ''}</div>
    </div>`;
  }
  async function saveAdj(id, container) {
    const list = (S && S.data.Adjustments.some(a => a.id === id)) ? S.data.Adjustments : (R && R.adjs) || [];
    const a = list.find(x => x.id === id); if (!a) return;
    const val = f => { const el = container.querySelector(`[data-adj-field="${f}"]`); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };
    const reason = val('reason');
    if (!reason) return toast('Choose a reason first.', true);
    const text = (val('text') || '').trim();
    if (M.REASONS[reason].describe && !text) return toast('Describe what happened for this reason.', true);
    let cp = val('clientPaid');
    if (a.kind !== 'partial' && cp === '') cp = String(M.REASONS[reason].paid);
    const row = { id, auctionId: a.auctionId, reason, text, clientPaid: cp, status: 'classified', decidedBy: me.name, decidedAt: nowIso() };
    const fix = val('fix'); if (fix !== undefined) row.fix = fix.trim();
    const hv = val('highValueOk'); if (hv !== undefined) row.highValueOk = hv ? 'TRUE' : '';
    try { await save('Adjustments', [row]); Object.assign(a, row); toast('Saved.'); rerender(); }
    catch (e) { toast(e.message, true); }
  }

  // ----- payees -----
  function payeesHtml() {
    const r = S.result;
    const rows = r.payees.map(p => {
      const row = p.row || {};
      const status = row.paidAt ? `<span class="chip ok">Paid ${fmtShort(row.paidAt)}</span>` : row.checkNo ? `<span class="chip warn">Check #${esc(row.checkNo)}</span>` : truthy(row.printed) ? '<span class="chip warn">Printed</span>' : '<span class="chip plain">Not started</span>';
      return `<tr><td><b>${esc(p.name)}</b>${p.email && p.email !== p.name ? `<div class="meta">${esc(p.email)}</div>` : ''}${p.key !== p.name && p.key !== 'CLIENT' ? `<div class="meta">${esc(p.key)}</div>` : ''}</td>
        <td class="r">${p.soldCount}</td><td class="r">${money(p.general)}</td><td class="r">${p.special ? money(p.special) : '—'}</td>
        <td>${p.key === 'CLIENT' ? '<span class="meta">Estate rates</span>' : `<select id="rate-${esc(p.key)}" data-rate="${esc(p.key)}" aria-label="Pay ${esc(p.name)} as">
          <option value="client" ${p.rate === 'client' ? 'selected' : ''}>Consignor 50/50</option><option value="staff" ${p.rate === 'staff' ? 'selected' : ''}>Staff 100%</option><option value="house" ${p.rate === 'house' ? 'selected' : ''}>BNA house</option></select>`}</td>
        <td class="r">${p.feeTotal ? '−' + money(p.feeTotal) : '—'}</td><td class="r"><b>${money(p.payout)}</b></td><td>${p.rate === 'house' ? '' : status}</td>
        <td>${p.rate === 'house' || p.key === 'UNASSIGNED' ? '' : `<button class="btn small ${S.selected === p.key ? 'primary' : ''}" data-select="${esc(p.key)}">Close out</button>`}</td></tr>`;
    }).join('');
    return `<div class="tbl"><table><thead><tr><th>Payee</th><th class="r">Lots</th><th class="r">General</th><th class="r">Gold, silver, vehicles</th><th>Pay as</th><th class="r">Fees</th><th class="r">Payout</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td colspan="6"><b>Total</b></td><td class="r"><b>${money(r.payoutTotal)}</b></td><td colspan="2"></td></tr></tfoot></table></div>`;
  }

  // ----- fees -----
  const FEE_FORM = {
    sort: { label: 'Sorting fee', fields: ['qty'], qty: 'Sort days', help: '$800 per day worked.' },
    removal: { label: 'Item removal', fields: ['qty', 'note'], qty: 'Items removed', help: 'Log each report from Heather. The portal totals them: 10–19 items $150, 20–29 $300, 30 or more $500.' },
    reserve: { label: 'Reserve item', fields: ['lotNo', 'itemName', 'minimum'], help: 'If it doesn’t sell, the fee is 10% of the minimum, up to $250.' },
    access: { label: 'Access/schedule fee', fields: ['qty', 'note'], qty: 'Missed appointments', help: '$250 each. Note the date and what happened.' },
    cancel: { label: 'Cancellation fee', fields: ['amount', 'note'], help: 'Per the contract’s cancellation terms.' },
    other: { label: 'Other fee', fields: ['label', 'amount', 'note'], help: 'Anything else agreed in the proposal.' },
  };
  let feeKind = 'sort';
  function feesHtml() {
    const fees = S.data.Fees;
    const keys = S.result.payees.filter(p => p.rate !== 'house').map(p => p.key);
    const isEst = S.data.Sales[0].type !== 'consignment';
    const lines = S.result.payees.flatMap(p => p.fees.map(f => ({ ...f, payee: p })));
    const desc = f => {
      const k = M.FEES[f.kind] ? f.kind : 'other';
      if (k === 'sort') return `${f.qty} sort day${Number(f.qty) === 1 ? '' : 's'}`;
      if (k === 'removal') return `${f.qty} item${Number(f.qty) === 1 ? '' : 's'} removed`;
      if (k === 'reserve') return `Reserve on lot ${f.lotNo}${f.itemName ? ' ' + f.itemName : ''}, minimum ${money(f.minimum)}`;
      if (k === 'access') return `${f.qty} missed appointment${Number(f.qty) === 1 ? '' : 's'}`;
      return `${f.label || M.FEES[k].name}: ${money(f.amount)}`;
    };
    const ff = FEE_FORM[feeKind];
    const field = (n) => ({
      qty: `<label class="field" for="fee-qty">${ff.qty}<input type="number" id="fee-qty" min="1" step="1" required style="width:110px"></label>`,
      note: `<label class="field" for="fee-note" style="flex:1;min-width:200px">Note<input type="text" id="fee-note" placeholder="${feeKind === 'removal' ? 'e.g. Reported by Heather, removed in AssetTrax' : 'Optional'}"></label>`,
      lotNo: `<label class="field" for="fee-lot">Lot number<input type="text" id="fee-lot" required style="width:100px"></label>`,
      itemName: `<label class="field" for="fee-item">Item<input type="text" id="fee-item" placeholder="e.g. Oak roll-top desk"></label>`,
      minimum: `<label class="field" for="fee-min">Agreed minimum<input type="number" id="fee-min" min="0" step="0.01" required style="width:120px"></label>`,
      amount: `<label class="field" for="fee-amt">Amount<input type="number" id="fee-amt" min="0" step="0.01" required style="width:120px"></label>`,
      label: `<label class="field" for="fee-label">Fee name<input type="text" id="fee-label" required></label>`,
    }[n]);
    return `<div class="two"><div>
      <h3>On the statement</h3>
      ${lines.length ? `<div class="tbl"><table><tbody>${lines.map(f => `<tr><td><b>${esc(f.label)}</b>${!isEst ? ` <span class="meta">· ${esc(f.payee.name)}</span>` : ''}<div class="meta">${esc(f.detail)}</div></td><td class="r">${f.amount ? '−' + money(f.amount) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No fees yet.</p>'}
      </div><div>
      <h3>Logged</h3>
      ${fees.length ? `<div class="tbl"><table><tbody>${fees.map(f => `<tr><td>${esc(desc(f))}${!isEst ? ` <span class="meta">· ${esc(f.payeeKey)}</span>` : ''}${f.note ? `<div class="meta">${esc(f.note)}</div>` : ''}<div class="meta">${esc(f.addedBy)}, ${fmtShort(f.addedAt)}</div></td>
        <td><button class="btn small link" data-fee-del="${esc(f.id)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Nothing logged.</p>'}
      </div></div>
      <form id="fee-form" style="margin-top:14px;display:grid;gap:8px;border-top:1px solid var(--rule);padding-top:12px">
        <div class="row"><label class="field" for="fee-kind">Add<select id="fee-kind">${Object.entries(FEE_FORM).map(([k, v]) => `<option value="${k}" ${k === feeKind ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        ${isEst ? '' : `<label class="field" for="fee-payee">Payee<select id="fee-payee">${keys.map(k => `<option>${esc(k)}</option>`).join('')}</select></label>`}
        ${ff.fields.map(field).join('')}<button class="btn" type="submit">Add</button></div>
        <span class="meta">${esc(ff.help)}</span></form>`;
  }

  function saleRefundsHtml() {
    const adjs = S.data.Adjustments.filter(a => a.status === 'classified');
    if (!adjs.length) return '<p class="empty">No decided refunds. Open ones appear under Needs a decision.</p>';
    return `<div class="tbl"><table><tbody>${adjs.map(a => {
      const r = M.REASONS[a.reason] || {}; const cp = M.clientPaid(a);
      return `<tr><td>Lot ${esc(a.lotNo)} · ${esc(a.itemName)}<div class="meta">${esc(r.name || '')}${a.text ? ': ' + esc(a.text) : ''}</div></td><td class="r">${money(M.adjAmount(a))}</td>
        <td>${a.kind === 'partial' ? (cp ? 'Paid on original' : 'Paid on reduced') : (cp ? 'Client paid' : 'Client not paid')}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  // ----- lots -----
  let lotFilter = '';
  function lotsHtml() {
    const r = S.result, isEst = S.data.Sales[0].type !== 'consignment';
    const all = r.payees.flatMap(p => p.lots.map(l => ({ ...l, payee: p })));
    const q = lotFilter.toLowerCase();
    const shown = all.filter(x => !q || String(x.lot.lotNo).toLowerCase() === q || (x.lot.name || '').toLowerCase().includes(q) || x.payee.key.toLowerCase() === q)
      .sort((a, b) => (parseInt(a.lot.lotNo, 10) || 0) - (parseInt(b.lot.lotNo, 10) || 0));
    const rows = shown.slice(0, 400).map(x => {
      const l = x.lot, rate = x.payee.rate === 'staff' ? 1 : x.payee.rate === 'house' ? 0 : x.cls === 'gs' ? 0.65 : x.cls === 'vehicle' ? 0.9 : x.cls === 'custom' ? Number(l.lotRate) / 100 : 0.5;
      const snap = l.closeStatus !== '' && l.closeStatus != null;
      const changed = snap && (Number(l.closePrice) !== Number(l.price) || l.closeStatus !== l.status);
      return `<tr><td>${esc(l.lotNo)}</td><td>${esc(l.name)}${x.pending ? ' <span class="chip warn">Refund to review</span>' : ''}</td>
        <td>${esc(l.category)}<div>${rateSelect(l, x.cls)}</div></td>
        <td>${esc(x.payee.key === 'CLIENT' ? 'Client' : x.payee.key)}</td>
        <td class="r">${snap ? money(l.closePrice) : (l.status === 'SOLD' ? money(l.price) : '<span class="meta">no bid</span>')}${changed ? `<div class="meta">now ${l.status === 'SOLD' ? money(l.price) : 'unsold'}</div>` : ''}</td>
        ${isEst ? '' : `<td class="r">${x.counted ? money(x.price * rate) : '—'}</td>`}</tr>`;
    }).join('');
    return `<div class="row" style="margin-bottom:10px"><label class="field" for="lot-q">Find a lot<input type="text" id="lot-q" value="${esc(lotFilter)}" placeholder="Lot number, words, or initials"></label>
      <span class="meta">${shown.length} of ${all.length} lots${shown.length > 400 ? ' · showing first 400' : ''}</span></div>
      <div class="tbl"><table><thead><tr><th>Lot</th><th>Item</th><th>Category</th><th>Payee</th><th class="r">Sold for</th>${isEst ? '' : '<th class="r">Pays payee</th>'}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="meta">${isEst ? 'Estate payouts use the $10,000 tier across the whole sale; see the statement for the full calculation.' : 'Pays payee is before fees.'} Change a lot’s rate with the menu under its category; “Special %” is for categories agreed in the proposal.</p>`;
  }
  function rateSelect(l, cls) {
    const v = String(l.lotRate || '');
    const opt = (val, txt) => `<option value="${val}" ${v === val || (val === 'custom' && cls === 'custom') ? 'selected' : ''}>${txt}</option>`;
    return `<select data-lotrate="${esc(l.lotNo)}" aria-label="Rate for lot ${esc(l.lotNo)}" style="font-size:12.5px;padding:2px 4px;margin-top:3px">
      ${opt('', 'Automatic' + (cls === 'gs' && !v ? ' (Gold & Silver)' : ''))}${opt('general', 'Regular rate')}${opt('gs', 'Gold & Silver 65%')}${opt('vehicle', 'Vehicle/equipment 90%')}${opt('custom', cls === 'custom' ? `Special ${Number(v)}%` : 'Special %…')}</select>`;
  }

  // ----- close-out -----
  function emailText(p, row) {
    const sale = S.data.Sales[0];
    const first = (p.name || '').split(/\s+/)[0] || 'there';
    const mailed = row.mailedOn ? fmtDate(row.mailedOn + 'T12:00:00') : '[date mailed]';
    return {
      subject: 'Your Bird’s Nest Auctions payment is on its way',
      body: `Hi ${first},\n\nYour settlement check for ${sale.name} in the amount of ${money(p.payout)} was mailed on ${mailed}. Your settlement statement is enclosed with the check and lists every lot that sold.\n\nThank you for trusting Bird’s Nest Auctions with your sale. If you were happy with your experience, we would be grateful if you would take a moment to leave us a Google review: ${REVIEW_LINK}\n\nIf you have any questions about your statement, simply reply to this email.\n\nWarm regards,\n${me ? me.name : ''}\nBird’s Nest Auctions`,
    };
  }
  function closeoutHtml(key) {
    const p = S.result.payees.find(x => x.key === key); if (!p) return '';
    const row = p.row || {};
    const blocking = S.result.flags.length;
    const printed = truthy(row.printed), checked = !!(row.checkNo && row.mailedOn), emailed = truthy(row.emailed);
    const ready = printed && checked && emailed && !blocking && p.payout > 0;
    const mail = emailText(p, row);
    return `<div class="closeout"><div class="head"><div><h2 style="margin:0">Close out: ${esc(p.name)}</h2><div class="sub">${money(p.payout)} · ${p.soldCount} lots${p.email ? ' · ' + esc(p.email) : ''}</div></div>
      <button class="btn small" data-select="">Close</button></div>
      ${blocking ? `<div class="badbox">${blocking} decision${blocking === 1 ? '' : 's'} still open on this sale. You can print a draft, but you can’t mark it paid until they’re resolved.</div>` : ''}
      ${row.paidAt ? `<div class="warnbox" style="background:var(--ok-bg);color:var(--ok)">Paid ${fmtDate(row.paidAt)} by ${esc(row.paidBy)}, check #${esc(row.checkNo)}.</div>` : ''}
      <div class="step ${printed ? 'done' : ''}"><div class="num">${printed ? '✓' : '1'}</div><div><h3>Print the client statement</h3>
        <p class="meta">Goes in the envelope with the check. Refund details stay off the client copy.</p>
        <div class="row"><a class="btn" href="#statement/${esc(S.id)}/${encodeURIComponent(p.key)}">Open statement</a>
        <button class="btn ${printed ? 'primary' : ''}" data-payee-toggle="printed">${printed ? 'Printed ✓' : 'Mark as printed'}</button></div></div></div>
      ${printed && !emailed ? `<div class="warnbox">Statement printed. Remember to send ${esc(p.name.split(/\s+/)[0])} the payment confirmation email with the review link.</div>` : ''}
      <div class="step ${checked ? 'done' : ''}"><div class="num">${checked ? '✓' : '2'}</div><div><h3>Record the check</h3>
        <div class="row"><label class="field" for="co-chk">Check number<input type="text" id="co-chk" data-payee-field="checkNo" value="${esc(row.checkNo)}" style="width:130px"></label>
        <label class="field" for="co-mail">Mailed on<input type="date" id="co-mail" data-payee-field="mailedOn" value="${esc(String(row.mailedOn || '').slice(0, 10))}"></label>
        <button class="btn" data-payee-save>Save</button></div></div></div>
      <div class="step ${emailed ? 'done' : ''}"><div class="num">${emailed ? '✓' : '3'}</div><div><h3>Send the payment confirmation email</h3>
        <p class="meta">${p.email ? `To ${esc(p.email)}.` : 'No email on file. Add one on the sale settings first.'} Create the draft, review it in Missive, then send it from there.</p>
        <div class="mail"><b>Subject: ${esc(mail.subject)}</b>\n\n${esc(mail.body)}</div>
        <div class="row" style="margin-top:8px"><button class="btn" data-missive ${p.email ? '' : 'disabled'}>Create draft in Missive</button><button class="btn" data-copy-mail>Copy email</button>
        <button class="btn ${emailed ? 'primary' : ''}" data-payee-toggle="emailed">${emailed ? 'Sent ✓' : 'Mark as sent'}</button></div></div></div>
      <div class="step"><div class="num">4</div><div><h3>Mark paid</h3>
        <p class="meta">${ready ? 'Everything is done. This records the payment and locks it in.' : 'Available once the statement is printed, the check is recorded, the email is sent, and nothing on the sale needs a decision.'}</p>
        <button class="btn primary" data-payee-paid ${ready && !row.paidAt ? '' : 'disabled'}>Mark paid</button></div></div></div>`;
  }
  async function savePayee(fields) {
    const p = S.result.payees.find(x => x.key === S.selected);
    const row = { auctionId: S.id, payeeKey: p.key, name: p.name, email: p.email, rate: p.rate, payout: p.payout, ...fields };
    await save('Payees', [row]);
    const existing = S.data.Payees.find(x => String(x.payeeKey) === p.key);
    existing ? Object.assign(existing, row) : S.data.Payees.push(row);
    // Whole sale paid?
    recompute();
    const due = S.result.payees.filter(x => x.rate !== 'house' && x.payout > 0);
    if (due.length && due.every(x => (x.row || {}).paidAt)) { await save('Sales', [{ auctionId: S.id, stage: 'paid' }]); S.data.Sales[0].stage = 'paid'; return true; }
    return false;
  }

  // ---------- statement ----------
  async function renderStatement(id, key, internal) {
    if (!S || S.id !== String(id)) { loading('Loading statement…'); try { await loadSale(id); } catch (e) { return fail(e); } }
    else recompute();
    const sale = S.data.Sales[0];
    const p = S.result.payees.find(x => x.key === key);
    const b = S.base.payees.find(x => x.key === key);
    if (!p || !b) return fail(new Error('No payee ' + key + ' on this sale.'));
    const isEst = sale.type !== 'consignment';
    const lessAdj = M.r2(b.share - p.share);
    const lots = b.lots.filter(l => l.counted).sort((x, y) => (parseInt(x.lot.lotNo, 10) || 0) - (parseInt(y.lot.lotNo, 10) || 0));
    const gen = lots.filter(l => l.cls === 'general'), gs = lots.filter(l => l.cls === 'gs'), veh = lots.filter(l => l.cls === 'vehicle'), cust = lots.filter(l => l.cls === 'custom');
    const staff = p.rate === 'staff';
    const calc = [];
    calc.push(`<tr><td>General lots, ${gen.length} sold</td><td>${money(b.general)}</td></tr>`);
    if (staff) calc.push(`<tr><td>Your share at 100%</td><td>${money(b.generalShare)}</td></tr>`);
    else if (isEst) {
      calc.push(`<tr><td>Your share at 50%${b.tierHigh > 0 ? ` on ${money(b.tierLow)}` : ''} (sales up to $10,000)</td><td>${money(b.tierLow * 0.5)}</td></tr>`);
      if (b.tierHigh > 0) calc.push(`<tr><td>Your share at 65% on ${money(b.tierHigh)} (sales above $10,000)</td><td>${money(b.tierHigh * 0.65)}</td></tr>`);
    } else calc.push(`<tr><td>Your share at 50%</td><td>${money(b.generalShare)}</td></tr>`);
    if (gs.length) calc.push(`<tr><td>Gold &amp; sterling lots, ${gs.length} sold, ${money(b.gs)} · paid at ${staff ? '100' : '65'}%</td><td>${money(b.gsShare)}</td></tr>`);
    if (veh.length) calc.push(`<tr><td>Vehicles &amp; equipment, ${veh.length} sold, ${money(b.vehicle)} · paid at ${staff ? '100' : '90'}%</td><td>${money(b.vehicleShare)}</td></tr>`);
    if (cust.length) calc.push(`<tr><td>Special-rate lots, ${cust.length} sold, ${money(b.custom)}</td><td>${money(b.customShare)}</td></tr>`);
    calc.push(`<tr class="sub"><td>Subtotal before fees</td><td>${money(b.share)}</td></tr>`);
    p.fees.filter(f => f.amount > 0).forEach(f => calc.push(`<tr class="less"><td>Less ${esc(f.label)}<div style="font-size:12px;color:#5d6b67">${esc(f.detail)}</div></td><td>−${money(f.amount)}</td></tr>`));
    if (lessAdj > 0) calc.push(`<tr class="less"><td>Less adjustments</td><td>−${money(lessAdj)}</td></tr>`);
    calc.push(`<tr class="total"><td>Balance due</td><td>${money(p.payout)}</td></tr>`);
    const adjRows = p.lots.filter(l => l.adj).map(l => {
      const a = l.adj, r = M.REASONS[a.reason] || {}, cp = M.clientPaid(a);
      return `<tr><td>${esc(a.lotNo)}</td><td>${esc(a.itemName)}<div style="font-size:12px;color:#5d6b67">${a.status === 'classified' ? esc(r.name || '') + (a.text ? ': ' + esc(a.text) : '') : '<b>Not decided yet</b>'}</div></td>
        <td>${a.kind === 'partial' ? `${money(a.origPrice)} → ${money(a.newPrice)}` : 'Full refund'}</td><td>${a.status !== 'classified' ? '—' : a.kind === 'partial' ? (cp ? 'Paid on original' : 'Paid on reduced') : (cp ? 'Client paid' : 'Not paid')}</td></tr>`;
    }).join('');
    const pending = S.result.flags.length;
    app.innerHTML = nav() + `<div class="wrap">
      <div class="stmt-bar noprint"><a href="#sale/${esc(S.id)}" class="meta">← Back to the sale</a>
        <div class="row"><a class="btn ${internal ? '' : 'primary'}" href="#statement/${esc(S.id)}/${encodeURIComponent(key)}">Client copy</a>
        <a class="btn ${internal ? 'primary' : ''}" href="#statement/${esc(S.id)}/${encodeURIComponent(key)}/internal">Internal view</a>
        <button class="btn primary" data-act="print">Print</button></div></div>
      ${pending ? `<div class="badbox noprint">${pending} decision${pending === 1 ? '' : 's'} still open on this sale, so this statement is a draft.</div>` : ''}
      <div class="sheet">
        <header class="band"><img src="logo.webp" alt="Bird’s Nest Auctions">
          <div style="text-align:right"><h1>Settlement Statement</h1>${internal ? '<span class="tag">Internal view</span>' : ''}${pending ? '<span class="tag" style="margin-left:6px">Draft</span>' : ''}</div></header>
        <div class="inner">
          <section class="meta4">
            <div><div class="label">${isEst ? 'Client' : 'Consignor'}</div><div>${esc(p.name)}</div></div>
            <div><div class="label">Sale</div><div>${esc(sale.name)}</div></div>
            <div><div class="label">Auction closed</div><div>${fmtDate(sale.closeDate)}</div></div>
          </section>
          <section class="top">
            <div class="bal"><div class="label">Balance due to you</div><div class="big">${money(p.payout)}</div>
              <p style="margin:8px 0 0;font-size:13px;color:#5d6b67">${lots.length} lots sold · ${money(b.general + b.gs)} in total sales</p></div>
            <div><h2>How your payout was calculated</h2><table class="calc">${calc.join('')}</table>
              <p class="note2">${staff ? 'Staff consignments are paid at 100%.' : isEst ? 'Sales above $10,000 pay 65% to you. Gold and sterling (65%) and vehicles (90%) are paid at their own rates and count toward the $10,000.' : 'Gold and sterling pay 65% from the first dollar.'}</p></div>
          </section>
          ${internal ? `<section class="int"><h2 style="margin:0 0 8px;color:#8a4b12">Refunds &amp; adjustments (internal only)</h2>
            ${adjRows ? `<table class="ledger"><thead><tr><th>Lot</th><th>Item</th><th>Change</th><th>Payout</th></tr></thead><tbody>${adjRows}</tbody></table>` : '<p style="margin:0">No refunds or adjustments on these lots.</p>'}
            ${S.data.Fees.length ? `<p style="margin:10px 0 0">Fees logged: ${S.data.Fees.filter(f => !f.payeeKey || f.payeeKey === key).map(f => `${esc(M.FEES[f.kind] ? M.FEES[f.kind].name : (f.label || 'Fee'))}${f.qty ? ' ×' + esc(f.qty) : ''}${f.note ? ' (' + esc(f.note) + ')' : ''}, ${esc(f.addedBy)} ${fmtShort(f.addedAt)}`).join('; ')}</p>` : ''}</section>` : ''}
          <section><h2>Lots sold</h2><div class="tbl"><table class="ledger"><thead><tr><th>Lot</th><th>Description</th><th class="r">Sold for</th></tr></thead>
            <tbody>${lots.map(l => `<tr><td>${esc(l.lot.lotNo)}</td><td>${esc(l.lot.name)}${l.cls !== 'general' ? ` <span style="font-size:11px;color:#2D6B5E;font-weight:600">· ${esc(M.CLASS_NAME[l.cls])}</span>` : ''}</td><td class="r">${money(l.price)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td></td><td>Total, ${lots.length} lots</td><td class="r">${money(b.general + b.gs)}</td></tr></tfoot></table></div>
            <p class="note2">Lots not listed did not sell or were withdrawn.</p></section>
          <footer><span>Questions about this statement? Contact us at ${CONTACT}.<br>${WEBSITE}</span><span>Thank you for trusting us with your sale.</span></footer>
        </div></div></div>`;
  }

  // ---------- refunds page ----------
  let R = null, refundFilter = 'all';
  async function renderRefunds() {
    loading('Loading refunds…');
    let data; try { data = await api('/overview'); } catch (e) { return fail(e); }
    R = { adjs: data.Adjustments.filter(a => a.status !== 'void') };
    drawRefunds();
  }
  function drawRefunds() {
    const adjs = R.adjs, grp = a => (M.REASONS[a.reason] || {}).g || 'wait';
    const open = adjs.filter(a => a.status !== 'classified');
    const sum = g => adjs.filter(a => grp(a) === g).reduce((s, a) => s + M.adjAmount(a), 0);
    const cnt = g => adjs.filter(a => grp(a) === g).length;
    const byR = {}; adjs.filter(a => a.reason).forEach(a => { (byR[a.reason] = byR[a.reason] || { n: 0, v: 0 }); byR[a.reason].n++; byR[a.reason].v += M.adjAmount(a); });
    const bars = Object.entries(byR).sort((a, b) => b[1].n - a[1].n || b[1].v - a[1].v), max = Math.max(1, ...bars.map(b => b[1].n));
    const fixes = adjs.filter(a => a.fix);
    const shown = adjs.filter(a => refundFilter === 'all' || grp(a) === refundFilter).sort((a, b) => String(b.detectedAt).localeCompare(String(a.detectedAt)));
    const label = { wait: 'Waiting for a reason', ...M.GROUPS };
    app.innerHTML = nav() + `<div class="wrap">
      <div class="head"><div><h1>Refunds</h1><div class="sub">Every refund the portal has found, with the reason and whether the client was paid.</div></div></div>
      ${open.length ? `<section class="panel"><h2>Waiting for a reason (${open.length})</h2><p class="meta">Their sales can’t close out until each one has a reason.</p><div class="flags">${open.map(a => refundEditor(a, 'refunds')).join('')}</div></section>` : ''}
      <section class="stats">
        <div class="stat"><div class="label">Refunded to buyers</div><div class="v">${money(adjs.reduce((s, a) => s + M.adjAmount(a), 0))}</div><div class="n">${adjs.length} refunds</div></div>
        ${Object.keys(M.GROUPS).map(g => `<div class="stat" style="border-top:4px solid var(--${g})"><div class="label">${M.GROUPS[g]}</div><div class="v">${money(sum(g))}</div><div class="n">${cnt(g)} refund${cnt(g) === 1 ? '' : 's'}</div></div>`).join('')}
      </section>
      <section class="two">
        <div class="panel"><h2>Why items were refunded</h2>${bars.length ? `<div class="bars">${bars.map(([k, v]) => `<div class="bar"><span class="nm" title="${esc(M.REASONS[k].name)}">${esc(M.REASONS[k].name)}</span><div class="track"><div class="fill" style="width:${v.n / max * 100}%;background:var(--${M.REASONS[k].g})"></div></div><span class="meta">${v.n} · ${money(v.v)}</span></div>`).join('')}</div>` : '<p class="empty">No decided refunds yet.</p>'}</div>
        <div class="panel"><h2>Fixes on our end</h2>${fixes.length ? fixes.map(a => `<label style="display:grid;grid-template-columns:auto 1fr;gap:10px;padding:8px 0;border-top:1px solid var(--rule)"><input type="checkbox" data-fixdone="${esc(a.id)}" ${truthy(a.fixDone) ? 'checked' : ''}>
          <span><span style="${truthy(a.fixDone) ? 'text-decoration:line-through;color:var(--muted)' : 'font-weight:500'}">${esc(a.fix)}</span><div class="meta">Lot ${esc(a.lotNo)}, ${esc(a.saleName)}</div></span></label>`).join('') : '<p class="empty">No fixes noted yet.</p>'}</div>
      </section>
      <section class="panel"><h2>Refund log</h2>
        <div class="row" style="margin-bottom:10px">${['all', 'wait', ...Object.keys(M.GROUPS)].map(g => `<button class="btn small ${refundFilter === g ? 'primary' : ''}" data-rfilter="${g}">${g === 'all' ? 'All' : label[g]} (${g === 'all' ? adjs.length : cnt(g)})</button>`).join('')}</div>
        <div class="tbl"><table><thead><tr><th>Found</th><th>Sale · Lot</th><th>Item</th><th class="r">Refunded</th><th>Reason</th><th>Client paid?</th><th>Decided by</th></tr></thead><tbody>
        ${shown.map(a => { const r = M.REASONS[a.reason]; const cp = M.clientPaid(a); return `<tr><td>${fmtShort(a.detectedAt)}</td>
          <td><a href="#sale/${esc(a.auctionId)}">${esc(a.saleName)}</a><div class="meta">Lot ${esc(a.lotNo)}</div></td><td>${esc(a.itemName)}</td>
          <td class="r">${money(M.adjAmount(a))}${a.kind === 'partial' ? `<div class="meta">${money(a.origPrice)} → ${money(a.newPrice)}</div>` : ''}</td>
          <td>${r ? `<span class="chip" style="background:var(--tint);color:var(--${r.g});border:1px solid var(--rule)">${esc(M.GROUPS[r.g])}</span><div class="meta">${esc(r.name)}${a.text ? ': ' + esc(a.text) : ''}</div>` : '<span class="chip warn">Waiting</span>'}</td>
          <td>${a.status === 'classified' ? (a.kind === 'partial' ? (cp ? 'On original' : 'On reduced') : (cp ? 'Yes' : 'No')) : '—'}</td><td class="meta">${esc(a.decidedBy)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="empty" style="padding:14px">No refunds yet.</td></tr>'}
        </tbody></table></div><p class="meta">To change a decision, open the sale and update it under Refunds on this sale, or reopen it here from the queue.</p></section></div>`;
  }

  // ---------- paid ----------
  async function renderPaid() {
    loading('Loading paid sales…');
    let data; try { data = await api('/overview'); } catch (e) { return fail(e); }
    const sales = data.Sales.filter(s => s.stage === 'paid');
    app.innerHTML = nav() + `<div class="wrap"><div class="head"><div><h1>Paid</h1><div class="sub">Sales where every payee has been paid.</div></div></div>
      <section class="panel" style="padding:4px 0 0"><div class="tbl"><table><thead><tr><th>Sale</th><th>Closed</th><th class="r">Paid out</th><th>Checks</th></tr></thead><tbody>
      ${sales.map(s => { const ps = data.Payees.filter(p => String(p.auctionId) === String(s.auctionId) && p.paidAt);
        return `<tr class="click" data-go="#sale/${esc(s.auctionId)}"><td><b>${esc(s.name)}</b><div class="meta">Sale ${esc(s.saleNo)}</div></td><td>${fmtShort(s.closeDate)}</td>
        <td class="r">${money(s.estPayout)}</td><td class="meta">${ps.map(p => `${esc(p.name)}: #${esc(p.checkNo)} mailed ${esc(String(p.mailedOn).slice(0, 10))}`).join('<br>')}</td></tr>`; }).join('') || '<tr><td colspan="4" class="empty" style="padding:14px">Nothing paid through the portal yet.</td></tr>'}
      </tbody></table></div></section></div>`;
  }

  // ---------- routing & events ----------
  function rerender() { route(true); }
  function route(keep) {
    if (!session) return renderLogin();
    const h = decodeURIComponent(location.hash.slice(1));
    const parts = h.split('/');
    if (!keep && parts[0] !== 'sale' && parts[0] !== 'statement') S = null;
    if (parts[0] === 'sale' && parts[1]) return renderSale(parts[1]);
    if (parts[0] === 'statement' && parts[1]) return renderStatement(parts[1], parts[2], parts[3] === 'internal');
    if (parts[0] === 'refunds') return R && keep ? drawRefunds() : renderRefunds();
    if (parts[0] === 'paid') return renderPaid();
    return renderPending();
  }
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });

  app.addEventListener('click', async e => {
    const t = e.target;
    const go = t.closest('[data-go]'); if (go && !t.closest('a,button,select,input')) { location.hash = go.dataset.go; return; }
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'signout') return signOut();
    if (act === 'add-sale') return addSaleModal();
    if (act === 'new-sale') return newSaleModal();
    if (act === 'load-link') {
      const rowEl = document.getElementById('link-row'); rowEl.innerHTML = '<span class="meta">Loading BidPath auctions…</span>';
      try {
        const [list, have] = await Promise.all([api('/auctions'), api('/overview')]);
        const known = new Set(have.Sales.map(x => String(x.auctionId)));
        const free = list.filter(a => !known.has(String(a.id))).sort((a, b) => (a.status === 'CLOSED') - (b.status === 'CLOSED') || Number(b.id) - Number(a.id));
        rowEl.innerHTML = `<label class="field" for="link-pick">BidPath auction<select id="link-pick"><option value="">Choose…</option>${free.map(a => `<option value="${esc(a.id)}">${esc(a.name)} · ${a.status === 'CLOSED' ? 'closed' : a.status === 'UPCOMING' ? 'upcoming' : 'live'}${a.closeDate ? ', closes ' + fmtShort(a.closeDate) : ''}</option>`).join('')}</select></label>
          <button class="btn primary" data-act="do-link">Link</button>`;
      } catch (err) { rowEl.innerHTML = `<span class="badbox">${esc(err.message)}</span>`; }
      return;
    }
    if (act === 'do-link') {
      const to = document.getElementById('link-pick').value; if (!to) return toast('Choose the BidPath auction first.', true);
      const b = t.closest('button'); b.disabled = true; b.textContent = 'Linking…';
      try { await api('/link', { from: S.id, auctionId: to }); S = null; toast('Linked. Fees moved over and lots are syncing.'); location.hash = '#sale/' + to; }
      catch (err) { b.disabled = false; b.textContent = 'Link'; toast(err.message, true); }
      return;
    }
    if (act === 'print') return window.print();
    if (act === 'sync') {
      const b = t.closest('button'); b.disabled = true; b.textContent = 'Pulling from BidPath…';
      try { const id = S.id; const r = await api('/sync', { auctionId: id }); S = null; await loadSale(id); toast(`Pulled ${r.synced} lots${r.newRefunds ? `, found ${r.newRefunds} refund${r.newRefunds === 1 ? '' : 's'} to review` : ''}.`); rerender(); }
      catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Refresh from BidPath'; }
      return;
    }
    const ls = t.closest('[data-lot-set]');
    if (ls) {
      const row = { auctionId: S.id, lotNo: ls.dataset.lotSet, [ls.dataset.field]: ls.dataset.val };
      try { await save('Lots', [row]); Object.assign(lotRow(row.lotNo), row); toast('Saved.'); rerender(); } catch (err) { toast(err.message, true); }
      return;
    }
    const as = t.closest('[data-assign]');
    if (as) {
      const v = document.getElementById('un-' + as.dataset.assign).value.trim(); if (!v) return toast('Type initials or an email first.', true);
      const key = v.includes('@') ? v.toLowerCase() : v.toUpperCase();
      try { await save('Lots', [{ auctionId: S.id, lotNo: as.dataset.assign, payeeOverride: key }]); lotRow(as.dataset.assign).payeeOverride = key; toast('Assigned.'); rerender(); } catch (err) { toast(err.message, true); }
      return;
    }
    const sv = t.closest('[data-adj-save]'); if (sv) return saveAdj(sv.dataset.adjSave, sv.closest('[data-adj]'));
    const sel = t.closest('[data-select]'); if (sel) { S.selected = sel.dataset.select || null; rerender(); if (S.selected) setTimeout(() => document.getElementById('closeout')?.scrollIntoView({ behavior: 'smooth' }), 50); return; }
    const pt = t.closest('[data-payee-toggle]');
    if (pt) { const f = pt.dataset.payeeToggle, p = S.result.payees.find(x => x.key === S.selected); try { await savePayee({ [f]: truthy((p.row || {})[f]) ? '' : 'TRUE' }); rerender(); } catch (err) { toast(err.message, true); } return; }
    if (t.closest('[data-payee-save]')) {
      try { await savePayee({ checkNo: document.getElementById('co-chk').value.trim(), mailedOn: document.getElementById('co-mail').value }); toast('Saved.'); rerender(); } catch (err) { toast(err.message, true); } return;
    }
    if (t.closest('[data-payee-paid]')) { try { const all = await savePayee({ paidAt: nowIso(), paidBy: me.name }); toast(all ? 'Marked paid. Every payee is paid, so the sale moved to Paid.' : 'Marked paid.'); rerender(); } catch (err) { toast(err.message, true); } return; }
    if (t.closest('[data-copy-mail]') || t.closest('[data-missive]')) {
      const p = S.result.payees.find(x => x.key === S.selected), m = emailText(p, p.row || {});
      if (t.closest('[data-missive]')) {
        try { await api('/missive-draft', { to: p.email, subject: m.subject, body: m.body }); toast('Draft created in Missive. Review it there, then send.'); } catch (err) { toast(err.message, true); }
      } else {
        try { await navigator.clipboard.writeText(`Subject: ${m.subject}\n\n${m.body}`); toast('Email copied.'); } catch (err) { toast('Copy didn’t work here; select the text and copy it.', true); }
      }
      return;
    }
    const fd = t.closest('[data-fee-del]');
    if (fd) { try { await api('/remove', { tab: 'Fees', row: { id: fd.dataset.feeDel } }); S.data.Fees = S.data.Fees.filter(f => f.id !== fd.dataset.feeDel); toast('Fee removed.'); rerender(); } catch (err) { toast(err.message, true); } return; }
    const rf = t.closest('[data-rfilter]'); if (rf) { refundFilter = rf.dataset.rfilter; drawRefunds(); return; }
  });

  app.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'fee-kind') { feeKind = t.value; const sec = t.closest('section'); sec.innerHTML = '<h2>Fees</h2>' + feesHtml(); return; }
    if (t.dataset.lotrate) {
      let v = t.value;
      if (v === 'custom') {
        const box = document.createElement('span');
        box.innerHTML = ` <input type="number" min="0" max="100" step="1" style="width:64px;font-size:12.5px;padding:2px 4px" aria-label="Client percent" placeholder="%"> <button class="btn small" type="button">Set</button>`;
        t.after(box);
        box.querySelector('button').addEventListener('click', async () => {
          const pct = Number(box.querySelector('input').value);
          if (!(pct >= 0 && pct <= 100)) return toast('Enter the client’s percent, 0 to 100.', true);
          try { await save('Lots', [{ auctionId: S.id, lotNo: t.dataset.lotrate, lotRate: String(pct) }]); lotRow(t.dataset.lotrate).lotRate = String(pct); toast('Saved.'); rerender(); } catch (err) { toast(err.message, true); }
        });
        return;
      }
      try { await save('Lots', [{ auctionId: S.id, lotNo: t.dataset.lotrate, lotRate: v, gsOverride: '' }]); Object.assign(lotRow(t.dataset.lotrate), { lotRate: v, gsOverride: '' }); toast('Saved.'); rerender(); } catch (err) { toast(err.message, true); }
      return;
    }
    if (t.dataset.rate) {
      const p = S.result.payees.find(x => x.key === t.dataset.rate);
      try { await save('Payees', [{ auctionId: S.id, payeeKey: p.key, name: p.name, email: p.email, rate: t.value, rateReason: `Set by ${me.name}` }]);
        const ex = S.data.Payees.find(x => String(x.payeeKey) === p.key); ex ? (ex.rate = t.value) : S.data.Payees.push({ payeeKey: p.key, name: p.name, email: p.email, rate: t.value });
        toast('Saved.'); rerender(); } catch (err) { toast(err.message, true); }
      return;
    }
    if (t.dataset.sale) {
      const f = t.dataset.sale;
      try { await save('Sales', [{ auctionId: S.id, [f]: t.value.trim() }]); S.data.Sales[0][f] = t.value.trim(); toast('Saved.'); if (f === 'type' || f === 'name') rerender(); } catch (err) { toast(err.message, true); }
      return;
    }
    if (t.dataset.fixdone) {
      const a = R.adjs.find(x => x.id === t.dataset.fixdone);
      try { await save('Adjustments', [{ id: a.id, auctionId: a.auctionId, fixDone: t.checked ? 'TRUE' : '' }]); a.fixDone = t.checked ? 'TRUE' : ''; drawRefunds(); } catch (err) { toast(err.message, true); }
    }
    if (t.dataset.adjField === 'reason') {
      // Show the right follow-up fields for the chosen reason without saving yet.
      const box = t.closest('[data-adj]'); const id = box.dataset.adj;
      const list = (S && S.data.Adjustments.some(a => a.id === id)) ? S.data.Adjustments : R.adjs;
      const a = list.find(x => x.id === id); const draft = { ...a, reason: t.value, clientPaid: '' };
      const tmp = document.createElement('div'); tmp.innerHTML = refundEditor(draft, S && list === S.data.Adjustments ? 'sale' : 'refunds');
      const keepText = box.querySelector('[data-adj-field="text"]').value;
      box.replaceWith(tmp.firstElementChild);
      document.querySelector(`[data-adj="${CSS.escape(id)}"] [data-adj-field="text"]`).value = keepText;
    }
  });

  app.addEventListener('submit', async e => {
    if (e.target.id !== 'fee-form') return;
    e.preventDefault();
    const isEst = S.data.Sales[0].type !== 'consignment';
    const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const fee = { id: `${S.id}-${Date.now().toString(36)}`, auctionId: S.id, payeeKey: isEst ? 'CLIENT' : val('fee-payee'), kind: feeKind,
      label: feeKind === 'other' ? val('fee-label') : FEE_FORM[feeKind].label, qty: val('fee-qty'), lotNo: val('fee-lot'), itemName: val('fee-item'),
      minimum: val('fee-min'), amount: val('fee-amt'), note: val('fee-note'), addedBy: me.name, addedAt: nowIso() };
    if (['sort', 'removal', 'access'].includes(feeKind) && !(Number(fee.qty) > 0)) return toast('Enter how many.', true);
    if (feeKind === 'reserve' && (!fee.lotNo || !(Number(fee.minimum) > 0))) return toast('Enter the lot number and the agreed minimum.', true);
    if (['cancel', 'other'].includes(feeKind) && !(Number(fee.amount) > 0)) return toast('Enter the amount.', true);
    if (feeKind === 'other' && !fee.label) return toast('Give the fee a name.', true);
    try { await save('Fees', [fee]); S.data.Fees.push(fee); toast('Added.'); rerender(); } catch (err) { toast(err.message, true); }
  });
  app.addEventListener('input', e => {
    if (e.target.id === 'lot-q') {
      lotFilter = e.target.value; const pos = e.target.selectionStart;
      const sec = e.target.closest('section'); sec.innerHTML = '<h2>Lots</h2>' + lotsHtml();
      const n = document.getElementById('lot-q'); n.focus(); n.setSelectionRange(pos, pos);
    }
  });

  route();
})();
