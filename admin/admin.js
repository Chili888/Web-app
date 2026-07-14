(() => {
  "use strict";

  const MAX_IMAGES = 10;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const PRODUCT_FIELDS = ["name","category","image_url","image_urls","emoji","price_text","stock_text","description","is_active","is_featured","sort_order"];

  const state = {
    supabase: null,
    user: null,
    products: [],
    filteredProducts: [],
    editingProduct: null,
    settings: null,
    imageItems: [],
    multiImageReady: false,
    selectedIds: new Set()
  };

  const $ = (id) => document.getElementById(id);
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindEvents();
    const config = window.APP_CONFIG || {};
    const configured = Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase?.createClient);
    if (!configured) {
      $("setupRequired").hidden = false;
      return;
    }

    state.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data, error } = await state.supabase.auth.getSession();
    if (error) {
      showLogin(error.message);
      return;
    }
    if (data.session?.user) await enterWithUser(data.session.user);
    else showLogin();

    state.supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user && session.user.id !== state.user?.id) await enterWithUser(session.user);
      else if (!session) {
        state.user = null;
        showLogin();
      }
    });
  }

  function bindEvents() {
    $("loginForm").addEventListener("submit", login);
    $("logoutButton").addEventListener("click", logout);
    $("unauthorizedLogout").addEventListener("click", logout);
    $("newProductButton").addEventListener("click", () => openProductModal());
    $("closeProductModal").addEventListener("click", closeProductModal);
    $("cancelProductButton").addEventListener("click", closeProductModal);
    $("productForm").addEventListener("submit", saveProduct);
    $("deleteProductButton").addEventListener("click", deleteProduct);
    $("settingsForm").addEventListener("submit", saveSettings);
    $("refreshProducts").addEventListener("click", loadProducts);
    $("productImage").addEventListener("change", handleImageSelection);
    $("productSearch").addEventListener("input", renderProductList);
    $("statusFilter").addEventListener("change", renderProductList);
    $("categoryFilter").addEventListener("change", renderProductList);
    $("adminSort").addEventListener("change", renderProductList);
    $("selectAllProducts").addEventListener("change", toggleSelectAll);
    $("exportJsonButton").addEventListener("click", exportJson);
    $("exportCsvButton").addEventListener("click", exportCsv);
    $("importJsonInput").addEventListener("change", importJson);

    document.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-tab]");
      if (tab) switchTab(tab.dataset.tab);

      const editButton = event.target.closest("[data-edit-product]");
      if (editButton) {
        const product = productById(editButton.dataset.editProduct);
        if (product) openProductModal(product);
      }

      const productAction = event.target.closest("[data-product-action]");
      if (productAction) handleProductAction(productAction.dataset.productAction, Number(productAction.dataset.productId));

      const imageAction = event.target.closest("[data-image-action]");
      if (imageAction) handleImageAction(imageAction.dataset.imageAction, imageAction.dataset.imageKey);

      const bulkAction = event.target.closest("[data-bulk-action]");
      if (bulkAction) handleBulkAction(bulkAction.dataset.bulkAction);

      if (event.target === $("productModal")) closeProductModal();
    });

    document.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-select-product]");
      if (!checkbox) return;
      const id = Number(checkbox.dataset.selectProduct);
      if (checkbox.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      updateBulkBar();
    });
  }

  async function login(event) {
    event.preventDefault();
    setButtonBusy($("loginButton"), true, "登录中…");
    $("loginError").textContent = "";
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    const { data, error } = await state.supabase.auth.signInWithPassword({email, password});
    setButtonBusy($("loginButton"), false, "登录后台");
    if (error) {
      $("loginError").textContent = humanError(error);
      return;
    }
    if (data.user) await enterWithUser(data.user);
  }

  async function enterWithUser(user) {
    state.user = user;
    const { data, error } = await state.supabase
      .from("admin_profiles")
      .select("user_id,display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !data) {
      $("currentUserId").textContent = user.id;
      hideAllViews();
      $("unauthorizedView").hidden = false;
      return;
    }

    hideAllViews();
    $("appView").hidden = false;
    $("adminEmail").textContent = user.email || data.display_name || "管理员";
    await Promise.all([loadProducts(), loadSettings()]);
  }

  function showLogin(message = "") {
    hideAllViews();
    $("loginView").hidden = false;
    $("loginError").textContent = message;
  }

  function hideAllViews() {
    $("setupRequired").hidden = true;
    $("loginView").hidden = true;
    $("unauthorizedView").hidden = true;
    $("appView").hidden = true;
  }

  async function logout() {
    await state.supabase.auth.signOut();
    state.user = null;
    showLogin();
  }

  async function loadProducts() {
    $("productList").innerHTML = '<div class="empty">正在加载商品…</div>';
    const { data, error } = await state.supabase
      .from("products")
      .select("*")
      .order("sort_order", {ascending: true})
      .order("id", {ascending: false});

    if (error) {
      $("productList").innerHTML = `<div class="empty">${escapeHtml(humanError(error))}</div>`;
      return;
    }

    state.products = data || [];
    state.selectedIds.clear();
    state.multiImageReady = state.products.length
      ? Object.prototype.hasOwnProperty.call(state.products[0], "image_urls")
      : await detectMultiImageColumn();
    $("multiImageUpgradeNotice").hidden = state.multiImageReady;
    updateStats();
    refreshCategoryOptions();
    renderProductList();
  }

  async function detectMultiImageColumn() {
    const { error } = await state.supabase.from("products").select("image_urls").limit(1);
    return !error;
  }

  function renderProductList() {
    const query = $("productSearch").value.trim().toLowerCase();
    const status = $("statusFilter").value;
    const category = $("categoryFilter").value;
    const sort = $("adminSort").value;

    let list = state.products.filter((product) => {
      const haystack = `${product.name || ""} ${product.category || ""} ${product.price_text || ""} ${product.stock_text || ""} ${product.description || ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
      if (category !== "all" && (product.category || "其他") !== category) return false;
      if (status === "active" && !product.is_active) return false;
      if (status === "inactive" && product.is_active) return false;
      if (status === "featured" && !product.is_featured) return false;
      if (status === "no-image" && productImages(product).length) return false;
      return true;
    });

    list = sortAdminProducts(list, sort);
    state.filteredProducts = list;
    $("productList").innerHTML = list.length
      ? list.map(productRow).join("")
      : '<div class="empty">没有符合条件的商品</div>';

    $("selectAllProducts").checked = list.length > 0 && list.every((item) => state.selectedIds.has(Number(item.id)));
    updateBulkBar();
  }

  function sortAdminProducts(list, mode) {
    const result = [...list];
    if (mode === "latest") return result.sort((a,b) => Number(b.id) - Number(a.id));
    if (mode === "name") return result.sort((a,b) => String(a.name).localeCompare(String(b.name), "zh-CN"));
    if (mode === "updated") return result.sort((a,b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    return result.sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id));
  }

  function productRow(product) {
    const id = Number(product.id);
    const count = productImages(product).length;
    const selected = state.selectedIds.has(id);
    return `
      <article class="product-row ${selected ? "selected-row" : ""}">
        <label class="row-check"><input type="checkbox" data-select-product="${id}" ${selected ? "checked" : ""} /><span></span></label>
        <div class="thumb">${productVisual(product)}</div>
        <div class="product-main">
          <div class="product-title-line"><h3>${escapeHtml(product.name)}</h3><span class="sort-number">#${Number(product.sort_order || 0)}</span></div>
          <div class="product-meta">
            <span class="badge">${escapeHtml(product.category || "其他")}</span>
            <span class="badge">${escapeHtml(product.price_text || "实时询价")}</span>
            <span class="badge">${count ? `${count} 张图` : "无图片"}</span>
            ${product.is_featured ? '<span class="badge featured">推荐</span>' : ""}
            <span class="badge ${product.is_active ? "live" : "off"}">${product.is_active ? "已上架" : "已下架"}</span>
          </div>
        </div>
        <div class="quick-actions">
          <button title="上移" type="button" data-product-action="move-up" data-product-id="${id}">↑</button>
          <button title="下移" type="button" data-product-action="move-down" data-product-id="${id}">↓</button>
          <button title="${product.is_featured ? "取消推荐" : "设为推荐"}" class="${product.is_featured ? "active-action" : ""}" type="button" data-product-action="toggle-featured" data-product-id="${id}">★</button>
          <button title="${product.is_active ? "下架" : "上架"}" class="${product.is_active ? "active-action" : ""}" type="button" data-product-action="toggle-active" data-product-id="${id}">${product.is_active ? "显" : "隐"}</button>
        </div>
        <div class="row-actions">
          <button class="secondary" type="button" data-product-action="copy" data-product-id="${id}">复制信息</button>
          <button class="secondary" type="button" data-product-action="duplicate" data-product-id="${id}">复制商品</button>
          <button class="primary small-primary" type="button" data-edit-product="${id}">编辑</button>
        </div>
      </article>`;
  }

  function updateStats() {
    $("statTotal").textContent = String(state.products.length);
    $("statActive").textContent = String(state.products.filter((item) => item.is_active).length);
    $("statInactive").textContent = String(state.products.filter((item) => !item.is_active).length);
    $("statFeatured").textContent = String(state.products.filter((item) => item.is_featured).length);
    $("statNoImage").textContent = String(state.products.filter((item) => !productImages(item).length).length);
  }

  function refreshCategoryOptions() {
    const categories = [...new Set(state.products.map((item) => item.category || "其他"))].sort((a,b) => a.localeCompare(b,"zh-CN"));
    const current = $("categoryFilter").value;
    $("categoryFilter").innerHTML = '<option value="all">全部分类</option>' + categories.map((item) => `<option value="${escapeAttribute(item)}">${escapeHtml(item)}</option>`).join("");
    $("categoryFilter").value = categories.includes(current) ? current : "all";
    $("categoryOptions").innerHTML = categories.map((item) => `<option value="${escapeAttribute(item)}"></option>`).join("");
  }

  async function loadSettings() {
    const { data, error } = await state.supabase.from("store_settings").select("*").eq("id", 1).maybeSingle();
    if (error) {
      toast(humanError(error));
      return;
    }
    state.settings = data || {};
    fillForm($("settingsForm"), state.settings);
  }

  function switchTab(tabName) {
    document.querySelectorAll(".nav").forEach((button) => button.classList.toggle("active", button.dataset.tab === tabName));
    $("productsTab").hidden = tabName !== "products";
    $("settingsTab").hidden = tabName !== "settings";
    $("dataTab").hidden = tabName !== "data";
  }

  function openProductModal(product = null) {
    state.editingProduct = product;
    const form = $("productForm");
    form.reset();
    form.elements.id.value = "";
    form.elements.emoji.value = "🥩";
    form.elements.sort_order.value = String(nextSortOrder());
    form.elements.is_active.checked = true;
    form.elements.is_featured.checked = false;

    clearImageItems();
    state.imageItems = productImages(product).map((url) => ({key:uniqueKey(),type:"existing",url,previewUrl:url,file:null}));
    $("productModalTitle").textContent = product ? "编辑商品" : "新增商品";
    $("deleteProductButton").hidden = !product;
    $("productImage").value = "";

    if (product) {
      fillForm(form, product);
      form.elements.id.value = product.id;
      form.elements.is_active.checked = Boolean(product.is_active);
      form.elements.is_featured.checked = Boolean(product.is_featured);
    }

    renderImagePreview();
    $("productModal").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeProductModal() {
    $("productModal").hidden = true;
    document.body.style.overflow = "";
    state.editingProduct = null;
    clearImageItems();
  }

  function clearImageItems() {
    state.imageItems.forEach((item) => {
      if (item.type === "new" && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    state.imageItems = [];
    if ($("imagePreview")) $("imagePreview").innerHTML = "";
  }

  function handleImageSelection(event) {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length) return;
    if (!state.multiImageReady) {
      toast("请先运行 supabase-multi-images.sql 启用多图功能");
      return;
    }
    const available = MAX_IMAGES - state.imageItems.length;
    if (available <= 0) {
      toast(`每个商品最多上传 ${MAX_IMAGES} 张图片`);
      return;
    }

    const accepted = [];
    for (const file of files.slice(0, available)) {
      if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) {
        toast(`不支持文件：${file.name}`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast(`${file.name} 超过 5 MB`);
        continue;
      }
      accepted.push({key:uniqueKey(),type:"new",url:"",previewUrl:URL.createObjectURL(file),file});
    }
    state.imageItems.push(...accepted);
    if (files.length > available) toast(`最多保留 ${MAX_IMAGES} 张图片`);
    renderImagePreview();
  }

  function handleImageAction(action, key) {
    const index = state.imageItems.findIndex((item) => item.key === key);
    if (index < 0) return;
    if (action === "remove") {
      const [removed] = state.imageItems.splice(index, 1);
      if (removed.type === "new" && removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    }
    if (action === "primary" && index > 0) moveImage(index, 0);
    if (action === "left" && index > 0) moveImage(index, index - 1);
    if (action === "right" && index < state.imageItems.length - 1) moveImage(index, index + 1);
    renderImagePreview();
  }

  function moveImage(from, to) {
    const [item] = state.imageItems.splice(from, 1);
    state.imageItems.splice(to, 0, item);
  }

  function renderImagePreview() {
    const container = $("imagePreview");
    if (!state.imageItems.length) {
      container.innerHTML = '<div class="image-empty">暂未添加商品图片，将使用备用图标。</div>';
      return;
    }
    container.innerHTML = state.imageItems.map((item, index) => `
      <div class="image-preview-card">
        <div class="preview-visual"><img src="${escapeAttribute(item.previewUrl)}" alt="商品图片预览 ${index + 1}" /></div>
        ${index === 0 ? '<span class="primary-image-badge">主图</span>' : ""}
        <span class="image-order">${index + 1}</span>
        <div class="image-preview-actions">
          <button type="button" data-image-action="left" data-image-key="${escapeAttribute(item.key)}" ${index === 0 ? "disabled" : ""}>←</button>
          <button type="button" data-image-action="right" data-image-key="${escapeAttribute(item.key)}" ${index === state.imageItems.length - 1 ? "disabled" : ""}>→</button>
          ${index > 0 ? `<button type="button" data-image-action="primary" data-image-key="${escapeAttribute(item.key)}">主图</button>` : ""}
          <button class="remove-image" type="button" data-image-action="remove" data-image-key="${escapeAttribute(item.key)}">移除</button>
        </div>
      </div>`).join("");
  }

  async function saveProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const saveButton = $("saveProductButton");
    setButtonBusy(saveButton, true, "保存中…");
    try {
      if (!state.multiImageReady && state.imageItems.length > 1) throw new Error("请先运行 supabase-multi-images.sql 启用多图功能");
      const imageUrls = await Promise.all(state.imageItems.map(async (item) => item.type === "existing" ? item.url : uploadProductImage(item.file)));
      const cleanImageUrls = imageUrls.map((url) => String(url || "").trim()).filter(Boolean);
      const payload = {
        name: form.elements.name.value.trim(),
        category: form.elements.category.value.trim(),
        price_text: form.elements.price_text.value.trim(),
        stock_text: form.elements.stock_text.value.trim(),
        emoji: form.elements.emoji.value.trim() || "🥩",
        image_url: cleanImageUrls[0] || null,
        description: form.elements.description.value.trim(),
        is_active: form.elements.is_active.checked,
        is_featured: form.elements.is_featured.checked,
        sort_order: Number(form.elements.sort_order.value || 0)
      };
      if (state.multiImageReady) payload.image_urls = cleanImageUrls;

      const id = Number(form.elements.id.value);
      const query = id
        ? state.supabase.from("products").update(payload).eq("id", id)
        : state.supabase.from("products").insert(payload);
      const { error } = await query;
      if (error) throw error;
      toast(id ? "商品已更新" : "商品已添加");
      closeProductModal();
      await loadProducts();
    } catch (error) {
      toast(humanError(error));
    } finally {
      setButtonBusy(saveButton, false, "保存商品");
    }
  }

  async function uploadProductImage(file) {
    if (!file) throw new Error("图片文件无效");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("图片不能超过 5 MB");
    const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${state.user.id}/${Date.now()}-${uniqueKey()}.${extension}`;
    const { error } = await state.supabase.storage.from("product-images").upload(path, file, {cacheControl:"3600",upsert:false,contentType:file.type || undefined});
    if (error) throw error;
    const { data } = state.supabase.storage.from("product-images").getPublicUrl(path);
    return data.publicUrl;
  }

  async function deleteProduct() {
    const id = Number($("productForm").elements.id.value);
    if (!id || !confirm("确定删除这个商品吗？删除后无法恢复。")) return;
    setButtonBusy($("deleteProductButton"), true, "删除中…");
    const { error } = await state.supabase.from("products").delete().eq("id", id);
    setButtonBusy($("deleteProductButton"), false, "删除商品");
    if (error) {
      toast(humanError(error));
      return;
    }
    toast("商品已删除");
    closeProductModal();
    await loadProducts();
  }

  async function handleProductAction(action, id) {
    const product = productById(id);
    if (!product) return;
    try {
      if (action === "toggle-active") await updateProduct(id, {is_active: !product.is_active}, product.is_active ? "商品已下架" : "商品已上架");
      if (action === "toggle-featured") await updateProduct(id, {is_featured: !product.is_featured}, product.is_featured ? "已取消推荐" : "已设为推荐");
      if (action === "duplicate") await duplicateProduct(product);
      if (action === "move-up") await moveProduct(id, -1);
      if (action === "move-down") await moveProduct(id, 1);
      if (action === "copy") await copyProduct(product);
    } catch (error) {
      toast(humanError(error));
    }
  }

  async function updateProduct(id, payload, message) {
    const { error } = await state.supabase.from("products").update(payload).eq("id", id);
    if (error) throw error;
    toast(message);
    await loadProducts();
  }

  async function duplicateProduct(product) {
    const payload = {};
    PRODUCT_FIELDS.forEach((field) => {
      if (field in product) payload[field] = product[field];
    });
    payload.name = `${product.name}（副本）`;
    payload.is_active = false;
    payload.sort_order = nextSortOrder();
    const { error } = await state.supabase.from("products").insert(payload);
    if (error) throw error;
    toast("商品副本已创建并设为下架");
    await loadProducts();
  }

  async function moveProduct(id, direction) {
    const ordered = [...state.products].sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id));
    const index = ordered.findIndex((item) => Number(item.id) === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) {
      toast(direction < 0 ? "已经是第一个商品" : "已经是最后一个商品");
      return;
    }
    const current = ordered[index];
    const target = ordered[targetIndex];
    let currentOrder = Number(current.sort_order || index * 10);
    let targetOrder = Number(target.sort_order || targetIndex * 10);
    if (currentOrder === targetOrder) {
      await normalizeSortOrder(ordered);
      return moveProduct(id, direction);
    }
    const { error: firstError } = await state.supabase.from("products").update({sort_order: targetOrder}).eq("id", current.id);
    if (firstError) throw firstError;
    const { error: secondError } = await state.supabase.from("products").update({sort_order: currentOrder}).eq("id", target.id);
    if (secondError) throw secondError;
    toast("显示顺序已调整");
    await loadProducts();
  }

  async function normalizeSortOrder(ordered = state.products) {
    const updates = ordered.map((item,index) => ({id:Number(item.id),sort_order:(index + 1) * 10}));
    for (const item of updates) {
      const { error } = await state.supabase.from("products").update({sort_order:item.sort_order}).eq("id",item.id);
      if (error) throw error;
    }
  }

  async function copyProduct(product) {
    const text = [`商品：${product.name}`,`分类：${product.category || "其他"}`,`价格：${product.price_text || ""}`,`库存：${product.stock_text || ""}`,product.description || ""].filter(Boolean).join("\n");
    await copyText(text);
    toast("商品信息已复制");
  }

  function toggleSelectAll(event) {
    if (event.currentTarget.checked) state.filteredProducts.forEach((item) => state.selectedIds.add(Number(item.id)));
    else state.filteredProducts.forEach((item) => state.selectedIds.delete(Number(item.id)));
    renderProductList();
  }

  function updateBulkBar() {
    const count = state.selectedIds.size;
    $("bulkBar").hidden = count === 0;
    $("selectedCount").textContent = `已选 ${count} 项`;
  }

  async function handleBulkAction(action) {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    try {
      if (action === "delete") {
        if (!confirm(`确定删除已选择的 ${ids.length} 个商品吗？此操作无法恢复。`)) return;
        const { error } = await state.supabase.from("products").delete().in("id", ids);
        if (error) throw error;
        toast("已批量删除");
      } else {
        const payload = action === "activate" ? {is_active:true}
          : action === "deactivate" ? {is_active:false}
          : action === "feature" ? {is_featured:true}
          : {is_featured:false};
        const { error } = await state.supabase.from("products").update(payload).in("id", ids);
        if (error) throw error;
        toast("批量操作完成");
      }
      state.selectedIds.clear();
      await loadProducts();
    } catch (error) {
      toast(humanError(error));
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    const button = $("saveSettingsButton");
    setButtonBusy(button, true, "保存中…");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    values.id = 1;
    const { error } = await state.supabase.from("store_settings").upsert(values, {onConflict:"id"});
    setButtonBusy(button, false, "保存店铺设置");
    if (error) {
      toast(humanError(error));
      return;
    }
    state.settings = values;
    toast("店铺设置已保存");
  }

  function exportJson() {
    const payload = {version:2,exported_at:new Date().toISOString(),store_settings:state.settings || {},products:state.products};
    downloadBlob(JSON.stringify(payload,null,2), `meat-shop-backup-${dateStamp()}.json`, "application/json;charset=utf-8");
    toast("JSON 备份已导出");
  }

  function exportCsv() {
    const headers = ["id","name","category","price_text","stock_text","is_active","is_featured","sort_order","image_count","description"];
    const rows = state.products.map((item) => [item.id,item.name,item.category,item.price_text,item.stock_text,item.is_active,item.is_featured,item.sort_order,productImages(item).length,item.description]);
    const csv = [headers,...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadBlob("\ufeff" + csv, `meat-shop-products-${dateStamp()}.csv`, "text/csv;charset=utf-8");
    toast("CSV 已导出");
  }

  async function importJson(event) {
    const file = event.currentTarget.files[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const products = Array.isArray(parsed) ? parsed : parsed.products;
      if (!Array.isArray(products) || !products.length) throw new Error("备份文件中没有商品数据");
      if (!confirm(`检测到 ${products.length} 个商品。相同 ID 将更新，不同 ID 将新增，是否继续？`)) return;

      const records = products.map((item) => {
        const record = {};
        PRODUCT_FIELDS.forEach((field) => {
          if (field in item) record[field] = item[field];
        });
        if (Number.isFinite(Number(item.id))) record.id = Number(item.id);
        record.name = String(record.name || "未命名商品");
        record.category = String(record.category || "其他");
        record.emoji = String(record.emoji || "🥩");
        record.price_text = String(record.price_text || "实时询价");
        record.stock_text = String(record.stock_text || "咨询库存");
        record.description = String(record.description || "");
        record.is_active = Boolean(record.is_active);
        record.is_featured = Boolean(record.is_featured);
        record.sort_order = Number(record.sort_order || 0);
        return record;
      });

      const { error } = await state.supabase.from("products").upsert(records, {onConflict:"id"});
      if (error) throw error;

      if (parsed.store_settings && confirm("备份中包含店铺设置，是否同时恢复？")) {
        const settings = {...parsed.store_settings,id:1};
        const { error: settingsError } = await state.supabase.from("store_settings").upsert(settings,{onConflict:"id"});
        if (settingsError) throw settingsError;
      }
      toast("备份导入完成");
      await Promise.all([loadProducts(),loadSettings()]);
    } catch (error) {
      toast(humanError(error));
    }
  }

  function productById(id) {
    return state.products.find((item) => Number(item.id) === Number(id));
  }

  function fillForm(form, values) {
    Object.entries(values || {}).forEach(([key,value]) => {
      const field = form.elements.namedItem(key);
      if (!field) return;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else if (field.type !== "file") field.value = value ?? "";
    });
  }

  function nextSortOrder() {
    if (!state.products.length) return 10;
    return Math.max(...state.products.map((item) => Number(item.sort_order || 0))) + 10;
  }

  function productImages(product) {
    if (!product) return [];
    let urls = [];
    const raw = product.image_urls;
    if (Array.isArray(raw)) urls = raw;
    else if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) urls = parsed;
      } catch {
        urls = raw.split("\n");
      }
    }
    urls = urls.map((url) => String(url || "").trim()).filter(Boolean);
    const legacy = String(product.image_url || "").trim();
    if (legacy) {
      urls = urls.filter((url) => url !== legacy);
      urls.unshift(legacy);
    }
    return [...new Set(urls)];
  }

  function productVisual(product) {
    const image = productImages(product)[0];
    if (image) return `<img src="${escapeAttribute(image)}" alt="${escapeAttribute(product.name)}" />`;
    return escapeHtml(product.emoji || "🥩");
  }

  function uniqueKey() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function setButtonBusy(button, busy, text) {
    button.disabled = busy;
    button.textContent = text;
  }

  function humanError(error) {
    const message = String(error?.message || error || "操作失败");
    if (/invalid login credentials/i.test(message)) return "邮箱或密码不正确";
    if (/row-level security/i.test(message)) return "当前账号没有执行此操作的权限";
    if (/failed to fetch/i.test(message)) return "无法连接 Supabase，请检查配置或网络";
    if (/image_urls.*does not exist|column.*image_urls/i.test(message)) return "请先运行 supabase-multi-images.sql 启用多图功能";
    return message;
  }

  function downloadBlob(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], {type}));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvCell(value) {
    const text = String(value ?? "").replaceAll('"','""');
    return `"${text}"`;
  }

  function dateStamp() {
    return new Date().toISOString().slice(0,10);
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("复制失败");
  }

  function toast(message) {
    const element = $("toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(window.__adminToast);
    window.__adminToast = window.setTimeout(() => element.classList.remove("show"), 2600);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }
})();