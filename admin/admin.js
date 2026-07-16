(() => {
  "use strict";

  const MAX_IMAGES = 10;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const PRODUCT_FIELDS = ["name","category","category_id","image_url","image_urls","emoji","price_text","stock_text","description","is_active","is_featured","sort_order"];
  const COMMERCE_PRODUCT_FIELDS = ["price_minor","currency","inventory_count","unlimited_inventory","sales_count","product_type","purchase_instructions","after_sales_instructions","deleted_at"];
  const CATEGORY_FIELDS = ["name","icon","description","sort_order","is_active"];

  const state = {
    supabase: null,
    user: null,
    products: [],
    filteredProducts: [],
    categories: [],
    categoriesReady: false,
    editingProduct: null,
    editingCategory: null,
    settings: null,
    imageItems: [],
    multiImageReady: false,
    commerceReady: false,
    channelPosts: [],
    channelLoaded: false,
    botSettingsLoaded: false,
    botSettings: null,
    autoReplyRules: [],
    moderationLoaded: false,
    moderationRules: [],
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
    const {data, error} = await state.supabase.auth.getSession();
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
    $("productImage").addEventListener("change", handleImageSelection);

    $("newCategoryButton").addEventListener("click", () => openCategoryModal());
    $("closeCategoryModal").addEventListener("click", closeCategoryModal);
    $("cancelCategoryButton").addEventListener("click", closeCategoryModal);
    $("categoryForm").addEventListener("submit", saveCategory);
    $("deleteCategoryButton").addEventListener("click", deleteCategory);

    $("settingsForm").addEventListener("submit", saveSettings);
    $("refreshProducts").addEventListener("click", refreshAll);
    $("refreshChannelPosts").addEventListener("click", loadChannelPosts);
    $("refreshBotSettings").addEventListener("click", loadBotSettings);
    $("botSettingsForm").addEventListener("submit", saveBotSettings);
    $("autoReplyForm").addEventListener("submit", saveAutoReplyRule);
    $("moderationSettingsForm").addEventListener("submit", saveModerationSettings);
    $("groupMemberActionForm").addEventListener("submit", submitGroupMemberAction);
    $("moderationRuleForm").addEventListener("submit", saveModerationRule);
    $("moderationRuleForm").elements.rule_type.addEventListener("change", updateModerationRuleFields);
    updateModerationRuleFields();
    document.querySelectorAll("[data-channel-submit]").forEach((button) => {
      button.addEventListener("click", () => submitChannelPost(button.dataset.channelSubmit));
    });
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

      const editProductButton = event.target.closest("[data-edit-product]");
      if (editProductButton) {
        const product = productById(editProductButton.dataset.editProduct);
        if (product) openProductModal(product);
      }

      const productAction = event.target.closest("[data-product-action]");
      if (productAction) handleProductAction(productAction.dataset.productAction, Number(productAction.dataset.productId));

      const editCategoryButton = event.target.closest("[data-edit-category]");
      if (editCategoryButton) {
        const category = categoryById(editCategoryButton.dataset.editCategory);
        if (category) openCategoryModal(category);
      }

      const categoryAction = event.target.closest("[data-category-action]");
      if (categoryAction) handleCategoryAction(categoryAction.dataset.categoryAction, Number(categoryAction.dataset.categoryId));

      const imageAction = event.target.closest("[data-image-action]");
      if (imageAction) handleImageAction(imageAction.dataset.imageAction, imageAction.dataset.imageKey);

      const bulkAction = event.target.closest("[data-bulk-action]");
      if (bulkAction) handleBulkAction(bulkAction.dataset.bulkAction);

      const channelAction = event.target.closest("[data-channel-action]");
      if (channelAction) handleChannelAction(channelAction.dataset.channelAction, channelAction.dataset.channelId);

      const ruleAction = event.target.closest("[data-rule-action]");
      if (ruleAction) handleModerationRuleAction(ruleAction.dataset.ruleAction, ruleAction.dataset.ruleId);

      const autoReplyAction = event.target.closest("[data-auto-reply-action]");
      if (autoReplyAction) handleAutoReplyAction(autoReplyAction.dataset.autoReplyAction, autoReplyAction.dataset.autoReplyId);

      if (event.target === $("productModal")) closeProductModal();
      if (event.target === $("categoryModal")) closeCategoryModal();
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
    const {data, error} = await state.supabase.auth.signInWithPassword({email, password});
    setButtonBusy($("loginButton"), false, "登录后台");
    if (error) {
      $("loginError").textContent = humanError(error);
      return;
    }
    if (data.user) await enterWithUser(data.user);
  }

  async function enterWithUser(user) {
    state.user = user;
    const {data, error} = await state.supabase
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
    await refreshAll();
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

  async function refreshAll() {
    setButtonBusy($("refreshProducts"), true, "刷新中…");
    try {
      await loadCategories();
      await Promise.all([loadProducts(), loadSettings()]);
    } finally {
      setButtonBusy($("refreshProducts"), false, "刷新");
    }
  }

  async function loadCategories() {
    const {data, error} = await state.supabase
      .from("categories")
      .select("*")
      .order("sort_order", {ascending: true})
      .order("id", {ascending: true});

    if (error) {
      if (isMissingTable(error, "categories")) {
        state.categoriesReady = false;
        state.categories = [];
        setCategoryUpgradeState(true);
        return;
      }
      toast(humanError(error));
      return;
    }

    state.categoriesReady = true;
    state.categories = data || [];
    setCategoryUpgradeState(false);
    renderCategoryList();
  }

  function setCategoryUpgradeState(show) {
    $("categoryUpgradeNotice").hidden = !show;
    $("categoryTabUpgrade").hidden = !show;
    $("newCategoryButton").disabled = show;
    if (show) {
      $("categoryList").innerHTML = '<div class="empty">分类管理尚未启用</div>';
      updateCategoryStats();
    }
  }

  async function loadProducts() {
    $("productList").innerHTML = '<div class="empty">正在加载商品…</div>';
    const {data, error} = await state.supabase
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
    state.commerceReady = state.products.length
      ? Object.prototype.hasOwnProperty.call(state.products[0], "price_minor")
      : await detectCommerceColumns();
    $("commerceUpgradeNotice").hidden = state.commerceReady;
    setCommerceFieldsEnabled(state.commerceReady);

    refreshCategoryControls();
    updateStats();
    updateCategoryStats();
    renderCategoryList();
    renderProductList();
  }

  async function detectMultiImageColumn() {
    const {error} = await state.supabase.from("products").select("image_urls").limit(1);
    return !error;
  }

  async function detectCommerceColumns() {
    const {error} = await state.supabase.from("products").select("price_minor,inventory_count,deleted_at").limit(1);
    return !error;
  }

  function setCommerceFieldsEnabled(enabled) {
    const container = document.querySelector("[data-commerce-fields]");
    if (!container) return;
    container.classList.toggle("is-disabled", !enabled);
    container.querySelectorAll("input,select,textarea").forEach((field) => {
      field.disabled = !enabled;
    });
  }

  function renderProductList() {
    const query = $("productSearch").value.trim().toLowerCase();
    const status = $("statusFilter").value;
    const categoryKey = $("categoryFilter").value;
    const sort = $("adminSort").value;

    let list = state.products.filter((product) => {
      const haystack = `${product.name || ""} ${product.category || ""} ${product.price_text || ""} ${product.stock_text || ""} ${product.description || ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
      if (categoryKey !== "all" && !productMatchesCategory(product, categoryKey)) return false;
      if (status === "deleted") return Boolean(product.deleted_at);
      if (product.deleted_at) return false;
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
    if (mode === "latest") return result.sort((a, b) => Number(b.id) - Number(a.id));
    if (mode === "name") return result.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-CN"));
    if (mode === "updated") return result.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    return result.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id));
  }

  function productRow(product) {
    const id = Number(product.id);
    const count = productImages(product).length;
    const selected = state.selectedIds.has(id);
    const category = categoryForProduct(product);
    return `
      <article class="product-row ${selected ? "selected-row" : ""}">
        <label class="row-check"><input type="checkbox" data-select-product="${id}" ${selected ? "checked" : ""} /><span></span></label>
        <div class="thumb">${productVisual(product)}</div>
        <div class="product-main">
          <div class="product-title-line"><h3>${escapeHtml(product.name)}</h3><span class="sort-number">#${Number(product.sort_order || 0)}</span></div>
          <div class="product-meta">
            <span class="badge">${escapeHtml(category.icon || "")} ${escapeHtml(category.name)}</span>
            <span class="badge">${escapeHtml(product.price_text || "实时询价")}</span>
            <span class="badge">${count ? `${count} 张图` : "无图片"}</span>
            ${product.is_featured ? '<span class="badge featured">推荐</span>' : ""}
            ${product.deleted_at ? '<span class="badge off">已软删除</span>' : `<span class="badge ${product.is_active ? "live" : "off"}">${product.is_active ? "已上架" : "已下架"}</span>`}
          </div>
        </div>
        <div class="quick-actions">
          ${product.deleted_at ? `<button title="恢复为下架商品" type="button" data-product-action="restore" data-product-id="${id}">恢复</button>` : `
          <button title="上移" type="button" data-product-action="move-up" data-product-id="${id}">↑</button>
          <button title="下移" type="button" data-product-action="move-down" data-product-id="${id}">↓</button>
          <button title="${product.is_featured ? "取消推荐" : "设为推荐"}" class="${product.is_featured ? "active-action" : ""}" type="button" data-product-action="toggle-featured" data-product-id="${id}">★</button>
          <button title="${product.is_active ? "下架" : "上架"}" class="${product.is_active ? "active-action" : ""}" type="button" data-product-action="toggle-active" data-product-id="${id}">${product.is_active ? "显" : "隐"}</button>`}
        </div>
        <div class="row-actions">
          <button class="secondary" type="button" data-product-action="copy" data-product-id="${id}">复制信息</button>
          <button class="secondary" type="button" data-product-action="duplicate" data-product-id="${id}">复制商品</button>
          <button class="primary small-primary" type="button" data-edit-product="${id}">编辑</button>
        </div>
      </article>`;
  }

  function updateStats() {
    const products = state.products.filter((item) => !item.deleted_at);
    $("statTotal").textContent = String(products.length);
    $("statActive").textContent = String(products.filter((item) => item.is_active).length);
    $("statInactive").textContent = String(products.filter((item) => !item.is_active).length);
    $("statFeatured").textContent = String(products.filter((item) => item.is_featured).length);
    $("statNoImage").textContent = String(products.filter((item) => !productImages(item).length).length);
  }

  function refreshCategoryControls() {
    const categories = selectableCategories();
    const filterCurrent = $("categoryFilter").value;
    const productCurrent = $("productCategory").value;
    const bulkCurrent = $("bulkCategorySelect").value;

    const filterOptions = categories.map((item) => `<option value="${escapeAttribute(item.key)}">${escapeHtml(item.icon || "")} ${escapeHtml(item.name)}${item.is_active === false ? "（隐藏）" : ""}</option>`).join("");
    $("categoryFilter").innerHTML = '<option value="all">全部分类</option>' + filterOptions;
    $("productCategory").innerHTML = '<option value="">请选择分类</option>' + filterOptions;
    $("bulkCategorySelect").innerHTML = '<option value="">移动到分类</option>' + filterOptions;

    $("categoryFilter").value = categories.some((item) => item.key === filterCurrent) ? filterCurrent : "all";
    if (categories.some((item) => item.key === productCurrent)) $("productCategory").value = productCurrent;
    if (categories.some((item) => item.key === bulkCurrent)) $("bulkCategorySelect").value = bulkCurrent;
  }

  function selectableCategories() {
    if (state.categoriesReady) {
      return state.categories.map((category) => ({...category, key: `id:${category.id}`}));
    }

    return [...new Set(state.products.map((item) => item.category || "其他"))]
      .sort((a, b) => a.localeCompare(b, "zh-CN"))
      .map((name) => ({id: null, key: `name:${name}`, name, icon: "•", description: "", sort_order: 0, is_active: true}));
  }

  function categoryForProduct(product) {
    return state.categories.find((item) => Number(item.id) === Number(product.category_id))
      || state.categories.find((item) => item.name === (product.category || "其他"))
      || {id: null, key: `name:${product.category || "其他"}`, name: product.category || "其他", icon: "•", is_active: true};
  }

  function categoryFromKey(key) {
    if (!key) return null;
    if (key.startsWith("id:")) return state.categories.find((item) => Number(item.id) === Number(key.slice(3))) || null;
    if (key.startsWith("name:")) return {id: null, key, name: key.slice(5), icon: "•", is_active: true};
    return null;
  }

  function productMatchesCategory(product, key) {
    if (key.startsWith("id:")) return Number(product.category_id) === Number(key.slice(3));
    if (key.startsWith("name:")) return (product.category || "其他") === key.slice(5);
    return true;
  }

  function renderCategoryList() {
    if (!state.categoriesReady) return;
    const ordered = [...state.categories].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id));
    $("categoryList").innerHTML = ordered.length
      ? ordered.map((category, index) => categoryRow(category, index, ordered.length)).join("")
      : '<div class="empty">还没有分类，请先创建一个分类</div>';
  }

  function categoryRow(category, index, total) {
    const count = categoryProductCount(category);
    return `
      <article class="category-row ${category.is_active ? "" : "category-hidden"}">
        <div class="category-icon">${escapeHtml(category.icon || "🥩")}</div>
        <div class="category-main">
          <div class="category-title"><h3>${escapeHtml(category.name)}</h3><span class="sort-number">#${Number(category.sort_order || 0)}</span></div>
          <p>${escapeHtml(category.description || "暂无分类说明")}</p>
          <div class="product-meta">
            <span class="badge">${count} 件商品</span>
            <span class="badge ${category.is_active ? "live" : "off"}">${category.is_active ? "前台显示" : "已隐藏"}</span>
          </div>
        </div>
        <div class="category-quick-actions">
          <button type="button" data-category-action="move-up" data-category-id="${category.id}" ${index === 0 ? "disabled" : ""}>↑ 上移</button>
          <button type="button" data-category-action="move-down" data-category-id="${category.id}" ${index === total - 1 ? "disabled" : ""}>↓ 下移</button>
          <button type="button" data-category-action="toggle-active" data-category-id="${category.id}">${category.is_active ? "隐藏" : "显示"}</button>
          <button class="primary small-primary" type="button" data-edit-category="${category.id}">编辑</button>
        </div>
      </article>`;
  }

  function updateCategoryStats() {
    const total = state.categoriesReady ? state.categories.length : 0;
    $("statCategoryTotal").textContent = String(total);
    $("statCategoryActive").textContent = String(state.categories.filter((item) => item.is_active).length);
    $("statCategoryHidden").textContent = String(state.categories.filter((item) => !item.is_active).length);
    $("statCategoryEmpty").textContent = String(state.categories.filter((item) => categoryProductCount(item) === 0).length);
  }

  function categoryProductCount(category) {
    return state.products.filter((product) => Number(product.category_id) === Number(category.id) || (!product.category_id && product.category === category.name)).length;
  }

  async function loadSettings() {
    const {data, error} = await state.supabase.from("store_settings").select("*").eq("id", 1).maybeSingle();
    if (error) {
      toast(humanError(error));
      return;
    }
    state.settings = data || {};
    fillForm($("settingsForm"), state.settings);
  }

  async function switchTab(tabName) {
    document.querySelectorAll(".nav").forEach((button) => button.classList.toggle("active", button.dataset.tab === tabName));
    $("productsTab").hidden = tabName !== "products";
    $("categoriesTab").hidden = tabName !== "categories";
    $("botTab").hidden = tabName !== "bot";
    $("channelTab").hidden = tabName !== "channel";
    $("moderationTab").hidden = tabName !== "moderation";
    $("settingsTab").hidden = tabName !== "settings";
    $("dataTab").hidden = tabName !== "data";
    if (tabName === "channel" && !state.channelLoaded) await loadChannelPosts();
    if (tabName === "bot" && !state.botSettingsLoaded) await loadBotSettings();
    if (tabName === "moderation" && !state.moderationLoaded) await loadModerationSettings();
  }

  async function loadBotSettings() {
    try {
      const [settings, rules] = await Promise.all([
        backendRequest("/api/admin/bot/settings"),
        backendRequest("/api/admin/bot/auto-replies")
      ]);
      state.botSettings = settings;
      state.autoReplyRules = Array.isArray(rules.items) ? rules.items : [];
      state.botSettingsLoaded = true;
      $("botSettingsApiNotice").hidden = true;
      const form = $("botSettingsForm");
      form.elements.version.value = String(settings.version);
      form.elements.welcome_message.value = settings.welcomeMessage || "";
      form.elements.help_message.value = settings.helpMessage || "";
      form.elements.why_us_message.value = settings.whyUsMessage || "";
      form.elements.stock_message.value = settings.stockMessage || "";
      form.elements.trade_rules_message.value = settings.tradeRulesMessage || "";
      form.elements.contact_message.value = settings.contactMessage || "";
      form.elements.business_hours.value = settings.businessHours || "";
      form.elements.offline_message.value = settings.offlineMessage || "";
      form.elements.mini_app_url.value = settings.miniAppUrl || "";
      form.elements.channel_url.value = settings.channelUrl || "";
      form.elements.group_url.value = settings.groupUrl || "";
      form.elements.automatic_reply_enabled.checked = Boolean(settings.automaticReplyEnabled);
      renderBotMenuButtons(settings.menuButtons || []);
      renderAutoReplyRules();
    } catch (error) {
      state.botSettingsLoaded = false;
      $("botSettingsApiNotice").hidden = false;
      toast(humanBackendError(error));
    }
  }

  function renderBotMenuButtons(buttons) {
    $("botMenuButtons").innerHTML = [...buttons]
      .sort((left, right) => Number(left.position) - Number(right.position))
      .map((button) => `<div class="bot-menu-row" data-menu-key="${escapeAttribute(button.key)}">
        <label>按钮名称<input data-menu-label maxlength="64" required value="${escapeAttribute(button.label)}" /></label>
        <label>顺序<input data-menu-position type="number" min="0" max="1000" required value="${Number(button.position)}" /></label>
        <label class="check"><input data-menu-visible type="checkbox" ${button.visible ? "checked" : ""} /> 显示</label>
      </div>`).join("");
  }

  async function saveBotSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const menuButtons = [...$("botMenuButtons").querySelectorAll("[data-menu-key]")].map((row) => ({
      key: row.dataset.menuKey,
      label: row.querySelector("[data-menu-label]").value.trim(),
      position: Number(row.querySelector("[data-menu-position]").value),
      visible: row.querySelector("[data-menu-visible]").checked
    }));
    const button = $("saveBotSettings");
    setButtonBusy(button, true, "保存中…");
    try {
      await backendRequest("/api/admin/bot/settings", {
        method: "PATCH",
        idempotencyKey: `bot-settings-${uniqueKey()}`,
        body: {
          expectedVersion: Number(form.elements.version.value),
          welcomeMessage: form.elements.welcome_message.value.trim(),
          helpMessage: form.elements.help_message.value.trim(),
          whyUsMessage: form.elements.why_us_message.value.trim(),
          stockMessage: form.elements.stock_message.value.trim(),
          tradeRulesMessage: form.elements.trade_rules_message.value.trim(),
          contactMessage: form.elements.contact_message.value.trim(),
          businessHours: form.elements.business_hours.value.trim(),
          offlineMessage: form.elements.offline_message.value.trim(),
          miniAppUrl: form.elements.mini_app_url.value.trim(),
          channelUrl: form.elements.channel_url.value.trim(),
          groupUrl: form.elements.group_url.value.trim(),
          automaticReplyEnabled: form.elements.automatic_reply_enabled.checked,
          menuButtons
        }
      });
      toast("机器人设置已保存，后续消息立即使用新配置");
      await loadBotSettings();
    } catch (error) {
      toast(humanBackendError(error));
    } finally {
      setButtonBusy(button, false, "保存机器人设置");
    }
  }

  function renderAutoReplyRules() {
    $("autoReplyList").innerHTML = state.autoReplyRules.length
      ? state.autoReplyRules.map((rule) => `<article class="moderation-rule-card ${rule.enabled ? "" : "rule-disabled"}">
        <div><b>${escapeHtml(rule.keyword)}</b><span>${escapeHtml(autoReplyMatchLabel(rule.matchType))} · 优先级 ${Number(rule.priority)}</span></div>
        <div class="moderation-rule-actions">
          <button type="button" data-auto-reply-action="edit" data-auto-reply-id="${rule.id}">编辑</button>
          <button type="button" data-auto-reply-action="toggle" data-auto-reply-id="${rule.id}">${rule.enabled ? "停用" : "启用"}</button>
        </div>
      </article>`).join("")
      : '<div class="empty">暂无关键词自动回复</div>';
  }

  function handleAutoReplyAction(action, id) {
    const rule = state.autoReplyRules.find((item) => item.id === id);
    if (!rule) return;
    if (action === "toggle") {
      persistAutoReplyRule(rule, {...rule, enabled: !rule.enabled});
      return;
    }
    const form = $("autoReplyForm");
    form.elements.id.value = rule.id;
    form.elements.version.value = String(rule.version);
    form.elements.match_type.value = rule.matchType;
    form.elements.keyword.value = rule.keyword;
    form.elements.response_content.value = rule.responseContent;
    form.elements.priority.value = String(rule.priority);
    form.elements.enabled.checked = Boolean(rule.enabled);
    form.scrollIntoView({behavior: "smooth", block: "center"});
  }

  async function saveAutoReplyRule(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const existing = state.autoReplyRules.find((item) => item.id === form.elements.id.value) || null;
    await persistAutoReplyRule(existing, {
      enabled: form.elements.enabled.checked,
      matchType: form.elements.match_type.value,
      keyword: form.elements.keyword.value.trim(),
      responseContent: form.elements.response_content.value.trim(),
      priority: Number(form.elements.priority.value)
    });
  }

  async function persistAutoReplyRule(existing, values) {
    try {
      const path = existing
        ? `/api/admin/bot/auto-replies/${encodeURIComponent(existing.id)}`
        : "/api/admin/bot/auto-replies";
      await backendRequest(path, {
        method: existing ? "PATCH" : "POST",
        idempotencyKey: `auto-reply-${uniqueKey()}`,
        body: {...values, ...(existing ? {expectedVersion: existing.version} : {})}
      });
      toast(existing ? "自动回复已更新" : "自动回复已创建");
      $("autoReplyForm").reset();
      $("autoReplyForm").elements.id.value = "";
      $("autoReplyForm").elements.version.value = "1";
      await loadBotSettings();
    } catch (error) {
      toast(humanBackendError(error));
    }
  }

  function autoReplyMatchLabel(type) {
    return ({exact: "完全匹配", contains: "包含", prefix: "开头匹配", regex: "正则表达式"})[type] || type;
  }

  async function loadModerationSettings() {
    try {
      const settings = await backendRequest("/api/admin/group/moderation-settings");
      const form = $("moderationSettingsForm");
      form.elements.version.value = String(settings.version);
      form.elements.enabled.checked = Boolean(settings.enabled);
      form.elements.violation_window_seconds.value = String(settings.violationWindowSeconds);
      form.elements.mute_after_violations.value = String(settings.muteAfterViolations);
      form.elements.ban_after_violations.value = String(settings.banAfterViolations);
      form.elements.mute_duration_seconds.value = String(settings.muteDurationSeconds);
      form.elements.warning_message.value = settings.warningMessage || "";
      state.moderationLoaded = true;
      $("moderationApiNotice").hidden = true;
      await loadModerationRules();
    } catch (error) {
      state.moderationLoaded = false;
      $("moderationApiNotice").hidden = false;
      toast(humanBackendError(error));
    }
  }

  async function loadModerationRules() {
    const response = await backendRequest("/api/admin/group/moderation-rules");
    state.moderationRules = Array.isArray(response.items) ? response.items : [];
    $("moderationRuleList").innerHTML = state.moderationRules.length
      ? state.moderationRules.map(moderationRuleCard).join("")
      : '<div class="empty">暂无规则，请先添加关键词或链接规则</div>';
  }

  function moderationRuleCard(rule) {
    const type = rule.ruleType === "link" ? "任意链接" : `关键词：${rule.pattern || ""}`;
    const mode = ({log: "仅记录", delete: "逐级处罚", mute: "直接禁言", ban: "直接封禁"})[rule.mode] || rule.mode;
    return `<article class="moderation-rule-card ${rule.enabled ? "" : "rule-disabled"}">
      <div><b>${escapeHtml(type)}</b><span>${escapeHtml(mode)} · 优先级 ${Number(rule.priority)}</span></div>
      <div class="moderation-rule-actions">
        <button type="button" data-rule-action="edit" data-rule-id="${rule.id}">编辑</button>
        <button type="button" data-rule-action="toggle" data-rule-id="${rule.id}">${rule.enabled ? "停用" : "启用"}</button>
      </div>
    </article>`;
  }

  function handleModerationRuleAction(action, id) {
    const rule = state.moderationRules.find((item) => item.id === id);
    if (!rule) return;
    if (action === "edit") {
      const form = $("moderationRuleForm");
      form.elements.id.value = rule.id;
      form.elements.version.value = String(rule.version);
      form.elements.rule_type.value = rule.ruleType;
      form.elements.pattern.value = rule.pattern || "";
      form.elements.mode.value = rule.mode;
      form.elements.action_duration_seconds.value = rule.actionDurationSeconds || "";
      form.elements.priority.value = String(rule.priority);
      form.elements.enabled.checked = Boolean(rule.enabled);
      updateModerationRuleFields();
      form.scrollIntoView({behavior: "smooth", block: "center"});
      return;
    }
    saveModerationRuleState(rule, {...rule, enabled: !rule.enabled});
  }

  async function saveModerationRule(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const id = form.elements.id.value;
    await saveModerationRuleState(id ? state.moderationRules.find((item) => item.id === id) : null, {
      enabled: form.elements.enabled.checked,
      ruleType: form.elements.rule_type.value,
      pattern: form.elements.pattern.value.trim(),
      mode: form.elements.mode.value,
      actionDurationSeconds: form.elements.action_duration_seconds.value ? Number(form.elements.action_duration_seconds.value) : null,
      priority: Number(form.elements.priority.value || 100),
      expectedVersion: Number(form.elements.version.value || 1)
    });
  }

  async function saveModerationRuleState(existing, values) {
    try {
      const path = existing ? `/api/admin/group/moderation-rules/${encodeURIComponent(existing.id)}` : "/api/admin/group/moderation-rules";
      await backendRequest(path, {
        method: existing ? "PATCH" : "POST",
        idempotencyKey: `moderation-rule-${uniqueKey()}`,
        body: {...values, expectedVersion: existing?.version || values.expectedVersion}
      });
      toast(existing ? "规则已更新" : "规则已创建");
      $("moderationRuleForm").reset();
      $("moderationRuleForm").elements.id.value = "";
      $("moderationRuleForm").elements.version.value = "1";
      updateModerationRuleFields();
      await loadModerationRules();
    } catch (error) {
      toast(humanBackendError(error));
    }
  }

  function updateModerationRuleFields() {
    const form = $("moderationRuleForm");
    const keyword = form.elements.rule_type.value === "keyword";
    form.elements.pattern.disabled = !keyword;
    form.elements.pattern.required = keyword;
    form.elements.pattern.placeholder = keyword ? "输入关键词" : "链接规则无需填写内容";
  }

  async function saveModerationSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const muteThreshold = Number(form.elements.mute_after_violations.value);
    const banThreshold = Number(form.elements.ban_after_violations.value);
    if (banThreshold < muteThreshold) {
      toast("封禁阈值不能小于禁言阈值");
      return;
    }
    const button = $("saveModerationSettings");
    setButtonBusy(button, true, "保存中…");
    try {
      await backendRequest("/api/admin/group/moderation-settings", {
        method: "PATCH",
        idempotencyKey: `moderation-settings-${uniqueKey()}`,
        body: {
          expectedVersion: Number(form.elements.version.value),
          enabled: form.elements.enabled.checked,
          violationWindowSeconds: Number(form.elements.violation_window_seconds.value),
          muteAfterViolations: muteThreshold,
          banAfterViolations: banThreshold,
          muteDurationSeconds: Number(form.elements.mute_duration_seconds.value),
          warningMessage: form.elements.warning_message.value.trim()
        }
      });
      toast("群治理设置已保存");
      await loadModerationSettings();
    } catch (error) {
      toast(humanBackendError(error));
    } finally {
      setButtonBusy(button, false, "保存治理设置");
    }
  }

  async function submitGroupMemberAction(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const action = form.elements.action.value;
    const userId = Number(form.elements.user_id.value);
    const labels = {mute: "禁言", unmute: "解除限制", kick: "移出", ban: "封禁", unban: "解除封禁"};
    if (!window.confirm(`确认对用户 ${userId} 执行“${labels[action] || action}”？`)) return;
    const button = $("submitGroupMemberAction");
    setButtonBusy(button, true, "提交中…");
    try {
      await backendRequest(`/api/admin/group/members/${encodeURIComponent(userId)}/actions`, {
        method: "POST",
        idempotencyKey: `group-${action}-${uniqueKey()}`,
        body: {
          action,
          durationSeconds: Number(form.elements.duration_seconds.value),
          reason: form.elements.reason.value.trim()
        }
      });
      toast("成员操作已进入 Worker 队列");
      form.reset();
      form.elements.duration_seconds.value = "900";
    } catch (error) {
      toast(humanBackendError(error));
    } finally {
      setButtonBusy(button, false, "提交成员操作");
    }
  }

  async function loadChannelPosts() {
    const list = $("channelPostList");
    list.innerHTML = '<div class="empty">正在加载频道记录…</div>';
    try {
      const response = await backendRequest("/api/admin/channel-posts?limit=100");
      state.channelPosts = Array.isArray(response.items) ? response.items : [];
      state.channelLoaded = true;
      $("channelApiNotice").hidden = true;
      renderChannelPosts();
    } catch (error) {
      state.channelLoaded = false;
      $("channelApiNotice").hidden = false;
      list.innerHTML = `<div class="empty">${escapeHtml(humanBackendError(error))}</div>`;
    }
  }

  async function submitChannelPost(intent) {
    const form = $("channelPostForm");
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const text = String(data.get("text") || "").trim();
    const scheduledLocal = String(data.get("scheduled_at") || "");
    if (intent === "schedule" && !scheduledLocal) {
      toast("请选择定时发布时间");
      form.elements.scheduled_at.focus();
      return;
    }
    const payload = {
      contentType: "text",
      content: {text, pin: data.get("pin") === "on"},
      parseMode: data.get("parse_mode") || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"
    };
    if (intent === "now") payload.publishNow = true;
    if (intent === "schedule") payload.scheduledAt = new Date(scheduledLocal).toISOString();
    const button = document.querySelector(`[data-channel-submit="${intent}"]`);
    setButtonBusy(button, true, "提交中…");
    try {
      await backendRequest("/api/admin/channel-posts", {
        method: "POST",
        idempotencyKey: `channel-create-${uniqueKey()}`,
        body: payload
      });
      form.reset();
      toast(intent === "draft" ? "草稿已保存" : "发布任务已进入队列");
      await loadChannelPosts();
    } catch (error) {
      toast(humanBackendError(error));
    } finally {
      setButtonBusy(button, false, intent === "draft" ? "保存草稿" : intent === "schedule" ? "定时发布" : "立即发布");
    }
  }

  function renderChannelPosts() {
    const list = $("channelPostList");
    list.innerHTML = state.channelPosts.length
      ? state.channelPosts.map(channelPostCard).join("")
      : '<div class="empty">暂无频道内容</div>';
  }

  function channelPostCard(post) {
    const text = String(post.content?.text || post.content?.media?.[0]?.caption || "媒体内容");
    const published = post.status === "published" && !post.deletedAt;
    const editable = published && post.contentType === "text";
    const captionEditable = published && post.contentType !== "text";
    const schedule = post.scheduledAt ? formatAdminDate(post.scheduledAt) : "未设置";
    return `<article class="channel-post-card">
      <div class="channel-post-top">
        <div><span class="badge ${channelStatusClass(post.status)}">${escapeHtml(channelStatusLabel(post))}</span><span class="channel-version">v${Number(post.version || 1)}</span></div>
        <time>${escapeHtml(schedule)}</time>
      </div>
      <p>${escapeHtml(text)}</p>
      <div class="channel-post-meta"><span>${escapeHtml(post.contentType)}</span><span>${post.channelMessageIds?.length || 0} 条 Telegram 消息</span>${post.lastError ? `<span class="channel-error">${escapeHtml(post.lastError)}</span>` : ""}</div>
      ${published ? `<div class="channel-card-actions">
        ${editable ? `<button type="button" data-channel-action="edit_text" data-channel-id="${post.id}">编辑正文</button>` : ""}
        ${captionEditable ? `<button type="button" data-channel-action="edit_caption" data-channel-id="${post.id}">编辑说明</button>` : ""}
        <button type="button" data-channel-action="${post.isPinned ? "unpin" : "pin"}" data-channel-id="${post.id}">${post.isPinned ? "取消置顶" : "置顶"}</button>
        <button class="danger-text" type="button" data-channel-action="delete" data-channel-id="${post.id}">删除消息</button>
      </div>` : ""}
    </article>`;
  }

  async function handleChannelAction(action, id) {
    const post = state.channelPosts.find((item) => item.id === id);
    if (!post) return;
    const body = {action, expectedVersion: Number(post.version)};
    if (action === "edit_text") {
      const text = window.prompt("编辑频道正文", post.content?.text || "");
      if (text === null) return;
      body.text = text;
      body.parseMode = post.parseMode;
    }
    if (action === "edit_caption") {
      const caption = window.prompt("编辑媒体说明", post.content?.media?.[0]?.caption || "");
      if (caption === null) return;
      body.caption = caption;
      body.parseMode = post.parseMode;
    }
    if (action === "delete" && !window.confirm("确认删除该频道消息？媒体组中的全部消息都会删除，此操作无法撤销。")) return;
    try {
      await backendRequest(`/api/admin/channel-posts/${encodeURIComponent(id)}/actions`, {
        method: "POST",
        idempotencyKey: `channel-${action}-${uniqueKey()}`,
        body
      });
      toast("操作已进入 Worker 队列");
      await loadChannelPosts();
    } catch (error) {
      toast(humanBackendError(error));
    }
  }

  async function backendRequest(path, options = {}) {
    const baseUrl = String(window.APP_CONFIG?.apiBaseUrl || "").replace(/\/$/, "");
    if (!baseUrl) throw new Error("backend_not_configured");
    const {data, error} = await state.supabase.auth.getSession();
    if (error || !data.session?.access_token) throw new Error("admin_session_missing");
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        authorization: `Bearer ${data.session.access_token}`,
        ...(options.body ? {"content-type": "application/json"} : {}),
        ...(options.idempotencyKey ? {"x-idempotency-key": options.idempotencyKey} : {})
      },
      ...(options.body ? {body: JSON.stringify(options.body)} : {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const failure = new Error(payload.error || `http_${response.status}`);
      failure.status = response.status;
      throw failure;
    }
    return payload;
  }

  function channelStatusLabel(post) {
    if (post.deletedAt) return "已删除";
    return ({draft: "草稿", scheduled: "待发布", publishing: "发布中", published: "已发布", cancelled: "已取消", failed: "待重试", dead_letter: "发送失败"})[post.status] || post.status;
  }

  function channelStatusClass(status) {
    return status === "published" ? "live" : status === "failed" || status === "dead_letter" ? "off" : "";
  }

  function formatAdminDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN", {hour12: false});
  }

  function humanBackendError(error) {
    const code = String(error?.message || error || "");
    if (code === "backend_not_configured") return "后端 API 地址尚未配置";
    if (code === "admin_session_missing" || code === "missing_admin_auth" || code === "invalid_admin_auth") return "管理员登录已失效，请重新登录";
    if (code === "forbidden") return "当前账号没有运营权限";
    if (code === "version_status_or_operation_conflict") return "记录已变化或已有操作处理中，请刷新后重试";
    if (code === "duplicate_request") return "该操作已提交，请勿重复点击";
    if (/Failed to fetch/i.test(code)) return "无法连接运营后端，请检查服务状态";
    return `操作失败：${code || "未知错误"}`;
  }

  function openProductModal(product = null) {
    if (!selectableCategories().length) {
      toast(state.categoriesReady ? "请先创建商品分类" : "请先运行 supabase-categories.sql");
      return;
    }

    state.editingProduct = product;
    const form = $("productForm");
    form.reset();
    form.elements.id.value = "";
    form.elements.emoji.value = "🥩";
    form.elements.sort_order.value = String(nextSortOrder());
    form.elements.is_active.checked = true;
    form.elements.is_featured.checked = false;
    form.elements.currency.value = "CNY";
    form.elements.product_type.value = "physical";
    form.elements.unlimited_inventory.checked = true;

    clearImageItems();
    state.imageItems = productImages(product).map((url) => ({key: uniqueKey(), type: "existing", url, previewUrl: url, file: null}));
    $("productModalTitle").textContent = product ? "编辑商品" : "新增商品";
    $("deleteProductButton").hidden = !product || Boolean(product.deleted_at);
    $("deleteProductButton").textContent = state.commerceReady ? "移入回收记录" : "删除商品";
    $("productImage").value = "";
    refreshCategoryControls();

    if (product) {
      fillForm(form, product);
      form.elements.id.value = product.id;
      form.elements.is_active.checked = Boolean(product.is_active);
      form.elements.is_featured.checked = Boolean(product.is_featured);
      if (state.commerceReady) {
        form.elements.price_yuan.value = product.price_minor == null ? "" : (Number(product.price_minor) / 100).toFixed(2);
        form.elements.unlimited_inventory.checked = Boolean(product.unlimited_inventory);
      }
      const category = categoryForProduct(product);
      form.elements.category_id.value = category.id ? `id:${category.id}` : `name:${category.name}`;
    } else {
      const firstActive = selectableCategories().find((item) => item.is_active !== false) || selectableCategories()[0];
      form.elements.category_id.value = firstActive?.key || "";
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
      accepted.push({key: uniqueKey(), type: "new", url: "", previewUrl: URL.createObjectURL(file), file});
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
    const category = categoryFromKey(form.elements.category_id.value);
    if (!category) {
      toast("请选择商品分类");
      return;
    }

    setButtonBusy(saveButton, true, "保存中…");
    try {
      if (!state.multiImageReady && state.imageItems.length > 1) throw new Error("请先运行 supabase-multi-images.sql 启用多图功能");
      const imageUrls = [];
      for (let index = 0; index < state.imageItems.length; index += 1) {
        const item = state.imageItems[index];
        if (item.type === "existing") imageUrls.push(item.url);
        else {
          setButtonBusy(saveButton, true, `上传图片 ${index + 1}/${state.imageItems.length}…`);
          imageUrls.push(await uploadProductImage(item.file));
        }
      }

      const cleanImageUrls = imageUrls.map((url) => String(url || "").trim()).filter(Boolean);
      const payload = {
        name: form.elements.name.value.trim(),
        category: category.name,
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
      if (state.categoriesReady) payload.category_id = category.id;
      if (state.commerceReady) {
        const priceYuan = form.elements.price_yuan.value.trim();
        const inventory = form.elements.inventory_count.value.trim();
        const priceMinor = priceYuan === "" ? null : Math.round(Number(priceYuan) * 100);
        const inventoryCount = inventory === "" ? null : Number(inventory);
        if (priceMinor != null && (!Number.isSafeInteger(priceMinor) || priceMinor < 0)) throw new Error("参考价格格式不正确");
        if (inventoryCount != null && (!Number.isSafeInteger(inventoryCount) || inventoryCount < 0)) throw new Error("库存数量必须是非负整数");
        Object.assign(payload, {
          price_minor: priceMinor,
          currency: form.elements.currency.value,
          inventory_count: inventoryCount,
          unlimited_inventory: form.elements.unlimited_inventory.checked,
          product_type: form.elements.product_type.value,
          purchase_instructions: form.elements.purchase_instructions.value.trim(),
          after_sales_instructions: form.elements.after_sales_instructions.value.trim()
        });
      }

      const id = Number(form.elements.id.value);
      const query = id
        ? state.supabase.from("products").update(payload).eq("id", id)
        : state.supabase.from("products").insert(payload);
      const {error} = await query;
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
    const {error} = await state.supabase.storage.from("product-images").upload(path, file, {cacheControl: "3600", upsert: false, contentType: file.type || undefined});
    if (error) throw error;
    const {data} = state.supabase.storage.from("product-images").getPublicUrl(path);
    return data.publicUrl;
  }

  async function deleteProduct() {
    const id = Number($("productForm").elements.id.value);
    const prompt = state.commerceReady
      ? "确定移入回收记录吗？商品会立即下架，数据仍可恢复。"
      : "确定删除这个商品吗？当前数据库尚未启用软删除，删除后无法恢复。";
    if (!id || !confirm(prompt)) return;
    setButtonBusy($("deleteProductButton"), true, "删除中…");
    const query = state.commerceReady
      ? state.supabase.from("products").update({is_active: false, deleted_at: new Date().toISOString()}).eq("id", id)
      : state.supabase.from("products").delete().eq("id", id);
    const {error} = await query;
    setButtonBusy($("deleteProductButton"), false, state.commerceReady ? "移入回收记录" : "删除商品");
    if (error) {
      toast(humanError(error));
      return;
    }
    toast(state.commerceReady ? "商品已移入回收记录" : "商品已删除");
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
      if (action === "restore") await updateProduct(id, {deleted_at: null, is_active: false}, "商品已恢复并保持下架");
    } catch (error) {
      toast(humanError(error));
    }
  }

  async function updateProduct(id, payload, message) {
    const {error} = await state.supabase.from("products").update(payload).eq("id", id);
    if (error) throw error;
    toast(message);
    await loadProducts();
  }

  async function duplicateProduct(product) {
    const payload = {};
    productFields().forEach((field) => {
      if (field in product && !(field === "category_id" && !state.categoriesReady)) payload[field] = product[field];
    });
    payload.name = `${product.name}（副本）`;
    payload.is_active = false;
    payload.sort_order = nextSortOrder();
    if (state.commerceReady) {
      payload.deleted_at = null;
      payload.sales_count = 0;
    }
    const {error} = await state.supabase.from("products").insert(payload);
    if (error) throw error;
    toast("商品副本已创建并设为下架");
    await loadProducts();
  }

  async function moveProduct(id, direction) {
    const ordered = [...state.products].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id));
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

    const {error: firstError} = await state.supabase.from("products").update({sort_order: targetOrder}).eq("id", current.id);
    if (firstError) throw firstError;
    const {error: secondError} = await state.supabase.from("products").update({sort_order: currentOrder}).eq("id", target.id);
    if (secondError) throw secondError;
    toast("显示顺序已调整");
    await loadProducts();
  }

  async function normalizeSortOrder(ordered = state.products) {
    for (let index = 0; index < ordered.length; index += 1) {
      const {error} = await state.supabase.from("products").update({sort_order: (index + 1) * 10}).eq("id", ordered[index].id);
      if (error) throw error;
    }
  }

  async function copyProduct(product) {
    const category = categoryForProduct(product);
    const text = [`商品：${product.name}`, `分类：${category.name}`, `价格：${product.price_text || ""}`, `库存：${product.stock_text || ""}`, product.description || ""].filter(Boolean).join("\n");
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
        const prompt = state.commerceReady
          ? `确定将已选择的 ${ids.length} 个商品移入回收记录吗？商品会立即下架。`
          : `确定删除已选择的 ${ids.length} 个商品吗？当前数据库尚未启用软删除，此操作无法恢复。`;
        if (!confirm(prompt)) return;
        const query = state.commerceReady
          ? state.supabase.from("products").update({is_active: false, deleted_at: new Date().toISOString()}).in("id", ids)
          : state.supabase.from("products").delete().in("id", ids);
        const {error} = await query;
        if (error) throw error;
        toast(state.commerceReady ? "已批量移入回收记录" : "已批量删除");
      } else if (action === "category") {
        const category = categoryFromKey($("bulkCategorySelect").value);
        if (!category) throw new Error("请选择目标分类");
        const payload = {category: category.name};
        if (state.categoriesReady) payload.category_id = category.id;
        const {error} = await state.supabase.from("products").update(payload).in("id", ids);
        if (error) throw error;
        toast(`已移动到“${category.name}”`);
      } else {
        const payload = action === "activate" ? {is_active: true}
          : action === "deactivate" ? {is_active: false}
          : action === "feature" ? {is_featured: true}
          : {is_featured: false};
        const {error} = await state.supabase.from("products").update(payload).in("id", ids);
        if (error) throw error;
        toast("批量操作完成");
      }
      state.selectedIds.clear();
      await loadProducts();
    } catch (error) {
      toast(humanError(error));
    }
  }

  function openCategoryModal(category = null) {
    if (!state.categoriesReady) {
      toast("请先运行 supabase-categories.sql");
      return;
    }

    state.editingCategory = category;
    const form = $("categoryForm");
    form.reset();
    form.elements.id.value = "";
    form.elements.old_name.value = "";
    form.elements.icon.value = "🥩";
    form.elements.sort_order.value = String(nextCategorySortOrder());
    form.elements.is_active.checked = true;
    $("categoryModalTitle").textContent = category ? "编辑分类" : "新增分类";
    $("deleteCategoryButton").hidden = !category;
    $("categoryUsage").hidden = true;
    $("reassignWrap").hidden = true;

    if (category) {
      fillForm(form, category);
      form.elements.id.value = category.id;
      form.elements.old_name.value = category.name;
      form.elements.is_active.checked = Boolean(category.is_active);
      const count = categoryProductCount(category);
      $("categoryUsage").textContent = `当前分类包含 ${count} 件商品。重命名后商品会自动同步。`;
      $("categoryUsage").hidden = false;
      if (count > 0) {
        const targets = state.categories.filter((item) => Number(item.id) !== Number(category.id));
        $("reassignCategorySelect").innerHTML = '<option value="">请选择目标分类</option>' + targets.map((item) => `<option value="${item.id}">${escapeHtml(item.icon || "")} ${escapeHtml(item.name)}</option>`).join("");
        $("reassignWrap").hidden = false;
      }
    }

    $("categoryModal").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeCategoryModal() {
    $("categoryModal").hidden = true;
    document.body.style.overflow = "";
    state.editingCategory = null;
  }

  async function saveCategory(event) {
    event.preventDefault();
    if (!state.categoriesReady) return;
    const form = event.currentTarget;
    const button = $("saveCategoryButton");
    const id = Number(form.elements.id.value);
    const oldName = form.elements.old_name.value.trim();
    const payload = {
      name: form.elements.name.value.trim(),
      icon: form.elements.icon.value.trim() || "🥩",
      description: form.elements.description.value.trim(),
      sort_order: Number(form.elements.sort_order.value || 0),
      is_active: form.elements.is_active.checked
    };

    if (!payload.name) {
      toast("请输入分类名称");
      return;
    }

    setButtonBusy(button, true, "保存中…");
    try {
      const query = id
        ? state.supabase.from("categories").update(payload).eq("id", id)
        : state.supabase.from("categories").insert(payload);
      const {error} = await query;
      if (error) throw error;

      if (id && oldName && oldName !== payload.name) {
        const {error: legacyError} = await state.supabase.from("products").update({category: payload.name}).eq("category", oldName);
        if (legacyError) throw legacyError;
      }

      toast(id ? "分类已更新" : "分类已创建");
      closeCategoryModal();
      await loadCategories();
      await loadProducts();
    } catch (error) {
      toast(humanError(error));
    } finally {
      setButtonBusy(button, false, "保存分类");
    }
  }

  async function deleteCategory() {
    const form = $("categoryForm");
    const id = Number(form.elements.id.value);
    const category = categoryById(id);
    if (!category) return;
    const count = categoryProductCount(category);
    const targetId = Number($("reassignCategorySelect").value);

    if (count > 0 && !targetId) {
      toast("请先选择商品要移动到的分类");
      return;
    }
    if (!confirm(`确定删除分类“${category.name}”吗？${count ? `其中 ${count} 件商品会被移动。` : ""}`)) return;

    setButtonBusy($("deleteCategoryButton"), true, "删除中…");
    try {
      if (count > 0) {
        const target = categoryById(targetId);
        if (!target) throw new Error("目标分类不存在");
        const {error: moveError} = await state.supabase.from("products").update({category_id: target.id, category: target.name}).eq("category_id", category.id);
        if (moveError) throw moveError;
        const {error: legacyMoveError} = await state.supabase.from("products").update({category_id: target.id, category: target.name}).eq("category", category.name);
        if (legacyMoveError) throw legacyMoveError;
      }

      const {error} = await state.supabase.from("categories").delete().eq("id", category.id);
      if (error) throw error;
      toast("分类已删除");
      closeCategoryModal();
      await loadCategories();
      await loadProducts();
    } catch (error) {
      toast(humanError(error));
    } finally {
      setButtonBusy($("deleteCategoryButton"), false, "删除分类");
    }
  }

  async function handleCategoryAction(action, id) {
    const category = categoryById(id);
    if (!category) return;
    try {
      if (action === "toggle-active") {
        const {error} = await state.supabase.from("categories").update({is_active: !category.is_active}).eq("id", id);
        if (error) throw error;
        toast(category.is_active ? "分类及其商品已从前台隐藏" : "分类已恢复显示");
        await loadCategories();
        await loadProducts();
      }
      if (action === "move-up") await moveCategory(id, -1);
      if (action === "move-down") await moveCategory(id, 1);
    } catch (error) {
      toast(humanError(error));
    }
  }

  async function moveCategory(id, direction) {
    const ordered = [...state.categories].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id));
    const index = ordered.findIndex((item) => Number(item.id) === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
    const current = ordered[index];
    const target = ordered[targetIndex];
    let currentOrder = Number(current.sort_order || index * 10);
    let targetOrder = Number(target.sort_order || targetIndex * 10);

    if (currentOrder === targetOrder) {
      await normalizeCategorySortOrder(ordered);
      return moveCategory(id, direction);
    }

    const {error: firstError} = await state.supabase.from("categories").update({sort_order: targetOrder}).eq("id", current.id);
    if (firstError) throw firstError;
    const {error: secondError} = await state.supabase.from("categories").update({sort_order: currentOrder}).eq("id", target.id);
    if (secondError) throw secondError;
    toast("分类顺序已调整");
    await loadCategories();
    refreshCategoryControls();
  }

  async function normalizeCategorySortOrder(ordered = state.categories) {
    for (let index = 0; index < ordered.length; index += 1) {
      const {error} = await state.supabase.from("categories").update({sort_order: (index + 1) * 10}).eq("id", ordered[index].id);
      if (error) throw error;
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    const button = $("saveSettingsButton");
    setButtonBusy(button, true, "保存中…");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    values.id = 1;
    const {error} = await state.supabase.from("store_settings").upsert(values, {onConflict: "id"});
    setButtonBusy(button, false, "保存店铺设置");
    if (error) {
      toast(humanError(error));
      return;
    }
    state.settings = values;
    toast("店铺设置已保存");
  }

  function exportJson() {
    const payload = {
      version: 3,
      exported_at: new Date().toISOString(),
      store_settings: state.settings || {},
      categories: state.categories,
      products: state.products
    };
    downloadBlob(JSON.stringify(payload, null, 2), `meat-shop-backup-${dateStamp()}.json`, "application/json;charset=utf-8");
    toast("完整 JSON 备份已导出");
  }

  function exportCsv() {
    const headers = ["id","name","category","price_text","stock_text","is_active","is_featured","sort_order","image_count","description"];
    const rows = state.products.map((item) => [item.id,item.name,categoryForProduct(item).name,item.price_text,item.stock_text,item.is_active,item.is_featured,item.sort_order,productImages(item).length,item.description]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
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

      if (state.categoriesReady && Array.isArray(parsed.categories) && parsed.categories.length) {
        const categoryRecords = parsed.categories.map((item) => {
          const record = {};
          CATEGORY_FIELDS.forEach((field) => {
            if (field in item) record[field] = item[field];
          });
          record.name = String(record.name || "未命名分类");
          record.icon = String(record.icon || "🥩");
          record.description = String(record.description || "");
          record.sort_order = Number(record.sort_order || 0);
          record.is_active = Boolean(record.is_active);
          return record;
        });
        const {error: categoryError} = await state.supabase.from("categories").upsert(categoryRecords, {onConflict: "name"});
        if (categoryError) throw categoryError;
        await loadCategories();
      }

      const categoryMap = new Map(state.categories.map((item) => [item.name, item.id]));
      const records = products.map((item) => {
        const record = {};
        productFields().forEach((field) => {
          if (field in item && !(field === "category_id" && !state.categoriesReady)) record[field] = item[field];
        });
        if (Number.isFinite(Number(item.id))) record.id = Number(item.id);
        record.name = String(record.name || "未命名商品");
        record.category = String(record.category || "其他");
        if (state.categoriesReady && categoryMap.has(record.category)) record.category_id = categoryMap.get(record.category);
        record.emoji = String(record.emoji || "🥩");
        record.price_text = String(record.price_text || "实时询价");
        record.stock_text = String(record.stock_text || "咨询库存");
        record.description = String(record.description || "");
        record.is_active = Boolean(record.is_active);
        record.is_featured = Boolean(record.is_featured);
        record.sort_order = Number(record.sort_order || 0);
        if (state.commerceReady) {
          record.price_minor = record.price_minor == null || record.price_minor === "" ? null : Number(record.price_minor);
          record.currency = String(record.currency || "CNY").toUpperCase();
          record.inventory_count = record.inventory_count == null || record.inventory_count === "" ? null : Number(record.inventory_count);
          record.unlimited_inventory = record.unlimited_inventory !== false;
          record.sales_count = Math.max(0, Number(record.sales_count || 0));
          record.product_type = record.product_type === "digital" ? "digital" : "physical";
          record.purchase_instructions = String(record.purchase_instructions || "");
          record.after_sales_instructions = String(record.after_sales_instructions || "");
          record.deleted_at = record.deleted_at ? String(record.deleted_at) : null;
          if (record.price_minor != null && (!Number.isSafeInteger(record.price_minor) || record.price_minor < 0)) throw new Error(`商品“${record.name}”的数值价格无效`);
          if (record.inventory_count != null && (!Number.isSafeInteger(record.inventory_count) || record.inventory_count < 0)) throw new Error(`商品“${record.name}”的库存无效`);
          if (!/^[A-Z]{3}$/.test(record.currency)) throw new Error(`商品“${record.name}”的币种无效`);
        }
        return record;
      });

      const {error} = await state.supabase.from("products").upsert(records, {onConflict: "id"});
      if (error) throw error;

      if (parsed.store_settings && confirm("备份中包含店铺设置，是否同时恢复？")) {
        const settings = {...parsed.store_settings, id: 1};
        const {error: settingsError} = await state.supabase.from("store_settings").upsert(settings, {onConflict: "id"});
        if (settingsError) throw settingsError;
      }

      toast("备份导入完成");
      await refreshAll();
    } catch (error) {
      toast(humanError(error));
    }
  }

  function productById(id) {
    return state.products.find((item) => Number(item.id) === Number(id));
  }

  function productFields() {
    return state.commerceReady ? [...PRODUCT_FIELDS, ...COMMERCE_PRODUCT_FIELDS] : PRODUCT_FIELDS;
  }

  function categoryById(id) {
    return state.categories.find((item) => Number(item.id) === Number(id));
  }

  function fillForm(form, values) {
    Object.entries(values || {}).forEach(([key, value]) => {
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

  function nextCategorySortOrder() {
    if (!state.categories.length) return 10;
    return Math.max(...state.categories.map((item) => Number(item.sort_order || 0))) + 10;
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

  function isMissingTable(error, table) {
    const message = String(error?.message || "");
    return error?.code === "42P01" || message.includes(`relation \"public.${table}\" does not exist`) || message.includes(`Could not find the table 'public.${table}'`);
  }

  function humanError(error) {
    const message = String(error?.message || error || "操作失败");
    if (/invalid login credentials/i.test(message)) return "邮箱或密码不正确";
    if (/row-level security/i.test(message)) return "当前账号没有执行此操作的权限";
    if (/failed to fetch/i.test(message)) return "无法连接 Supabase，请检查配置或网络";
    if (/duplicate key.*categories_name_unique|categories_name_unique/i.test(message)) return "分类名称已经存在";
    if (/image_urls.*does not exist|column.*image_urls/i.test(message)) return "请先运行 supabase-multi-images.sql 启用多图功能";
    if (/category_id.*does not exist|column.*category_id|relation.*categories/i.test(message)) return "请先运行 supabase-categories.sql 启用分类管理";
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
    const text = String(value ?? "").replaceAll('"', '""');
    return `"${text}"`;
  }

  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
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
    window.__adminToast = window.setTimeout(() => element.classList.remove("show"), 2800);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }
})();
