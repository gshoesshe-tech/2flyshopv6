
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
  const inputShipment = $('shipment_date');
  const inputRelease = $('release_date');
  const releaseWrap = $('releaseWrap');
  const inputBalance = $('remaining_balance');
  const balanceWrap = $('balanceWrap');
  const inputPaidProd = $('paid_product');
  const inputPaidShip = $('paid_shipping');
  const inputProductCost = $('product_cost');
  const inputNotes = $('notes');
  const inputParcelType = $('parcel_type');
  const inputItemsCount = $('items_count');
  const inputCourierCost = $('courier_cost');
  const inputTrackingNumber = $('tracking_number');
  const inputPackedBy = $('packed_by');
  const inputReleasedBy = $('released_by');

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
  let currentUserEmail = '';
  const OWNER_EMAILS = Array.isArray(window.__OWNER_EMAILS__) ? window.__OWNER_EMAILS__.map(x=>String(x).toLowerCase()) : ['gshoeswho@gmail.com'];
  const STAFF_OPTIONS = ['MYRA','VICTOR','BENZ','MARIAN'];
  const STATUS_OPTIONS = ['pending','processing','shipped','delivered','cancelled'];
  const canDeleteOrders = ()=>OWNER_EMAILS.includes(String(currentUserEmail || '').toLowerCase());

  const money = (n)=>'₱'+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2});

  const fmtDMY = (s)=>{
    const v = String(s||'').trim();
    if (!v) return '';
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return v;
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


  // ===== Backup / Export Helpers =====
  const GOOGLE_SHEETS_WEB_APP_URL = String(window.__GOOGLE_SHEETS_WEB_APP_URL__ || '').trim();

  function csvEscape(v){
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function getOrderExportRows(list){
    return (Array.isArray(list) ? list : []).map(o=>{
      const paidProduct = Number(o.paid_product || 0);
      const paidShipping = Number(o.paid_shipping || 0);
      const productCost = Number(o.product_cost || 0);
      const cashCollected = paidProduct + paidShipping;
      const estimatedProfit = cashCollected - productCost;
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
        cash_collected: cashCollected,
        estimated_profit: estimatedProfit,
        remaining_balance: Number(o.remaining_balance || 0),
        encoded_by: o.encoded_by || '',
        parcel_type: o.parcel_type || '',
        items_count: Number(o.items_count || 0),
        courier_cost: Number(o.courier_cost || 0),
        shipping_profit: Number(o.paid_shipping || 0) - Number(o.courier_cost || 0),
        tracking_number: o.tracking_number || '',
        packed_by: o.packed_by || '',
        released_by: o.released_by || '',
        high_value: ((Number(o.paid_product || 0) + Number(o.paid_shipping || 0)) >= 1000 ? 'YES' : 'NO'),
        notes: o.notes || '',
        order_details: o.order_details || ''
      };
    });
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

  function exportOrdersCSV(list, filenamePrefix){
    const rows = getOrderExportRows(list);
    const headers = [
      'order_id','customer_name','fb_profile','order_date','status','delivery_method',
      'shipment_date','release_date','paid_product','paid_shipping','product_cost',
      'cash_collected','estimated_profit','remaining_balance','encoded_by','parcel_type','items_count','courier_cost','shipping_profit','tracking_number','packed_by','released_by','high_value','notes','order_details'
    ];
    const csv = [
      headers.join(','),
      ...rows.map(r=>headers.map(h=>csvEscape(r[h])).join(','))
    ].join('\n');
    const stamp = new Date().toISOString().slice(0,10);
    downloadTextFile(`${filenamePrefix || '2fly_orders'}_${stamp}.csv`, csv, 'text/csv;charset=utf-8');
    showToast('CSV exported ✅');
  }

  function exportOrdersJSON(list, filenamePrefix){
    const rows = getOrderExportRows(list);
    const stamp = new Date().toISOString().slice(0,10);
    downloadTextFile(`${filenamePrefix || '2fly_orders'}_${stamp}.json`, JSON.stringify(rows, null, 2), 'application/json;charset=utf-8');
    showToast('JSON exported ✅');
  }

  async function syncOrderToGoogleSheet(savedOrder, action){
    if (!GOOGLE_SHEETS_WEB_APP_URL) return;
    try{
      const paidProduct = Number(savedOrder.paid_product || 0);
      const paidShipping = Number(savedOrder.paid_shipping || 0);
      const productCost = Number(savedOrder.product_cost || 0);
      await fetch(GOOGLE_SHEETS_WEB_APP_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: action || 'save',
          id: savedOrder.id || '',
          order_id: savedOrder.order_id || '',
          customer_name: savedOrder.customer_name || '',
          order_date: savedOrder.order_date || '',
          product_sales: paidProduct,
          shipping_fee: paidShipping,
          product_cost: productCost,
          cash_collected: paidProduct + paidShipping,
          profit: (paidProduct + paidShipping) - productCost,
          status: savedOrder.status || '',
          delivery_method: savedOrder.delivery_method || '',
          shipment_date: savedOrder.shipment_date || '',
          release_date: savedOrder.release_date || '',
          remaining_balance: Number(savedOrder.remaining_balance || 0),
          notes: savedOrder.notes || '',
          order_details: savedOrder.order_details || '',
          encoded_by: savedOrder.encoded_by || currentUserEmail || '',
          parcel_type: savedOrder.parcel_type || '',
          items_count: Number(savedOrder.items_count || 0),
          courier_cost: Number(savedOrder.courier_cost || 0),
          shipping_profit: Number(savedOrder.paid_shipping || 0) - Number(savedOrder.courier_cost || 0),
          tracking_number: savedOrder.tracking_number || '',
          packed_by: savedOrder.packed_by || '',
          released_by: savedOrder.released_by || '',
          high_value: ((paidProduct + paidShipping) >= 1000 ? 'YES' : 'NO'),
          updated_at: new Date().toISOString()
        })
      });
    } catch(e){
      console.warn('Google Sheets backup failed:', e);
      showToast('Saved, but Sheets backup failed');
    }
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
    currentUserEmail = session.user?.email || '';
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

    // Walk-in: shipping/2FLY fee forced to 0
    if (inputDelivery.value === 'walkin'){
      inputPaidShip.value = '0';
      inputPaidShip.disabled = true;
    } else {
      inputPaidShip.disabled = false;
    }

    // Release date only for Made to Order
    const isMTO = inputDelivery.value === 'mto';
    if (releaseWrap) releaseWrap.classList.toggle('hidden', !isMTO);
    if (!isMTO && inputRelease) inputRelease.value = '';
    if (balanceWrap) balanceWrap.classList.toggle('hidden', !isMTO);
    if (!isMTO && inputBalance) inputBalance.value = '';
  }

  function resetForm(){
    editingId = null;
    if (formTitle) formTitle.textContent = 'New Order';
    form.reset();
    if (inputShipment) inputShipment.value = '';
    if (inputRelease) inputRelease.value = '';
    if (inputBalance) inputBalance.value = '';
    if (inputParcelType) inputParcelType.value = '';
    if (inputItemsCount) inputItemsCount.value = '';
    if (inputCourierCost) inputCourierCost.value = '';
    if (inputTrackingNumber) inputTrackingNumber.value = '';
    if (inputPackedBy) inputPackedBy.value = '';
    if (inputReleasedBy) inputReleasedBy.value = '';
    if (inputStatus) inputStatus.value = 'pending';
    if (inputProductCost) inputProductCost.value = '';
    if (inputDelivery) inputDelivery.value = 'jnt';
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


  async function fetchAllOrders(){
    const pageSize = 1000;
    let from = 0;
    let all = [];

    while (true){
      const { data, error } = await supa
        .from('orders')
        .select('*')
        .order('order_date', { ascending:false })
        .order('id', { ascending:false })
        .range(from, from + pageSize - 1);

      if (error) throw error;

      const batch = Array.isArray(data) ? data : [];
      all = all.concat(batch);

      if (batch.length < pageSize) break;
      from += pageSize;
    }

    return all;
  }

  async function loadOrders(){
    if (!await ensureSession()) return;

    try{
      orders = await fetchAllOrders();
    } catch(error){
      showErr('Failed to load orders: ' + (error.message||error));
      return;
    }
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
      title.appendChild(pill('🚚 '+(String(o.delivery_method||'jnt').toLowerCase()==='mto' ? 'MADE TO ORDER' : String(o.delivery_method||'jnt').toUpperCase())));
      if (o.order_id) title.appendChild(pill(o.order_id,'accent'));
      if (o.parcel_type) title.appendChild(pill('📦 '+String(o.parcel_type)));
      if (o.tracking_number) title.appendChild(pill('TN: '+String(o.tracking_number)));

      // Dates (bold) — Shipment Date for all methods, Release Date only for MTO
      const dateBlock = document.createElement('div');
      dateBlock.className = 'dateBlock';

      const isMTO = String(o.delivery_method||'').toLowerCase() === 'mto';
      const rel = (o.release_date||'');
      const shipAt = (o.shipment_date||'');

      if (isMTO && rel){
        const line = document.createElement('div');
        line.className = 'dateLine release';
        line.innerHTML = `<span class="label">RELEASE DATE :</span><span class="val">${fmtDMY(rel)}</span>`;
        dateBlock.appendChild(line);
      }
      if (shipAt){
        const line = document.createElement('div');
        line.className = 'dateLine';
        line.innerHTML = `<span class="label">SHIPMENT DATE :</span><span class="val">${fmtDMY(shipAt)}</span>`;
        dateBlock.appendChild(line);
      }

      const bal = Number(o.remaining_balance || 0);
      if (isMTO && bal > 0){
        const line = document.createElement('div');
        line.className = 'dateLine balance';
        line.innerHTML = `<span class="label">BALANCE :</span><span class="val">${money(bal)}</span>`;
        dateBlock.appendChild(line);
      }

      if (dateBlock.childNodes.length){
        left.appendChild(dateBlock);
      }

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

      // Quick action panels (no need to Edit)
      const st = String(o.status||'pending').toLowerCase();

      const quickPanel = document.createElement('div');
      quickPanel.className = 'quick-group';

      const statusTitle = document.createElement('div');
      statusTitle.className = 'quick-title';
      statusTitle.innerHTML = '<span>Status</span><span>Current: '+String(o.status||'pending').toUpperCase()+'</span>';
      quickPanel.appendChild(statusTitle);

      const statusRow = document.createElement('div');
      statusRow.className = 'quick-row';
      STATUS_OPTIONS.forEach(s=>{
        const b=document.createElement('button');
        b.className = 'btn small' + (st===s ? ' activeQuick' : '');
        b.type='button';
        b.textContent = s.charAt(0).toUpperCase()+s.slice(1);
        b.onclick = ()=>quickUpdateStatus(o, s);
        statusRow.appendChild(b);
      });
      quickPanel.appendChild(statusRow);

      const packedTitle = document.createElement('div');
      packedTitle.className = 'quick-title';
      packedTitle.style.marginTop = '10px';
      packedTitle.innerHTML = '<span>Packed By</span><span>Current: '+(o.packed_by || '—')+'</span>';
      quickPanel.appendChild(packedTitle);

      const packedRow = document.createElement('div');
      packedRow.className = 'quick-row';
      STAFF_OPTIONS.forEach(name=>{
        const b=document.createElement('button');
        b.className = 'btn small' + (String(o.packed_by||'').toUpperCase()===name ? ' activeQuick' : '');
        b.type='button';
        b.textContent = name;
        b.onclick = ()=>quickUpdateField(o, { packed_by: name });
        packedRow.appendChild(b);
      });
      quickPanel.appendChild(packedRow);

      const releasedTitle = document.createElement('div');
      releasedTitle.className = 'quick-title';
      releasedTitle.style.marginTop = '10px';
      releasedTitle.innerHTML = '<span>Released By</span><span>Current: '+(o.released_by || '—')+'</span>';
      quickPanel.appendChild(releasedTitle);

      const releasedRow = document.createElement('div');
      releasedRow.className = 'quick-row';
      STAFF_OPTIONS.forEach(name=>{
        const b=document.createElement('button');
        b.className = 'btn small' + (String(o.released_by||'').toUpperCase()===name ? ' activeQuick' : '');
        b.type='button';
        b.textContent = name;
        b.onclick = ()=>quickUpdateField(o, { released_by: name });
        releasedRow.appendChild(b);
      });
      quickPanel.appendChild(releasedRow);

      const encodedLine = document.createElement('div');
      encodedLine.style.marginTop='10px';
      encodedLine.style.color='var(--muted)';
      encodedLine.style.fontSize='12px';
      encodedLine.textContent = 'Encoded by: ' + (o.encoded_by || '—');
      quickPanel.appendChild(encodedLine);

      left.appendChild(quickPanel);



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

      if (canDeleteOrders()){
        const del=document.createElement('button');
        del.className='btn danger';
        del.type='button';
        del.textContent='Delete';
        del.onclick=()=>deleteOrder(o);
        right.appendChild(del);
      }

      li.appendChild(left);
      li.appendChild(right);
      orderList.appendChild(li);
    }
  }

  async function quickUpdateStatus(o, newStatus){
    return quickUpdateField(o, { status: newStatus });
  }

  async function quickUpdateField(o, patch){
    try{
      if (!o || !o.id) return;
      if (!await ensureSession()) return;

      const payload = {
        ...patch
      };

      const { data, error } = await supa
        .from('orders')
        .update(payload)
        .eq('id', o.id)
        .select('*')
        .single();

      if (error) throw error;

      if (data) await syncOrderToGoogleSheet(data, 'quick_update');
      showToast('Updated ✅');
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
    if (inputProductCost) inputProductCost.value = String(o.product_cost ?? '');
    inputNotes.value = o.notes || '';
    if (inputShipment) inputShipment.value = o.shipment_date || '';
    if (inputRelease) inputRelease.value = o.release_date || '';
    if (inputBalance) inputBalance.value = (o.remaining_balance ?? '') === null ? '' : String(o.remaining_balance ?? '');
    handleDeliveryChange();
  }

  async function deleteOrder(o){
    if (!canDeleteOrders()){
      alert('Only the owner account can delete orders.');
      return;
    }
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
        product_cost: Number(inputProductCost?.value || 0),
        encoded_by: currentUserEmail || null,
        parcel_type: inputParcelType?.value || null,
        items_count: inputItemsCount?.value === '' ? null : Number(inputItemsCount?.value || 0),
        courier_cost: inputCourierCost?.value === '' ? null : Number(inputCourierCost?.value || 0),
        tracking_number: inputTrackingNumber?.value.trim() || null,
        packed_by: inputPackedBy?.value || null,
        released_by: inputReleasedBy?.value || null,
        status: inputStatus.value,
        order_date: inputDate.value || null,
        notes: inputNotes.value.trim() || null,
        delivery_method: inputDelivery.value,
        shipment_date: inputShipment?.value || null,
        release_date: (inputDelivery.value === 'mto' ? (inputRelease?.value || null) : null),
        remaining_balance: (inputDelivery.value === 'mto' ? (inputBalance?.value === '' ? null : Number(inputBalance?.value || 0)) : null)
      };

      if (payload.delivery_method === 'walkin') payload.paid_shipping = 0;

      const file = inputAttach?.files?.[0] || null;
      if (file){ payload.attachment_url = await uploadAttachment(file); }

      let error, data;
      if (editingId){
        ({ data, error } = await supa.from('orders').update(payload).eq('id', editingId).select('*').single());
      } else {
        ({ data, error } = await supa.from('orders').insert(payload).select('*').single());
      }

      if (error){
        if (String(error.message||'').includes('product_cost')){
          throw new Error('Missing database column: product_cost. Run the SQL schema update included with these files, then save again.');
        }
        throw error;
      }

      if (data) await syncOrderToGoogleSheet(data, editingId ? 'update' : 'insert');

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
    document.getElementById('btnExportCsvOrders')?.addEventListener('click', ()=>exportOrdersCSV(orders, '2fly_orders_full_backup'));
    document.getElementById('btnExportJsonOrders')?.addEventListener('click', ()=>exportOrdersJSON(orders, '2fly_orders_full_backup'));
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
