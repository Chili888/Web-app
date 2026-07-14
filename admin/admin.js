(() => {
  "use strict";

  const state = {
    supabase: null,
    user: null,
    products: [],
    editingProduct: null,
    settings: null
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

    if (data.session?.user) {
      await enterWithUser(data.session.user);
    } else {
      showLogin();
    }

    state.supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user && session.user.id !== state.user?.id) {
        await enterWithUser(session.user);
      } else if (!session) {
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
    $("productSearch").addEventListener("input", renderProductList);

    document.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-tab]");
      if (tab) switchTab(tab.dataset.tab);

      const editButton = event.target.closest("[data-edit-product]");
      if (editButton) {
        const product = state.products.find((item) => Number(item.id) === Number(editButton.dataset.editProduct));
        if (product) openProductModal(product);
      }

      if (event.target === $("productModal")) closeProductModal();
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
    updateStats();
    renderProductList();
  }

  function renderProductList() {
    const query = $("productSearch").value.trim().toLowerCase();
    const list = state.products.filter((product) =>
      `${product.name || ""} ${product.category || ""}`.toLowerCase().includes(query)
    );

    $("productList").innerHTML = list.length
      ? list.map((product) => `
          <article class="product-row">
            <div class="thumb">${productVisual(product)}</div>
            <div class="product-main">
              <h3>${escapeHtml(product.name)}</h3>
              <div class="product-meta">
                <span class="badge">${escapeHtml(product.category || "其他")}</span>
                <span class="badge">${escapeHtml(product.price_text || "实时询价")}</span>
                <span class="badge ${product.is_active ? "live" : "off"}">${product.is_active ? "已上架" : "已下架"}</span>
              </div>
            </div>
            <div class="row-actions">
              <button class="secondary" type="button" data-edit-product="${Number(product.id)}">编辑</button>
            </div>
          </article>
        `).join("")
      : '<div class="empty">没有找到商品</div>';
  }

  function updateStats() {
    $("statTotal").textContent = String(state.products.length);
    $("statActive").textContent = String(state.products.filter((item) => item.is_active).length);
    $("statInactive").textContent = String(state.products.filter((item) => !item.is_active).length);
  }

  async function loadSettings() {
    const { data, error } = await state.supabase
      .from("store_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      toast(humanError(error));
      return;
    }

    state.settings = data || {};
    fillForm($("settingsForm"), state.settings);
  }

  function switchTab(tabName) {
    document.querySelectorAll(".nav").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tabName);
    });
    $("productsTab").hidden = tabName !== "products";
    $("settingsTab").hidden = tabName !== "settings";
  }

  function openProductModal(product = null) {
    state.editingProduct = product;
    const form = $("productForm");
    form.reset();
    form.elements.id.value = "";
    form.elements.image_url.value = "";
    form.elements.emoji.value = "🥩";
    form.elements.sort_order.value = String(nextSortOrder());
    form.elements.is_active.checked = true;
    form.elements.is_featured.checked = false;

    $("productModalTitle").textContent = product ? "编辑商品" : "新增商品";
    $("deleteProductButton").hidden = !product;
    $("imagePreview").hidden = true;
    $("imagePreview").innerHTML = "";
    $("productImage").value = "";

    if (product) {
      fillForm(form, product);
      form.elements.id.value = product.id;
      form.elements.image_url.value = product.image_url || "";
      form.elements.is_active.checked = Boolean(product.is_active);
      form.elements.is_featured.checked = Boolean(product.is_featured);
      showImagePreview(product.image_url);
    }

    $("productModal").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeProductModal() {
    $("productModal").hidden = true;
    document.body.style.overflow = "";
    state.editingProduct = null;
  }

  async function saveProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const saveButton = $("saveProductButton");
    setButtonBusy(saveButton, true, "保存中…");

    try {
      let imageUrl = form.elements.image_url.value.trim();
      const file = $("productImage").files[0];

      if (file) {
        imageUrl = await uploadProductImage(file);
      }

      const payload = {
        name: form.elements.name.value.trim(),
        category: form.elements.category.value.trim(),
        price_text: form.elements.price_text.value.trim(),
        stock_text: form.elements.stock_text.value.trim(),
        emoji: form.elements.emoji.value.trim() || "🥩",
        image_url: imageUrl || null,
        description: form.elements.description.value.trim(),
        is_active: form.elements.is_active.checked,
        is_featured: form.elements.is_featured.checked,
        sort_order: Number(form.elements.sort_order.value || 0)
      };

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
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("图片不能超过 5 MB");
    }

    const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${state.user.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

    const { error } = await state.supabase.storage
      .from("product-images")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined
      });

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

  async function saveSettings(event) {
    event.preventDefault();
    const button = $("saveSettingsButton");
    setButtonBusy(button, true, "保存中…");

    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    values.id = 1;

    const { error } = await state.supabase
      .from("store_settings")
      .upsert(values, {onConflict: "id"});

    setButtonBusy(button, false, "保存店铺设置");

    if (error) {
      toast(humanError(error));
      return;
    }

    state.settings = values;
    toast("店铺设置已保存");
  }

  function fillForm(form, values) {
    Object.entries(values || {}).forEach(([key, value]) => {
      const field = form.elements.namedItem(key);
      if (!field) return;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else field.value = value ?? "";
    });
  }

  function nextSortOrder() {
    if (!state.products.length) return 10;
    return Math.max(...state.products.map((item) => Number(item.sort_order || 0))) + 10;
  }

  function productVisual(product) {
    if (product.image_url) {
      return `<img src="${escapeAttribute(product.image_url)}" alt="${escapeAttribute(product.name)}" />`;
    }
    return escapeHtml(product.emoji || "🥩");
  }

  function showImagePreview(url) {
    if (!url) return;
    $("imagePreview").innerHTML = `<img src="${escapeAttribute(url)}" alt="商品图片预览" />`;
    $("imagePreview").hidden = false;
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
    return message;
  }

  function toast(message) {
    const element = $("toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(window.__adminToast);
    window.__adminToast = window.setTimeout(() => element.classList.remove("show"), 2200);
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
