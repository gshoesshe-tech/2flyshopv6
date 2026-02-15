
/* app.js — Supplier Tracker (split files, hard-coded config in HTML) */
(function(){
  const $ = (id)=>document.getElementById(id);
  const authError = $('authError');
  const showErr = (t)=>{ if(!authError) return; authError.textContent=t||''; authError.classList.remove('hidden'); };
  const hideErr = ()=>{ if(!authError) return; authError.textContent=''; authError.classList.add('hidden'); };

  if (!window.supabase){ showErr('Supabase JS not loaded.'); return; }
  if (!window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__){
    showErr('Missing Supabase keys. Paste them in BOTH index.html + orderpage.html hard-coded config.');
    return;
  }

  const supa = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__);
  const BUCKET = window.__ATTACHMENTS_BUCKET__ || 'order_attachments';

  const userChip = $('userChip');
  const btnLogout = $('btnLogout');
  const btnRefresh = $('btnRefresh');
  const orderList = $('orderList');
  const countLabel = $('countLabel');

  const form = $('orderForm');
  const formTitle = $('formTitle');
  const formMsg = $('formMsg');
  const btnClear = $('btnClear');
  const btnSave = $('btnSave');

  const inputCustomer = $('customer_name');
  const inputFb = $('fb_profile');
  const inputDetails = $('order_details');
  const inputAttach = $('attachment');
  const inputStatus = $('status');
  const inputDate = $('order_date');
  const inputDelivery = $('delivery_method');
  const inputPaidProd = $('paid_product');
  const inputPaidShip = $('paid_shipping');
  const inputNotes = $('notes');
  const inputShipment = $('shipment_date');
  const inputRelease = $('release_date');
  const releaseWrap = document.getElementById('releaseWrap');

  const search = $('search');
  const statusFilter = $('statusFilter');
  const dateFilter = $('dateFilter');
  const tabs = document.querySelectorAll('#tabs .tab');

  const adminDash = $('adminOnlyDashboard');
  const kpiTotal = $('kpiTotal');
  const kpiPaid = $('kpiPaid');
  const kpiPending = $('kpiPending');

  let orders = [];
  let editingId = null;
  let activeTab = 'all';

  const money = (n)=>'₱'+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const fmtDMY = (iso)=>{
    const s = String(iso||'').trim();
    if (!s) return '';
    // expects YYYY-MM-DD
    const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
    if (!m) return s;
    return `${m[3]}-${m[2]}-${m[1]}`;
  };

  // ===== UI State (display-only) =====
  // Shipping is shown as numbers, but we label it as "2FLY" in the UI.
  let shippingHidden = false; // default: visible
  let toastTimer = null;

  function showToast(msg){
    let el = document.getElementById('toast');
    if (!el){
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{ el.classList.remove('show'); }, 1200);
  }

  async function copyToClipboard(text){
    const t = String(text||'');
    if (!t){ showToast('Nothing to copy'); return; }
    try{
      if (navigator.clipboard && window.isSecureContext){
        await navigator.clipboard.writeText(t);
      } else {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      showToast('Copied ✅');
    } catch(e){
      showToast('Copy failed');
    }
  }

  
  function normalizeFbUrl(v){
    const s = String(v||'').trim();
    if (!s) return '';
    // Already a full URL
    if (/^https?:\/\//i.test(s)) return s;
    // Starts with www.
    if (/^www\./i.test(s)) return 'https://' + s;
    // Looks like fb:// deep link - leave as is
    if (/^fb:\/\//i.test(s)) return s;
    // Username like @name
    if (s.startsWith('@')) return 'https://www.facebook.com/' + s.slice(1);
    // If it already contains facebook.com but no scheme
    if (/facebook\.com/i.test(s)) return 'https://' + s.replace(/^\/\/+/, '');
    // Otherwise treat as username/path
    return 'https://www.facebook.com/' + encodeURIComponent(s);
  }

async function ensureSession(){
    hideErr();
    const { data: { session }, error } = await supa.auth.getSession();
    if (error){ showErr(error.message); return null; }
    if (!session){ location.replace('./index.html'); return null; }

    const email = session.user?.email || 'Logged in';
    if (userChip) userChip.textContent = email;

    const allow = Array.isArray(window.__ADMIN_EMAILS__) ? window.__ADMIN_EMAILS__ : [];
    const isAdmin = allow.map(x=>String(x).toLowerCase()).includes(String(email).toLowerCase());
    if (adminDash) adminDash.classList.toggle('hidden', !isAdmin);

    return session;
  }

  async function logout(){
    await supa.auth.signOut();
    location.replace('./index.html');
  }

  function handleDeliveryChange(){
    if (!inputDelivery || !inputPaidShip) return;

    // Walk-in = no shipping fee
    if (inputDelivery.value === 'walkin'){
      inputPaidShip.value = '0';
      inputPaidShip.disabled = true;
    } else {
      inputPaidShip.disabled = false;
    }

    // Made-to-order: show Release Date field; otherwise hide + clear
    const isMTO = (inputDelivery.value === 'mto');
    if (releaseWrap) releaseWrap.classList.toggle('hidden', !isMTO);
    if (!isMTO && inputRelease) inputRelease.value = '';
  }

  function resetForm(){
    editingId = null;
    if (formTitle) formTitle.textContent = 'New Order';
    form.reset();
    if (inputStatus) inputStatus.value = 'pending';
    if (inputDelivery) inputDelivery.value = 'jnt';
    if (inputShipment) inputShipment.value = '';
    if (inputRelease) inputRelease.value = '';
    handleDeliveryChange();
    if (formMsg) formMsg.textContent = '—';
  }

  async function uploadAttachment(file){
    if (!file) return null;
    const ext = (file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');
    const path = `orders/${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
    const { error } = await supa.storage.from(BUCKET).upload(path, file, {
      cacheControl:'3600',
      upsert:false,
      contentType:file.type||'image/jpeg'
    });
    if (error) throw error;

    const { data } = supa.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || path;
  }

  async function loadOrders(){
    if (!await ensureSession()) return;

    const { data, error } = await supa
      .from('orders')
      .select('*')
      .order('order_date', { ascending:false })
      .order('id', { ascending:false });

    if (error){
      showErr('Failed to load orders: ' + (error.message||error));
      return;
    }

    orders = Array.isArray(data) ? data : [];
    rebuildDateOptions();
    render();
  }

  function rebuildDateOptions(){
    if (!dateFilter) return;
    const current = dateFilter.value || 'all';
    const set = new Set();
    for (const o of orders){ if (o.order_date) set.add(o.order_date); }
    const sorted = Array.from(set).sort((a,b)=>String(b).localeCompare(String(a)));
    dateFilter.innerHTML =
      '<option value="all">All Dates</option>' +
      sorted.map(d=>`<option value="${d}">${d}</option>`).join('');
    dateFilter.value = sorted.includes(current) ? current : 'all';
  }

  function filtered(){
    const q = (search?.value||'').trim().toLowerCase();
    const st = statusFilter?.value || 'all';
    const dt = dateFilter?.value || 'all';

    return orders.filter(o=>{
      if (activeTab !== 'all' && String(o.delivery_method||'').toLowerCase() !== activeTab) return false;
      if (st !== 'all' && String(o.status||'').toLowerCase() !== st) return false;
      if (dt !== 'all' && String(o.order_date||'') !== dt) return false;
      if (!q) return true;
      const hay = [o.order_id,o.customer_name,o.fb_profile,o.order_details,o.notes]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  
  function renderKPIs(){
    // KPI elements
    const el = (id)=>document.getElementById(id);

    if (el('kpiTotal')) el('kpiTotal').textContent = String(orders.length);

    const product = orders.reduce((a,o)=>a+Number(o.paid_product||0),0);
    const ship = orders.reduce((a,o)=>a+Number(o.paid_shipping||0),0);
    const total = product + ship;

    if (el('kpiProductRev')) el('kpiProductRev').textContent = money(product);
    if (el('kpiShipRev')) el('kpiShipRev').textContent = money(ship);
    if (el('kpiTotalRev')) el('kpiTotalRev').textContent = money(total);

    // Today metrics (based on order_date = YYYY-MM-DD)
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const todayOrders = orders.filter(o=>String(o.order_date||'')===today);

    const uniq = new Set(todayOrders.map(o=>String(o.customer_name||'').trim().toLowerCase()).filter(Boolean));
    const todayTotal = todayOrders.reduce((a,o)=>a+Number(o.paid_product||0)+Number(o.paid_shipping||0),0);

    if (el('kpiOrdersToday')) el('kpiOrdersToday').textContent = String(todayOrders.length);
    if (el('kpiCustomersToday')) el('kpiCustomersToday').textContent = String(uniq.size);
    if (el('kpiRevenueToday')) el('kpiRevenueToday').textContent = money(todayTotal);

    // Status counts
    const counts = orders.reduce((acc,o)=>{
      const s = String(o.status||'pending').toLowerCase();
      acc[s] = (acc[s]||0)+1;
      return acc;
    },{});
    const set = (id,val)=>{ const x=el(id); if(x) x.textContent = String(val||0); };
    set('stPending', counts.pending);
    set('stProcessing', counts.processing);
    set('stShipped', counts.shipped);
    set('stDelivered', counts.delivered);
    set('stCancelled', counts.cancelled || counts.cancel || counts.canceled);

    // Sales by day table
    const daysSelect = el('daysSelect');
    const daysLabel = el('daysLabel');
    const body = el('salesTableBody');
    if (!daysSelect || !daysLabel || !body) return;

    const days = Number(daysSelect.value || 7);
    daysLabel.textContent = String(days);

    const byDate = new Map();
    for (const o of orders){
      const key = o.order_date;
      if (!key) continue;
      if (!byDate.has(key)){
        byDate.set(key, { orders:0, customers:new Set(), prod:0, ship:0 });
      }
      const row = byDate.get(key);
      row.orders += 1;
      row.customers.add(String(o.customer_name||'').trim().toLowerCase());
      row.prod += Number(o.paid_product||0);
      row.ship += Number(o.paid_shipping||0);
    }

    const rows = [];
    const now = new Date();
    for (let i=0; i<days; i++){
      const dd = new Date(now);
      dd.setDate(now.getDate()-i);
      const key = `${dd.getFullYear()}-${String(dd.getMonth()+1).padStart(2,'0')}-${String(dd.getDate()).padStart(2,'0')}`;
      const rec = byDate.get(key) || { orders:0, customers:new Set(), prod:0, ship:0 };
      rows.push({
        date:key,
        orders:rec.orders,
        customers:rec.customers.size,
        prod:rec.prod,
        ship:rec.ship,
        total:rec.prod+rec.ship
      });
    }

    body.innerHTML = rows.map(r=>`
      <tr>
        <td style="padding:10px;border-bottom:1px solid rgba(35,48,85,.35)">${r.date}</td>
        <td style="padding:10px;text-align:right;border-bottom:1px solid rgba(35,48,85,.35)">${r.orders}</td>
        <td style="padding:10px;text-align:right;border-bottom:1px solid rgba(35,48,85,.35)">${r.customers}</td>
        <td style="padding:10px;text-align:right;border-bottom:1px solid rgba(35,48,85,.35)">${money(r.prod)}</td>
        <td style="padding:10px;text-align:right;border-bottom:1px solid rgba(35,48,85,.35)">${money(r.ship)}</td>
        <td style="padding:10px;text-align:right;border-bottom:1px solid rgba(35,48,85,.35)">${money(r.total)}</td>
      </tr>
    `).join('');
  }

  function render(){
    const list = filtered();
    if (countLabel) countLabel.textContent = `${list.length} order${list.length===1?'':'s'}`;
    renderKPIs();

    if (!orderList) return;
    orderList.innerHTML = '';

    for (const o of list){
      const li = document.createElement('li');
      li.className = 'item';

      const left = document.createElement('div');
      const title = document.createElement('div');
      title.className='titleLine';

      const name = document.createElement('div');
      name.style.fontWeight='800';
      name.textContent = o.customer_name || '(No name)';

      const pill = (t, extra)=>{
        const s=document.createElement('span');
        s.className='pill '+(extra||'');
        s.textContent=t; return s;
      };

      title.appendChild(name);
      title.appendChild(pill(String(o.status||'pending').toUpperCase()));
      title.appendChild(pill('🚚 '+String(o.delivery_method||'jnt').toUpperCase()));
      if (o.order_id) title.appendChild(pill(o.order_id,'accent'));

      const sub = document.createElement('div');
      sub.style.marginTop='6px';
      sub.style.color='var(--muted)';
      sub.style.fontSize='12px';
      sub.textContent = [
        o.order_date?('📅 '+o.order_date):'',
        '💰 '+money(Number(o.paid_product||0)+Number(o.paid_shipping||0)),
        ''
      ].filter(Boolean).join(' • ');

      left.appendChild(title);
      left.appendChild(sub);

      // ===== Dates (Shipment + MTO Release) =====
      const ship = (o.shipment_date || '').trim();
      const rel = (o.release_date || '').trim();
      if (ship || (String(o.delivery_method||'')==='mto' && rel)){
        const dates = document.createElement('div');
        dates.style.marginTop = '8px';
        dates.style.fontSize = '12px';
        dates.style.lineHeight = '1.45';

        if (String(o.delivery_method||'')==='mto' && rel){
          const r = document.createElement('div');
          r.style.fontWeight = '900';
          r.style.letterSpacing = '.2px';
          r.textContent = `RELEASE DATE : ${fmtDMY(rel)}`;
          dates.appendChild(r);
        }
        if (ship){
          const s = document.createElement('div');
          s.style.color = 'var(--muted)';
          s.textContent = `SHIPMENT DATE : ${fmtDMY(ship)}`;
          dates.appendChild(s);
        }
        left.appendChild(dates);
      }

      // ===== Expandable Order Details =====
      const raw = (o.order_details || '').trim();

      const preview = document.createElement('div');
      preview.className = 'details-preview';
      preview.textContent = raw ? '🧾 Order form hidden — click Expand to view.' : '';

      const full = document.createElement('div');
      full.className = 'details-full';
      const pre = document.createElement('pre');
      pre.textContent = raw;
      full.appendChild(pre);

      if (raw){
        left.appendChild(preview);
        left.appendChild(full);
      }

      // ===== Private Notes (preview + toggle) =====
      const notesRaw = (o.notes || '').trim();
      if (notesRaw){
        const nb = document.createElement('div');
        nb.className = 'notes-box';

        const nh = document.createElement('div');
        nh.className = 'notes-hd';

        const nl = document.createElement('div');
        nl.className = 'notes-lbl';
        nl.textContent = 'Private Notes';

        const nbtn = document.createElement('button');
        nbtn.className = 'btn small';
        nbtn.type = 'button';
        nbtn.textContent = 'Show notes';

        nh.appendChild(nl);
        nh.appendChild(nbtn);

        const nt = document.createElement('div');
        nt.className = 'notes-txt clamp';
        nt.textContent = notesRaw;

        let openNotes = false;
        nbtn.onclick = ()=>{
          openNotes = !openNotes;
          nt.classList.toggle('clamp', !openNotes);
          nbtn.textContent = openNotes ? 'Hide notes' : 'Show notes';
        };

        nb.appendChild(nh);
        nb.appendChild(nt);
        left.appendChild(nb);
      }


const right = document.createElement('div');
      right.style.display='flex';
      right.style.gap='8px';
      right.style.flexWrap='wrap';
      right.style.justifyContent='flex-end';

      

      // ===== Quick Status Update (no need to Edit) =====
      const status = String(o.status||'pending').toLowerCase();
      const addQuick = (label, next, cls)=>{
        const b = document.createElement('button');
        b.className = 'btn small' + (cls ? (' ' + cls) : '');
        b.type = 'button';
        b.textContent = label;
        b.onclick = ()=>quickSetStatus(o, next);
        right.appendChild(b);
      };

      if (status === 'pending'){
        addQuick('Mark as Processing', 'processing', 'primary');
        addQuick('Mark as Shipped', 'shipped', '');
      } else if (status === 'processing'){
        addQuick('Mark as Shipped', 'shipped', 'primary');
      } else if (status === 'shipped'){
        addQuick('Mark as Delivered', 'delivered', 'primary');
      }

      // Expand / Collapse button (shows full order form)

      
      // Facebook Profile button (opens fb_profile)
      if ((o.fb_profile || '').trim()){
        const fb = document.createElement('a');
        fb.className = 'btn small';
        fb.href = normalizeFbUrl(o.fb_profile);
        fb.target = '_blank';
        fb.rel = 'noopener';
        fb.textContent = 'FB Profile';
        right.appendChild(fb);
      }

// Copy Order Details (always copies raw order_details)
      if ((o.order_details || '').trim()){
        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn small';
        copyBtn.type = 'button';
        copyBtn.textContent = 'Copy Order Details';
        copyBtn.onclick = ()=>copyToClipboard(raw);
        right.appendChild(copyBtn);
      }

      if ((o.order_details || '').trim()){
        const toggle = document.createElement('button');
        toggle.className = 'btn small';
        toggle.type = 'button';
        toggle.textContent = 'Expand';
        toggle.onclick = ()=>{
          const open = !full.classList.contains('show');
          full.classList.toggle('show', open);
          toggle.textContent = open ? 'Collapse' : 'Expand';
          if (open) full.scrollIntoView({ block:'nearest', behavior:'smooth' });
        };
        right.appendChild(toggle);
      }

if (o.attachment_url){
        const a=document.createElement('a');
        a.className='btn';
        a.href=o.attachment_url;
        a.target='_blank';
        a.rel='noopener';
        a.textContent='View';
        right.appendChild(a);
      }

      const edit=document.createElement('button');
      edit.className='btn';
      edit.type='button';
      edit.textContent='Edit';
      edit.onclick=()=>startEdit(o);
      right.appendChild(edit);

      const del=document.createElement('button');
      del.className='btn danger';
      del.type='button';
      del.textContent='Delete';
      del.onclick=()=>deleteOrder(o);
      right.appendChild(del);

      li.appendChild(left);
      li.appendChild(right);
      orderList.appendChild(li);
    }
  }


  async function quickSetStatus(o, nextStatus){
    try{
      if (!await ensureSession()) return;
      const { error } = await supa.from('orders').update({ status: nextStatus }).eq('id', o.id);
      if (error) throw error;
      showToast(`Status → ${String(nextStatus).toUpperCase()} ✅`);
      // Keep sorting stable: reload orders ordered by order_date + id (no "updated_at" sorting)
      await loadOrders();
    } catch(e){
      showErr(e?.message || String(e));
      showToast('Update failed');
    }
  }

  function startEdit(o){
    editingId = o.id;
    if (formTitle) formTitle.textContent = `Edit Order (${o.order_id || o.id})`;
    inputCustomer.value = o.customer_name || '';
    inputFb.value = o.fb_profile || '';
    inputDetails.value = o.order_details || '';
    inputStatus.value = o.status || 'pending';
    inputDate.value = o.order_date || '';
    inputDelivery.value = (o.delivery_method || 'jnt');
    inputPaidProd.value = String(o.paid_product ?? '');
    inputPaidShip.value = String(o.paid_shipping ?? '');
    inputNotes.value = o.notes || '';
    if (inputShipment) inputShipment.value = o.shipment_date || '';
    if (inputRelease) inputRelease.value = o.release_date || '';
    handleDeliveryChange();
  }

  async function deleteOrder(o){
    if (!confirm(`Delete order ${o.order_id || o.id}?`)) return;
    const { error } = await supa.from('orders').delete().eq('id', o.id);
    if (error){ alert(error.message || 'Delete failed'); return; }
    await loadOrders();
    resetForm();
  }

  async function saveOrder(ev){
    ev.preventDefault();
    if (formMsg) formMsg.textContent = 'Saving…';
    btnSave.disabled = true;

    try{
      if (!await ensureSession()) return;

      const payload = {
        customer_name: inputCustomer.value.trim(),
        fb_profile: inputFb.value.trim() || null,
        order_details: inputDetails.value.trim(),
        paid_product: Number(inputPaidProd.value || 0),
        paid_shipping: Number(inputPaidShip.value || 0),
        status: inputStatus.value,
        order_date: inputDate.value || null,
        notes: inputNotes.value.trim() || null,
        delivery_method: inputDelivery.value,
        shipment_date: inputShipment?.value || null,
        release_date: inputRelease?.value || null
      };

      if (payload.delivery_method === 'walkin') payload.paid_shipping = 0;
      if (payload.delivery_method !== 'mto') payload.release_date = null;

      const file = inputAttach?.files?.[0] || null;
      if (file){ payload.attachment_url = await uploadAttachment(file); }

      let error;
      if (editingId){
        ({ error } = await supa.from('orders').update(payload).eq('id', editingId));
      } else {
        ({ error } = await supa.from('orders').insert(payload));
      }

      if (error) throw error;

      if (formMsg) formMsg.textContent = 'Saved ✅';
      await loadOrders();
      resetForm();
    } catch(e){
      showErr(e?.message || String(e));
      if (formMsg) formMsg.textContent = 'Save failed';
    } finally {
      btnSave.disabled = false;
      if (inputAttach) inputAttach.value = '';
    }
  }

  function setActiveTab(val){
    activeTab = val;
    tabs.forEach(t=>t.classList.toggle('active', t.dataset.tab === val));
    render();
  }

  async function init(){
    if (!await ensureSession()) return;

    if (btnLogout) btnLogout.addEventListener('click', logout);
    if (btnRefresh) btnRefresh.addEventListener('click', loadOrders);
    if (btnClear) btnClear.addEventListener('click', resetForm);
    if (form) form.addEventListener('submit', saveOrder);

    if (inputDelivery) inputDelivery.addEventListener('change', handleDeliveryChange);
    handleDeliveryChange();

    if (search) search.addEventListener('input', render);
    if (statusFilter) statusFilter.addEventListener('change', render);
    if (dateFilter) dateFilter.addEventListener('change', render);

    
    const daysSelect = document.getElementById('daysSelect');
    if (daysSelect) daysSelect.addEventListener('change', render);

    // Hide shipping numbers by default (dashboard + sales table). Toggle via button.
    const btnToggleShipping = document.getElementById('btnToggleShipping');
    if (btnToggleShipping){
      const sync = ()=>{ btnToggleShipping.textContent = shippingHidden ? 'Show 2FLY' : 'Hide 2FLY'; };
      sync();
      btnToggleShipping.addEventListener('click', ()=>{
        if (shippingHidden){
          const ok = confirm('Reveal 2FLY numbers? This will show 2FLY collected on screen.');
          if (!ok) return;
          shippingHidden = false;
        } else {
          shippingHidden = true;
        }
        sync();
        render();
      });
    }

tabs.forEach(t=>t.addEventListener('click', ()=>setActiveTab(t.dataset.tab)));

    supa.auth.onAuthStateChange((event)=>{
      if (event==='SIGNED_OUT') location.replace('./index.html');
    });

    await loadOrders();
    resetForm();
  }

  init();
})();
