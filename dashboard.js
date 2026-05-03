/* dashboard.js — Separate Business Dashboard for Supplier Tracker */
(function(){
  const $ = (id)=>document.getElementById(id);
  const authError = $('authError');
  const showErr = (t)=>{ if(!authError) return; authError.textContent=t||''; authError.style.display=t?'block':'none'; };
  if (!window.supabase){ showErr('Supabase JS not loaded.'); return; }
  if (!window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__){ showErr('Missing Supabase keys.'); return; }

  const supa = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__);
  const money = (n)=>'₱'+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const pct = (n)=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:1})+'%';
  const todayKey = ()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const dateKey = (d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  let orders = [];


  function csvEscape(v){
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadTextFile(filename, content, type){
    const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function exportRows(list){
    return (Array.isArray(list) ? list : []).map(o=>{
      const paidProduct = Number(o.paid_product || 0);
      const paidShipping = Number(o.paid_shipping || 0);
      const productCost = Number(o.product_cost || 0);
      const cash = paidProduct + paidShipping;
      return {
        order_id: o.order_id || '',
        customer_name: o.customer_name || '',
        fb_profile: o.fb_profile || '',
        order_date: o.order_date || '',
        status: o.status || '',
        delivery_method: o.delivery_method || '',
        shipment_date: o.shipment_date || '',
        release_date: o.release_date || '',
        paid_product: paidProduct,
        paid_shipping: paidShipping,
        product_cost: productCost,
        cash_collected: cash,
        estimated_profit: cash - productCost,
        remaining_balance: Number(o.remaining_balance || 0),
        notes: o.notes || '',
        order_details: o.order_details || ''
      };
    });
  }
  function exportCSV(list, prefix){
    const rows = exportRows(list);
    const headers = ['order_id','customer_name','fb_profile','order_date','status','delivery_method','shipment_date','release_date','paid_product','paid_shipping','product_cost','cash_collected','estimated_profit','remaining_balance','notes','order_details'];
    const csv = [headers.join(','), ...rows.map(r=>headers.map(h=>csvEscape(r[h])).join(','))].join('\n');
    const stamp = new Date().toISOString().slice(0,10);
    downloadTextFile(`${prefix}_${stamp}.csv`, csv, 'text/csv;charset=utf-8');
  }
  function exportJSON(list, prefix){
    const stamp = new Date().toISOString().slice(0,10);
    downloadTextFile(`${prefix}_${stamp}.json`, JSON.stringify(exportRows(list), null, 2), 'application/json;charset=utf-8');
  }


  function getNumber(o, key){ return Number(o?.[key] || 0); }
  function collected(o){ return getNumber(o,'paid_product') + getNumber(o,'paid_shipping'); }
  function cost(o){ return getNumber(o,'product_cost'); }
  function profit(o){ return collected(o) - cost(o); }

  async function ensureSession(){
    showErr('');
    const { data:{session}, error } = await supa.auth.getSession();
    if (error){ showErr(error.message); return null; }
    if (!session){ location.replace('./index.html'); return null; }
    const email = session.user?.email || 'Logged in';
    if ($('userChip')) $('userChip').textContent = email;
    const allow = Array.isArray(window.__ADMIN_EMAILS__) ? window.__ADMIN_EMAILS__ : [];
    const isAdmin = allow.map(x=>String(x).toLowerCase()).includes(String(email).toLowerCase());
    if (!isAdmin){ showErr('This dashboard is admin-only.'); return null; }
    return session;
  }

  function filterOrders(){
    const range = $('rangeSelect')?.value || '7';
    const status = $('statusSelect')?.value || 'all';
    const now = new Date();
    let min = null;
    if (range === 'today') min = todayKey();
    else if (range !== 'all') { const d = new Date(now); d.setDate(now.getDate() - (Number(range)-1)); min = dateKey(d); }
    return orders.filter(o=>{
      const od = String(o.order_date || '');
      if (min && od < min) return false;
      if (status !== 'all' && String(o.status||'').toLowerCase() !== status) return false;
      return true;
    });
  }

  function setText(id, val){ const el=$(id); if (el) el.textContent = val; }

  function render(){
    const list = filterOrders();
    const product = list.reduce((a,o)=>a+getNumber(o,'paid_product'),0);
    const fee = list.reduce((a,o)=>a+getNumber(o,'paid_shipping'),0);
    const cash = product + fee;
    const cogs = list.reduce((a,o)=>a+cost(o),0);
    const prof = cash - cogs;
    const aov = list.length ? cash / list.length : 0;
    const margin = cash ? (prof / cash) * 100 : 0;

    setText('kpiCash', money(cash));
    setText('kpiProfit', money(prof));
    setText('kpiOrders', String(list.length));
    setText('kpiAov', money(aov));
    setText('kpiProduct', money(product));
    setText('kpiFee', money(fee));
    setText('kpiCost', money(cogs));
    setText('kpiMargin', pct(margin));

    const range = $('rangeSelect')?.value || '7';
    const label = range === 'today' ? 'Today' : range === 'all' ? 'All time' : `Last ${range} days`;
    setText('rangeLabel', label);

    renderDaily(list);
    renderStatus(list);
    renderTopOrders(list);
  }

  function renderDaily(list){
    const body = $('dailyBody'); if (!body) return;
    const map = new Map();
    for (const o of list){
      const key = o.order_date || 'No date';
      if (!map.has(key)) map.set(key,{orders:0,cash:0,cost:0,profit:0});
      const r = map.get(key);
      r.orders += 1; r.cash += collected(o); r.cost += cost(o); r.profit += profit(o);
    }
    const rows = Array.from(map.entries()).sort((a,b)=>String(b[0]).localeCompare(String(a[0])));
    body.innerHTML = rows.length ? rows.map(([date,r])=>`
      <tr><td>${date}</td><td class="right">${r.orders}</td><td class="right">${money(r.cash)}</td><td class="right">${money(r.cost)}</td><td class="right">${money(r.profit)}</td></tr>
    `).join('') : '<tr><td colspan="5">No orders found for this filter.</td></tr>';
  }

  function renderStatus(list){
    const body = $('statusBody'); if (!body) return;
    const total = list.length || 1;
    const statuses = ['pending','processing','shipped','delivered','cancelled'];
    const counts = list.reduce((a,o)=>{ const s=String(o.status||'pending').toLowerCase(); a[s]=(a[s]||0)+1; return a; },{});
    body.innerHTML = statuses.map(s=>{
      const n = counts[s] || 0;
      const w = Math.round((n/total)*100);
      return `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;gap:10px"><strong>${s.toUpperCase()}</strong><span class="chip">${n}</span></div><div class="bar"><div class="fill" style="width:${w}%"></div></div></div>`;
    }).join('');
  }

  function renderTopOrders(list){
    const body = $('topOrdersBody'); if (!body) return;
    const rows = [...list].sort((a,b)=>collected(b)-collected(a)).slice(0,12);
    body.innerHTML = rows.length ? rows.map(o=>`
      <tr>
        <td>${o.customer_name || '(No name)'}</td><td>${String(o.status||'pending').toUpperCase()}</td><td>${String(o.delivery_method||'jnt').toUpperCase()}</td>
        <td class="right">${money(collected(o))}</td><td class="right">${money(cost(o))}</td><td class="right">${money(profit(o))}</td>
      </tr>
    `).join('') : '<tr><td colspan="6">No orders found for this filter.</td></tr>';
  }

  async function loadOrders(){
    if (!await ensureSession()) return;
    const { data, error } = await supa.from('orders').select('*').order('order_date',{ascending:false}).order('id',{ascending:false});
    if (error){ showErr('Failed to load orders: '+(error.message||error)); return; }
    orders = Array.isArray(data) ? data : [];
    render();
  }

  async function logout(){ await supa.auth.signOut(); location.replace('./index.html'); }
  function init(){
    $('btnLogout')?.addEventListener('click', logout);
    $('btnRefresh')?.addEventListener('click', loadOrders);
    $('btnExportCsvDash')?.addEventListener('click', ()=>exportCSV(filterOrders(), '2fly_dashboard_filtered_backup'));
    $('btnExportJsonDash')?.addEventListener('click', ()=>exportJSON(filterOrders(), '2fly_dashboard_filtered_backup'));
    $('rangeSelect')?.addEventListener('change', render);
    $('statusSelect')?.addEventListener('change', render);
    supa.auth.onAuthStateChange((event)=>{ if (event==='SIGNED_OUT') location.replace('./index.html'); });
    loadOrders();
  }
  init();
})();
