
/* 2FLY rebuilt app.js — orders + inventory + dashboard */
(function () {
  const $ = (id) => document.getElementById(id);
  const page = document.body.dataset.page || "orders";
  const authError = $("authError");
  const showErr = (t) => { if (authError) { authError.textContent = t || ""; authError.classList.remove("hidden"); } };
  const hideErr = () => { if (authError) { authError.textContent = ""; authError.classList.add("hidden"); } };

  if (!window.supabase) { showErr("Supabase JS not loaded."); return; }
  if (!window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__) { showErr("Missing Supabase keys."); return; }

  const supa = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__);
  const BUCKET = window.__ATTACHMENTS_BUCKET__ || "order_attachments";

  const money = (n) => '₱' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const todayYmd = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  async function ensureSession() {
    hideErr();
    const { data: { session }, error } = await supa.auth.getSession();
    if (error) { showErr(error.message); return null; }
    if (!session) { location.replace('./index.html'); return null; }
    const chip = $("userChip");
    if (chip) chip.textContent = session.user?.email || "Logged in";
    return session;
  }

  async function logout() {
    await supa.auth.signOut();
    location.replace('./index.html');
  }

  async function getCurrentUserEmail() {
    const { data: { session } } = await supa.auth.getSession();
    return session?.user?.email || null;
  }

  async function uploadAttachment(file) {
    if (!file) return null;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `orders/${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
    const { error } = await supa.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'image/jpeg'
    });
    if (error) throw error;
    const { data } = supa.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || path;
  }

  async function logActivity(entityType, entityId, action, description) {
    const userEmail = await getCurrentUserEmail();
    await supa.from('activity_logs').insert({
      entity_type: entityType,
      entity_id: String(entityId || ''),
      action,
      description: description || null,
      user_email: userEmail
    });
  }

  async function loadInventoryMap() {
    const { data, error } = await supa.from('inventory_items').select('*');
    if (error) throw error;
    const map = new Map();
    (data || []).forEach(row => {
      const key = [row.category, row.product_name, row.variant, row.size].map(v => String(v || '').trim().toLowerCase()).join('|');
      map.set(key, row);
    });
    return map;
  }

  function normalizeTrackedItems(items) {
    return (items || [])
      .map(x => ({
        category: String(x.category || '').trim(),
        product_name: String(x.product_name || '').trim(),
        variant: String(x.variant || '').trim(),
        size: String(x.size || '').trim(),
        qty: Number(x.qty || 0)
      }))
      .filter(x => x.product_name && x.variant && x.size && x.qty > 0);
  }

  async function applyInventoryDelta(trackedItems, orderType, direction) {
    const list = normalizeTrackedItems(trackedItems);
    if (!list.length) return;
    const invMap = await loadInventoryMap();

    for (const item of list) {
      const key = [item.category, item.product_name, item.variant, item.size].map(v => String(v || '').trim().toLowerCase()).join('|');
      const row = invMap.get(key);
      if (!row) continue;

      const qty = Number(item.qty || 0);
      if (!qty) continue;

      const patch = {};
      if (String(orderType || '').toLowerCase() === 'mto') {
        patch.production_qty = Math.max(0, Number(row.production_qty || 0) + (direction === 'restore' ? qty : -qty));
      } else {
        patch.on_hand_qty = Math.max(0, Number(row.on_hand_qty || 0) + (direction === 'restore' ? qty : -qty));
      }

      const { error } = await supa.from('inventory_items').update(patch).eq('id', row.id);
      if (error) throw error;
    }
  }

  async function loadOrdersData() {
    const { data, error } = await supa.from('orders').select('*').order('order_date', { ascending: false }).order('id', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function initOrdersPage() {
    const btnLogout = $("btnLogout");
    const btnRefresh = $("btnRefresh");
    const orderList = $("orderList");
    const countLabel = $("countLabel");
    const form = $("orderForm");
    const formTitle = $("formTitle");
    const formMsg = $("formMsg");
    const btnClear = $("btnClear");
    const btnSave = $("btnSave");
    const inputCustomer = $("customer_name");
    const inputFb = $("fb_profile");
    const inputDetails = $("order_details");
    const inputAttach = $("attachment");
    const inputStatus = $("status");
    const inputDate = $("order_date");
    const inputDelivery = $("delivery_method");
    const inputOrderType = $("order_type");
    const inputShipment = $("shipment_date");
    const inputRelease = $("release_date");
    const releaseWrap = $("releaseWrap");
    const inputBalance = $("remaining_balance");
    const balanceWrap = $("balanceWrap");
    const inputPaidProd = $("paid_product");
    const inputPaidShip = $("paid_shipping");
    const inputNotes = $("notes");
    const trackedWrap = $("trackedItemsWrap");
    const btnAddTrackedItem = $("btnAddTrackedItem");
    const search = $("search");
    const statusFilter = $("statusFilter");
    const dateFilter = $("dateFilter");
    const tabs = document.querySelectorAll('#tabs .tab');
    const daysSelect = $("daysSelect");

    let orders = [];
    let editingId = null;
    let activeTab = 'all';
    let shippingHidden = false;

    function trackedRowTemplate(item = {}) {
      const row = document.createElement('div');
      row.className = 'trackedRow';
      row.innerHTML = `
        <input class="ti-category" placeholder="Category" value="${(item.category || '').replace(/"/g,'&quot;')}" />
        <input class="ti-product" placeholder="Product Name" value="${(item.product_name || '').replace(/"/g,'&quot;')}" />
        <input class="ti-variant" placeholder="Variant / Size" value="${(item.variant || '').replace(/"/g,'&quot;')}" />
        <input class="ti-size" placeholder="Size" value="${(item.size || '').replace(/"/g,'&quot;')}" />
        <div style="display:flex;gap:8px">
          <input class="ti-qty" type="number" min="1" placeholder="Qty" value="${Number(item.qty || 1)}" />
          <button class="btn danger small ti-remove" type="button">✕</button>
        </div>
      `;
      row.querySelector('.ti-remove').onclick = () => row.remove();
      return row;
    }

    function collectTrackedItems() {
      return Array.from(trackedWrap.querySelectorAll('.trackedRow')).map(row => ({
        category: row.querySelector('.ti-category')?.value || '',
        product_name: row.querySelector('.ti-product')?.value || '',
        variant: row.querySelector('.ti-variant')?.value || '',
        size: row.querySelector('.ti-size')?.value || '',
        qty: Number(row.querySelector('.ti-qty')?.value || 0)
      })).filter(x => x.product_name && x.variant && x.size && Number(x.qty) > 0);
    }

    function renderTrackedItems(items) {
      trackedWrap.innerHTML = '';
      const list = items && items.length ? items : [{ qty: 1 }];
      list.forEach(item => trackedWrap.appendChild(trackedRowTemplate(item)));
    }

    function handleOrderTypeChange() {
      if (!inputDelivery || !inputPaidShip) return;
      if (inputDelivery.value === 'walkin') {
        inputPaidShip.value = '0';
        inputPaidShip.disabled = true;
      } else {
        inputPaidShip.disabled = false;
      }
      const isMTO = inputOrderType.value === 'mto';
      releaseWrap.classList.toggle('hidden', !isMTO);
      balanceWrap.classList.toggle('hidden', !isMTO);
      if (!isMTO) {
        inputRelease.value = '';
        inputBalance.value = '';
      }
    }

    function resetForm() {
      editingId = null;
      form.reset();
      formTitle.textContent = 'New Order';
      inputStatus.value = 'pending';
      inputDelivery.value = 'jnt';
      inputOrderType.value = 'onhand';
      inputDate.value = todayYmd();
      renderTrackedItems([]);
      handleOrderTypeChange();
      formMsg.textContent = '—';
    }

    function rebuildDateOptions() {
      const current = dateFilter.value || 'all';
      const set = new Set(orders.map(o => o.order_date).filter(Boolean));
      const sorted = Array.from(set).sort((a, b) => String(b).localeCompare(String(a)));
      dateFilter.innerHTML = '<option value="all">All Dates</option>' + sorted.map(d => `<option value="${d}">${d}</option>`).join('');
      dateFilter.value = sorted.includes(current) ? current : 'all';
    }

    function filtered() {
      const q = (search.value || '').trim().toLowerCase();
      const st = statusFilter.value || 'all';
      const dt = dateFilter.value || 'all';
      return orders.filter(o => {
        const delivery = String(o.delivery_method || '').toLowerCase();
        const orderType = String(o.order_type || (delivery === 'mto' ? 'mto' : 'onhand')).toLowerCase();
        if (activeTab !== 'all' && delivery !== activeTab && orderType !== activeTab) return false;
        if (st !== 'all' && String(o.status || '').toLowerCase() !== st) return false;
        if (dt !== 'all' && String(o.order_date || '') !== dt) return false;
        if (!q) return true;
        const hay = [o.order_id, o.customer_name, o.fb_profile, o.order_details, o.notes].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }

    function renderKPIs() {
      const el = (id) => document.getElementById(id);
      el('kpiTotal').textContent = String(orders.length);
      const product = orders.reduce((a, o) => a + Number(o.paid_product || 0), 0);
      const ship = orders.reduce((a, o) => a + Number(o.paid_shipping || 0), 0);
      const total = product + ship;
      el('kpiProductRev').textContent = money(product);
      el('kpiShipRev').textContent = shippingHidden ? '••••' : money(ship);
      el('kpiTotalRev').textContent = shippingHidden ? money(product) : money(total);

      const today = todayYmd();
      const todayOrders = orders.filter(o => String(o.order_date || '') === today);
      const uniq = new Set(todayOrders.map(o => String(o.customer_name || '').trim().toLowerCase()).filter(Boolean));
      const todayTotal = todayOrders.reduce((a, o) => a + Number(o.paid_product || 0) + Number(o.paid_shipping || 0), 0);
      el('kpiOrdersToday').textContent = String(todayOrders.length);
      el('kpiCustomersToday').textContent = String(uniq.size);
      el('kpiRevenueToday').textContent = money(todayTotal);

      const days = Number(daysSelect.value || 7);
      document.getElementById('daysLabel').textContent = String(days);
      const body = document.getElementById('salesTableBody');
      const byDate = new Map();
      orders.forEach(o => {
        if (!o.order_date) return;
        if (!byDate.has(o.order_date)) byDate.set(o.order_date, { orders: 0, customers: new Set(), prod: 0, ship: 0 });
        const row = byDate.get(o.order_date);
        row.orders += 1;
        row.customers.add(String(o.customer_name || '').trim().toLowerCase());
        row.prod += Number(o.paid_product || 0);
        row.ship += Number(o.paid_shipping || 0);
      });
      const now = new Date();
      const rows = [];
      for (let i = 0; i < days; i++) {
        const dd = new Date(now); dd.setDate(now.getDate() - i);
        const key = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
        const rec = byDate.get(key) || { orders: 0, customers: new Set(), prod: 0, ship: 0 };
        rows.push(`<tr><td>${key}</td><td>${rec.orders}</td><td>${rec.customers.size}</td><td>${money(rec.prod)}</td><td>${shippingHidden ? '••••' : money(rec.ship)}</td><td>${shippingHidden ? money(rec.prod) : money(rec.prod + rec.ship)}</td></tr>`);
      }
      body.innerHTML = rows.join('') || '<tr><td colspan="6" class="mini">No data</td></tr>';
    }

    function renderList() {
      const list = filtered();
      countLabel.textContent = `${list.length} orders`;
      orderList.innerHTML = '';

      if (!list.length) {
        orderList.innerHTML = '<li class="item"><div class="mini">No orders found.</div></li>';
        return;
      }

      list.forEach(o => {
        const li = document.createElement('li');
        li.className = 'item';

        const left = document.createElement('div');
        left.style.flex = '1';

        const title = document.createElement('div');
        title.className = 'titleLine';
        const orderType = String(o.order_type || (String(o.delivery_method || '').toLowerCase() === 'mto' ? 'mto' : 'onhand')).toLowerCase();
        title.innerHTML = `
          <div style="font-weight:800">${o.customer_name || 'Unknown Customer'}</div>
          <span class="pill">${o.order_id || '#' + o.id}</span>
          <span class="pill accent">${String(o.status || 'pending').toUpperCase()}</span>
          <span class="pill">${String(o.delivery_method || 'jnt').toUpperCase()}</span>
          <span class="pill">${orderType === 'mto' ? 'MADE TO ORDER' : 'ON-HAND'}</span>
        `;
        left.appendChild(title);

        const sub = document.createElement('div');
        sub.className = 'sub';
        sub.textContent = [o.fb_profile ? 'FB attached' : '', o.order_date || '', money(Number(o.paid_product || 0) + Number(o.paid_shipping || 0))].filter(Boolean).join(' • ');
        left.appendChild(sub);

        const raw = String(o.order_details || '').trim();
        if (raw) {
          const preview = document.createElement('div');
          preview.className = 'details-preview';
          preview.textContent = '🧾 Order form hidden — click Expand to view.';
          const full = document.createElement('div');
          full.className = 'details-full';
          const pre = document.createElement('pre');
          pre.textContent = raw;
          full.appendChild(pre);
          left.appendChild(preview);
          left.appendChild(full);

          const tracked = normalizeTrackedItems(o.tracked_items || []);
          if (tracked.length) {
            const info = document.createElement('div');
            info.className = 'info';
            info.textContent = 'Tracked Items: ' + tracked.map(x => `${x.product_name} / ${x.variant} / ${x.size} × ${x.qty}`).join(' | ');
            left.appendChild(info);
          }

          if (o.notes) {
            const nb = document.createElement('div');
            nb.className = 'notes-box';
            nb.innerHTML = `<div class="notes-hd"><div class="notes-lbl">Private Notes</div></div><div class="notes-txt clamp"></div>`;
            nb.querySelector('.notes-txt').textContent = o.notes;
            left.appendChild(nb);
          }

          const right = document.createElement('div');
          right.style.display = 'flex';
          right.style.gap = '8px';
          right.style.flexWrap = 'wrap';
          right.style.justifyContent = 'flex-end';

          if (o.fb_profile) {
            const fb = document.createElement('a');
            fb.className = 'btn small';
            fb.href = /^https?:\/\//i.test(o.fb_profile) ? o.fb_profile : `https://${o.fb_profile.replace(/^\/+/, '')}`;
            fb.target = '_blank';
            fb.rel = 'noopener';
            fb.textContent = 'FB Profile';
            right.appendChild(fb);
          }

          const copyBtn = document.createElement('button');
          copyBtn.className = 'btn small';
          copyBtn.type = 'button';
          copyBtn.textContent = 'Copy Order Details';
          copyBtn.onclick = async () => {
            await navigator.clipboard.writeText(raw);
          };
          right.appendChild(copyBtn);

          const toggle = document.createElement('button');
          toggle.className = 'btn small';
          toggle.type = 'button';
          toggle.textContent = 'Expand';
          toggle.onclick = () => {
            const open = !full.classList.contains('show');
            full.classList.toggle('show', open);
            toggle.textContent = open ? 'Collapse' : 'Expand';
          };
          right.appendChild(toggle);

          const edit = document.createElement('button');
          edit.className = 'btn small';
          edit.type = 'button';
          edit.textContent = 'Edit';
          edit.onclick = () => startEdit(o);
          right.appendChild(edit);

          const del = document.createElement('button');
          del.className = 'btn danger small';
          del.type = 'button';
          del.textContent = 'Delete';
          del.onclick = () => deleteOrder(o);
          right.appendChild(del);

          li.appendChild(left);
          li.appendChild(right);
          orderList.appendChild(li);
        }
      });
    }

    function render() {
      renderKPIs();
      renderList();
    }

    function startEdit(o) {
      editingId = o.id;
      formTitle.textContent = `Edit Order (${o.order_id || o.id})`;
      inputCustomer.value = o.customer_name || '';
      inputFb.value = o.fb_profile || '';
      inputDetails.value = o.order_details || '';
      inputStatus.value = o.status || 'pending';
      inputDate.value = o.order_date || '';
      inputDelivery.value = String(o.delivery_method || 'jnt').toLowerCase() === 'mto' ? 'jnt' : (o.delivery_method || 'jnt');
      inputOrderType.value = String(o.order_type || (String(o.delivery_method || '').toLowerCase() === 'mto' ? 'mto' : 'onhand')).toLowerCase();
      inputPaidProd.value = String(o.paid_product ?? '');
      inputPaidShip.value = String(o.paid_shipping ?? '');
      inputNotes.value = o.notes || '';
      inputShipment.value = o.shipment_date || '';
      inputRelease.value = o.release_date || '';
      inputBalance.value = (o.remaining_balance ?? '') === null ? '' : String(o.remaining_balance ?? '');
      renderTrackedItems(normalizeTrackedItems(o.tracked_items || []));
      handleOrderTypeChange();
    }

    async function deleteOrder(o) {
      if (!confirm(`Delete order ${o.order_id || o.id}?`)) return;
      try {
        await applyInventoryDelta(o.tracked_items || [], o.order_type || (String(o.delivery_method || '').toLowerCase() === 'mto' ? 'mto' : 'onhand'), 'restore');
        const { error } = await supa.from('orders').delete().eq('id', o.id);
        if (error) throw error;
        await logActivity('order', o.id, 'delete', `Deleted order ${o.order_id || o.id}`);
        orders = await loadOrdersData();
        render();
        resetForm();
      } catch (e) {
        showErr(e.message || String(e));
      }
    }

    async function saveOrder(ev) {
      ev.preventDefault();
      btnSave.disabled = true;
      formMsg.textContent = 'Saving…';

      try {
        await ensureSession();

        const trackedItems = collectTrackedItems();
        const orderType = inputOrderType.value;
        const legacyDelivery = inputDelivery.value;
        const deliveryMethod = legacyDelivery;
        const payload = {
          customer_name: inputCustomer.value.trim(),
          fb_profile: inputFb.value.trim() || null,
          order_details: inputDetails.value.trim(),
          paid_product: Number(inputPaidProd.value || 0),
          paid_shipping: Number(inputPaidShip.value || 0),
          status: inputStatus.value,
          order_date: inputDate.value || null,
          notes: inputNotes.value.trim() || null,
          delivery_method: deliveryMethod,
          order_type: orderType,
          shipment_date: inputShipment.value || null,
          release_date: orderType === 'mto' ? (inputRelease.value || null) : null,
          remaining_balance: orderType === 'mto' ? (inputBalance.value === '' ? null : Number(inputBalance.value || 0)) : null,
          tracked_items: trackedItems
        };
        if (payload.delivery_method === 'walkin') payload.paid_shipping = 0;

        const file = inputAttach?.files?.[0] || null;
        if (file) payload.attachment_url = await uploadAttachment(file);

        if (editingId) {
          const old = orders.find(x => x.id === editingId);
          if (old) {
            await applyInventoryDelta(old.tracked_items || [], old.order_type || (String(old.delivery_method || '').toLowerCase() === 'mto' ? 'mto' : 'onhand'), 'restore');
          }
          await applyInventoryDelta(trackedItems, orderType, 'deduct');
          const { error } = await supa.from('orders').update(payload).eq('id', editingId);
          if (error) throw error;
          await logActivity('order', editingId, 'update', `Updated order ${editingId}`);
        } else {
          await applyInventoryDelta(trackedItems, orderType, 'deduct');
          const { data, error } = await supa.from('orders').insert(payload).select().single();
          if (error) throw error;
          await logActivity('order', data?.id, 'create', `Created order ${data?.order_id || data?.id || ''}`);
        }

        orders = await loadOrdersData();
        rebuildDateOptions();
        render();
        resetForm();
        formMsg.textContent = 'Saved ✅';
      } catch (e) {
        showErr(e.message || String(e));
        formMsg.textContent = 'Save failed';
      } finally {
        btnSave.disabled = false;
        if (inputAttach) inputAttach.value = '';
      }
    }

    btnLogout?.addEventListener('click', logout);
    btnRefresh?.addEventListener('click', async () => { orders = await loadOrdersData(); rebuildDateOptions(); render(); });
    btnClear?.addEventListener('click', resetForm);
    btnAddTrackedItem?.addEventListener('click', () => trackedWrap.appendChild(trackedRowTemplate({ qty: 1 })));
    form?.addEventListener('submit', saveOrder);
    inputDelivery?.addEventListener('change', handleOrderTypeChange);
    inputOrderType?.addEventListener('change', handleOrderTypeChange);
    search?.addEventListener('input', render);
    statusFilter?.addEventListener('change', render);
    dateFilter?.addEventListener('change', render);
    daysSelect?.addEventListener('change', render);
    tabs.forEach(t => t.addEventListener('click', () => { activeTab = t.dataset.tab; tabs.forEach(x => x.classList.toggle('active', x === t)); render(); }));
    document.getElementById('btnToggleShipping')?.addEventListener('click', () => { shippingHidden = !shippingHidden; document.getElementById('btnToggleShipping').textContent = shippingHidden ? 'Show 2FLY' : 'Hide 2FLY'; render(); });

    orders = await loadOrdersData();
    rebuildDateOptions();
    renderTrackedItems([]);
    resetForm();
    render();
  }

  async function initInventoryPage() {
    const btnLogout = $("btnLogout");
    const form = $("inventoryForm");
    const msg = $("invFormMsg");
    const btnClear = $("btnInvClear");
    const btnRefresh = $("btnInvRefresh");
    const tbody = $("inventoryTableBody");
    const search = $("inv_search");
    const countLabel = $("inventoryCountLabel");
    let inventory = [];
    let editingId = null;

    function updateKPIs(rows) {
      const variants = rows.length;
      const onHand = rows.reduce((a, r) => a + Number(r.on_hand_qty || 0), 0);
      const prod = rows.reduce((a, r) => a + Number(r.production_qty || 0), 0);
      const avail = rows.reduce((a, r) => a + (Number(r.on_hand_qty || 0) - Number(r.reserved_qty || 0)), 0);
      $("kpiInvVariants").textContent = String(variants);
      $("kpiInvOnHand").textContent = String(onHand);
      $("kpiInvProduction").textContent = String(prod);
      $("kpiInvAvailable").textContent = String(avail);
    }

    function filteredRows() {
      const q = (search.value || '').trim().toLowerCase();
      return inventory.filter(r => !q || [r.category, r.product_name, r.variant, r.size, r.sku].filter(Boolean).join(' ').toLowerCase().includes(q));
    }

    function render() {
      const rows = filteredRows();
      countLabel.textContent = `${rows.length} rows`;
      tbody.innerHTML = rows.map(r => {
        const available = Number(r.on_hand_qty || 0) - Number(r.reserved_qty || 0);
        return `<tr>
          <td>${r.category || ''}<br><strong>${r.product_name || ''}</strong></td>
          <td>${r.variant || ''} / ${r.size || ''}</td>
          <td>${Number(r.on_hand_qty || 0)}</td>
          <td>${Number(r.production_qty || 0)}</td>
          <td>${Number(r.reserved_qty || 0)}</td>
          <td>${available}</td>
          <td>
            <button class="btn small" data-edit="${r.id}">Edit</button>
            <button class="btn danger small" data-del="${r.id}">Delete</button>
          </td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="mini">No inventory rows yet.</td></tr>';
      updateKPIs(inventory);

      tbody.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => startEdit(btn.dataset.edit));
      tbody.querySelectorAll('[data-del]').forEach(btn => btn.onclick = () => deleteRow(btn.dataset.del));
    }

    function resetForm() {
      editingId = null;
      $("inventoryFormTitle").textContent = 'Add / Update Inventory';
      form.reset();
      $("inv_low_stock_alert").value = 10;
      $("inv_on_hand_qty").value = 0;
      $("inv_production_qty").value = 0;
      $("inv_reserved_qty").value = 0;
      msg.textContent = '—';
    }

    function startEdit(id) {
      const row = inventory.find(x => String(x.id) === String(id));
      if (!row) return;
      editingId = row.id;
      $("inventoryFormTitle").textContent = `Edit Inventory (${row.product_name})`;
      $("inventory_id").value = row.id;
      $("inv_category").value = row.category || '';
      $("inv_product_name").value = row.product_name || '';
      $("inv_variant").value = row.variant || '';
      $("inv_size").value = row.size || '';
      $("inv_sku").value = row.sku || '';
      $("inv_low_stock_alert").value = row.low_stock_alert ?? 10;
      $("inv_on_hand_qty").value = row.on_hand_qty ?? 0;
      $("inv_production_qty").value = row.production_qty ?? 0;
      $("inv_reserved_qty").value = row.reserved_qty ?? 0;
      $("inv_notes").value = row.notes || '';
    }

    async function deleteRow(id) {
      if (!confirm('Delete this inventory row?')) return;
      const { error } = await supa.from('inventory_items').delete().eq('id', id);
      if (error) { showErr(error.message || String(error)); return; }
      await logActivity('inventory', id, 'delete', `Deleted inventory row ${id}`);
      inventory = await loadInventoryRows();
      render();
      resetForm();
    }

    async function loadInventoryRows() {
      const { data, error } = await supa.from('inventory_items').select('*').order('category').order('product_name');
      if (error) throw error;
      return data || [];
    }

    async function saveRow(ev) {
      ev.preventDefault();
      msg.textContent = 'Saving…';
      const payload = {
        category: $("inv_category").value.trim(),
        product_name: $("inv_product_name").value.trim(),
        variant: $("inv_variant").value.trim(),
        size: $("inv_size").value.trim(),
        sku: $("inv_sku").value.trim() || null,
        on_hand_qty: Number($("inv_on_hand_qty").value || 0),
        production_qty: Number($("inv_production_qty").value || 0),
        reserved_qty: Number($("inv_reserved_qty").value || 0),
        low_stock_alert: Number($("inv_low_stock_alert").value || 0),
        notes: $("inv_notes").value.trim() || null
      };
      try {
        if (editingId) {
          const { error } = await supa.from('inventory_items').update(payload).eq('id', editingId);
          if (error) throw error;
          await logActivity('inventory', editingId, 'update', `Updated inventory ${payload.product_name}`);
        } else {
          const { data, error } = await supa.from('inventory_items').insert(payload).select().single();
          if (error) throw error;
          await logActivity('inventory', data?.id, 'create', `Created inventory ${payload.product_name}`);
        }
        inventory = await loadInventoryRows();
        render();
        resetForm();
        msg.textContent = 'Saved ✅';
      } catch (e) {
        showErr(e.message || String(e));
        msg.textContent = 'Save failed';
      }
    }

    btnLogout?.addEventListener('click', logout);
    btnRefresh?.addEventListener('click', async () => { inventory = await loadInventoryRows(); render(); });
    btnClear?.addEventListener('click', resetForm);
    search?.addEventListener('input', render);
    form?.addEventListener('submit', saveRow);

    inventory = await loadInventoryRows();
    render();
    resetForm();
  }

  async function initDashboardPage() {
    $("btnLogout")?.addEventListener('click', logout);

    const [orders, inventory, activity] = await Promise.all([
      loadOrdersData(),
      supa.from('inventory_items').select('*').then(r => { if (r.error) throw r.error; return r.data || []; }),
      supa.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(12).then(r => { if (r.error) throw r.error; return r.data || []; })
    ]);

    const tracked = [];
    orders.forEach(o => {
      normalizeTrackedItems(o.tracked_items || []).forEach(item => tracked.push({
        ...item,
        order_date: o.order_date,
        order_type: o.order_type || (String(o.delivery_method || '').toLowerCase() === 'mto' ? 'mto' : 'onhand'),
        delivery_method: o.delivery_method || ''
      }));
    });

    const productRevenue = orders.reduce((a, o) => a + Number(o.paid_product || 0), 0);
    const shipRevenue = orders.reduce((a, o) => a + Number(o.paid_shipping || 0), 0);
    $("dashTotalOrders").textContent = String(orders.length);
    $("dashProductRevenue").textContent = money(productRevenue);
    $("dashShipRevenue").textContent = money(shipRevenue);
    $("dashTotalCollected").textContent = money(productRevenue + shipRevenue);

    const deliveryCounts = orders.reduce((a, o) => { const k = String(o.delivery_method || '').toLowerCase() || 'unknown'; a[k] = (a[k] || 0) + 1; return a; }, {});
    const topDelivery = Object.entries(deliveryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    const mtoCount = orders.filter(o => String(o.order_type || (String(o.delivery_method || '').toLowerCase() === 'mto' ? 'mto' : 'onhand')).toLowerCase() === 'mto').length;
    const onhandCount = orders.length - mtoCount;
    const avgOrder = orders.length ? ((productRevenue + shipRevenue) / orders.length) : 0;

    const productCounts = {};
    const categoryCounts = {};
    const sizeCounts = {};
    const variantCounts = {};
    tracked.forEach(t => {
      productCounts[t.product_name] = (productCounts[t.product_name] || 0) + t.qty;
      categoryCounts[t.category] = (categoryCounts[t.category] || 0) + t.qty;
      sizeCounts[t.size] = (sizeCounts[t.size] || 0) + t.qty;
      variantCounts[`${t.variant} / ${t.size}`] = (variantCounts[`${t.variant} / ${t.size}`] || 0) + t.qty;
    });

    const bestProduct = Object.entries(productCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    const bestCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    const bestSize = Object.entries(sizeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    const bestVariant = Object.entries(variantCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

    const dayCounts = {};
    orders.forEach(o => { if (o.order_date) dayCounts[o.order_date] = (dayCounts[o.order_date] || 0) + 1; });
    const mostActiveDate = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

    const insights = [
      ['Top Delivery Method', String(topDelivery).toUpperCase()],
      ['On-hand Orders', String(onhandCount)],
      ['Made to Order', String(mtoCount)],
      ['Best Selling Product', bestProduct],
      ['Best Selling Category', bestCategory],
      ['Average Order Value', money(avgOrder)],
      ['Most Sold Size', bestSize],
      ['Most Sold Variant', bestVariant],
      ['Most Active Sales Day', mostActiveDate]
    ];
    $("dashInsights").innerHTML = insights.map(([label, value]) => `<div class="box"><div class="lbl">${label}</div><div class="num" style="font-size:16px">${value}</div></div>`).join('');

    const today = todayYmd();
    const byCategoryToday = {};
    tracked.filter(t => String(t.order_date || '') === today).forEach(t => { byCategoryToday[t.category] = (byCategoryToday[t.category] || 0) + t.qty; });
    $("dashDailyByCategory").innerHTML = Object.entries(byCategoryToday).sort((a, b) => b[1] - a[1]).map(([cat, sold]) => `<tr><td>${cat}</td><td>${sold}</td></tr>`).join('') || '<tr><td colspan="2" class="mini">No tracked item sales for today.</td></tr>';

    const topItems = {};
    tracked.forEach(t => {
      const key = `${t.product_name}|||${t.variant} / ${t.size}`;
      topItems[key] = (topItems[key] || 0) + t.qty;
    });
    $("dashTopItems").innerHTML = Object.entries(topItems).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, sold]) => {
      const [name, variant] = key.split('|||');
      return `<tr><td>${name}</td><td>${variant}</td><td>${sold}</td></tr>`;
    }).join('') || '<tr><td colspan="3" class="mini">No tracked items yet.</td></tr>';

    const totalOnHand = inventory.reduce((a, r) => a + Number(r.on_hand_qty || 0), 0);
    const totalProd = inventory.reduce((a, r) => a + Number(r.production_qty || 0), 0);
    const lowStock = inventory.filter(r => (Number(r.on_hand_qty || 0) - Number(r.reserved_qty || 0)) <= Number(r.low_stock_alert || 0));
    const outStock = inventory.filter(r => (Number(r.on_hand_qty || 0) - Number(r.reserved_qty || 0)) <= 0);
    $("dashInventorySummary").innerHTML = [
      ['Total On-hand Units', totalOnHand],
      ['Ongoing Production', totalProd],
      ['Low Stock Variants', lowStock.length],
      ['Out of Stock Variants', outStock.length],
      ['Fastest Moving Product', bestProduct],
      ['Fastest Moving Category', bestCategory]
    ].map(([label, value]) => `<div class="box"><div class="lbl">${label}</div><div class="num" style="font-size:16px">${value}</div></div>`).join('');

    $("dashLowStock").innerHTML = lowStock.sort((a, b) => ((a.on_hand_qty - a.reserved_qty) - (b.on_hand_qty - b.reserved_qty))).slice(0, 12).map(r => {
      const avail = Number(r.on_hand_qty || 0) - Number(r.reserved_qty || 0);
      return `<tr><td>${r.product_name} / ${r.variant} / ${r.size}</td><td>${avail}</td></tr>`;
    }).join('') || '<tr><td colspan="2" class="mini">No low stock alerts.</td></tr>';

    const activityList = $("dashActivity");
    activityList.innerHTML = '';
    (activity || []).forEach(row => {
      const li = document.createElement('li');
      li.className = 'item';
      li.innerHTML = `<div><div class="titleLine"><div style="font-weight:800">${row.user_email || 'Unknown user'}</div><span class="pill">${String(row.action || '').toUpperCase()}</span></div><div class="sub">${row.description || ''}</div></div><div class="mini">${row.created_at ? new Date(row.created_at).toLocaleString() : ''}</div>`;
      activityList.appendChild(li);
    });
    if (!activity.length) activityList.innerHTML = '<li class="item"><div class="mini">No recent activity yet.</div></li>';
  }

  async function init() {
    await ensureSession();
    if (page === 'orders') await initOrdersPage();
    if (page === 'inventory') await initInventoryPage();
    if (page === 'dashboard') await initDashboardPage();
    supa.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('./index.html'); });
  }

  init().catch(e => showErr(e.message || String(e)));
})();
