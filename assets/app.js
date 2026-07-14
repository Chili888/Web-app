(() => {
  "use strict";

  const DEFAULT_SETTINGS = {
    id: 1,
    shop_name: "国内精品肉铺",
    shop_subtitle: "商品浏览 · 选品咨询",
    hero_tag: "国内精品 · 实时咨询",
    hero_title: "浏览全部商品，选好再咨询",
    hero_text: "查看商品详情、价格、库存及配送说明。将感兴趣的商品加入选品清单后，可整体分享或一键联系官方客服。",
    bot_username: "TJ_ice_CS_bot",
    channel_username: "TJ_NO1_ice",
    group_username: "TJ_ice_Group",
    price_notice: "页面为参考或实时询价，最终价格以客服确认为准。",
    stock_notice: "库存随时变化，下单前请先咨询当日库存与规格。",
    delivery_notice: "配送范围、时效及售后标准由客服根据地区说明。",
    anti_fraud_notice: "仅认准官方客服、频道和群组，不向其他账号付款。"
  };

  const DEMO_PRODUCTS = [
    {id:1,name:"高品质猪肉",category:"猪肉",emoji:"🥩",price_text:"实时询价",stock_text:"当日库存",description:"高品质猪肉占位商品，可替换为具体部位、重量、产地和规格说明。",image_url:"",is_active:true,sort_order:10},
    {id:2,name:"XX1",category:"猪肉",emoji:"🍖",price_text:"实时询价",stock_text:"咨询库存",description:"XX1 占位模板，可在后台修改商品名称、图片、分类、价格与详情。",image_url:"",is_active:true,sort_order:20},
    {id:3,name:"XX2",category:"精品",emoji:"🥓",price_text:"咨询报价",stock_text:"当日库存",description:"XX2 占位模板，适合展示精品肉类或组合商品。",image_url:"",is_active:true,sort_order:30},
    {id:4,name:"XX3",category:"精品",emoji:"🍗",price_text:"咨询报价",stock_text:"咨询库存",description:"XX3 占位模板，后续可替换为正式商品资料。",image_url:"",is_active:true,sort_order:40},
    {id:5,name:"家庭鲜肉组合",category:"组合",emoji:"🧺",price_text:"套餐询价",stock_text:"可预订",description:"家庭组合占位商品，可填写具体搭配、重量和配送范围。",image_url:"",is_active:true,sort_order:50},
    {id:6,name:"精选排骨",category:"猪肉",emoji:"🍖",price_text:"实时询价",stock_text:"当日库存",description:"精选排骨占位商品，实际价格和规格请联系官方客服。",image_url:"",is_active:true,sort_order:60},
    {id:7,name:"精品牛肉",category:"牛肉",emoji:"🥩",price_text:"实时询价",stock_text:"咨询库存",description:"精品牛肉占位商品，可补充部位、等级和包装规格。",image_url:"",is_active:true,sort_order:70},
    {id:8,name:"其他生鲜需求",category:"其他",emoji:"🛒",price_text:"咨询报价",stock_text:"联系客服",description:"没有找到需要的商品，可将具体需求直接发送给客服。",image_url:"",is_active:true,sort_order:80}
  ];

  const state = {
    settings: {...DEFAULT_SETTINGS},
    products: [],
    selected: readSelected(),
    activeCategory: "全部",
    current: null,
    supabase: null,
    usingDemo: false
  };

  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    initTelegram();
    bindEvents();
    applySettings();
    updateCount();

    const config = window.APP_CONFIG || {};
    const configured = Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase?.createClient);

    if (!configured) {
      useDemo("后台尚未连接，当前显示演示商品。完成 Supabase 配置后即可在后台管理。");
      return;
    }

    state.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

    try {
      await Promise.all([loadSettings(), loadProducts()]);
      state.usingDemo = false;
      $("modeNotice").hidden = true;
      subscribeChanges();
    } catch (error) {
      console.error(error);
      useDemo("数据库暂时无法连接，当前显示演示商品。");
    }
  }

  function initTelegram() {
    try {
      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
      }
    } catch (error) {
      console.warn("Telegram WebApp initialization failed:", error);
    }
  }

  function bindEvents() {
    $("search").addEventListener("input", renderProducts);

    document.addEventListener("click", (event) => {
      const actionElement = event.target.closest("[data-action]");
      if (actionElement) {
        const action = actionElement.dataset.action;
        const id = Number(actionElement.dataset.id);
        const handlers = {
          "scroll-products": () => $("products").scrollIntoView(),
          "open-selected": openSelected,
          "share-selected": shareSelected,
          "consult-selected": consultSelected,
          "close-detail": () => closeSheet("detailShade"),
          "close-selected": () => closeSheet("selectedShade"),
          "share-current": shareCurrent,
          "add-current": addCurrent,
          "set-category": () => setCategory(actionElement.dataset.category),
          "show-detail": () => showDetail(id),
          "toggle-select": () => toggleSelect(id),
          "remove-selected": () => removeSelected(id)
        };
        handlers[action]?.();
      }

      const shade = event.target.closest("[data-close-sheet]");
      if (shade && event.target === shade) {
        closeSheet(shade.dataset.closeSheet);
      }
    });
  }

  async function loadSettings() {
    const { data, error } = await state.supabase
      .from("store_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) throw error;
    state.settings = {...DEFAULT_SETTINGS, ...(data || {})};
    applySettings();
  }

  async function loadProducts() {
    const { data, error } = await state.supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", {ascending: true})
      .order("id", {ascending: false});

    if (error) throw error;
    state.products = data || [];
    renderCategories();
    renderProducts();
  }

  function subscribeChanges() {
    try {
      state.supabase
        .channel("shop-public-updates")
        .on("postgres_changes", {event: "*", schema: "public", table: "products"}, loadProducts)
        .on("postgres_changes", {event: "*", schema: "public", table: "store_settings"}, loadSettings)
        .subscribe();
    } catch (error) {
      console.warn("Realtime subscription skipped:", error);
    }
  }

  function useDemo(message) {
    state.usingDemo = true;
    state.settings = {...DEFAULT_SETTINGS};
    state.products = DEMO_PRODUCTS.map((item) => ({...item}));
    applySettings();
    renderCategories();
    renderProducts();
    const notice = $("modeNotice");
    notice.textContent = message;
    notice.hidden = false;
  }

  function applySettings() {
    const s = state.settings;
    document.title = s.shop_name || DEFAULT_SETTINGS.shop_name;
    $("shopName").textContent = s.shop_name;
    $("shopSubtitle").textContent = s.shop_subtitle;
    $("heroTag").textContent = s.hero_tag;
    $("heroTitle").textContent = s.hero_title;
    $("heroText").textContent = s.hero_text;
    $("priceNotice").textContent = s.price_notice;
    $("stockNotice").textContent = s.stock_notice;
    $("deliveryNotice").textContent = s.delivery_notice;
    $("fraudNotice").textContent = s.anti_fraud_notice;
    $("consultButton").textContent = `联系 @${normalizeUsername(s.bot_username)}`;
    $("channelLink").href = telegramLink(s.channel_username);
    $("groupLink").href = telegramLink(s.group_username);
  }

  function normalizeUsername(value) {
    return String(value || "").trim().replace(/^@/, "");
  }

  function telegramLink(username) {
    const clean = normalizeUsername(username);
    return clean ? `https://t.me/${clean}` : "#";
  }

  function categories() {
    return ["全部", ...new Set(state.products.map((product) => product.category || "其他"))];
  }

  function renderCategories() {
    $("cats").innerHTML = categories().map((category) => `
      <button
        class="cat ${category === state.activeCategory ? "active" : ""}"
        type="button"
        data-action="set-category"
        data-category="${escapeHtml(category)}"
      >${escapeHtml(category)}</button>
    `).join("");
  }

  function setCategory(category) {
    state.activeCategory = category;
    renderCategories();
    renderProducts();
  }

  function renderProducts() {
    const query = $("search").value.trim().toLowerCase();
    const filtered = state.products.filter((product) => {
      const categoryMatch = state.activeCategory === "全部" || product.category === state.activeCategory;
      const haystack = `${product.name || ""} ${product.category || ""} ${product.description || ""}`.toLowerCase();
      return categoryMatch && haystack.includes(query);
    });

    $("resultCount").textContent = `共 ${filtered.length} 件`;

    $("grid").innerHTML = filtered.length
      ? filtered.map(productCard).join("")
      : '<div class="empty">没有找到相关商品</div>';
  }

  function productCard(product) {
    const selected = state.selected.includes(Number(product.id));
    return `
      <article class="card">
        <div class="pic">${productVisual(product)}</div>
        <div class="cardBody">
          <h3>${escapeHtml(product.name)}</h3>
          <div class="meta">
            <span class="pill">${escapeHtml(product.category || "其他")}</span>
            <span class="pill">${escapeHtml(product.stock_text || "咨询库存")}</span>
          </div>
          <div class="price">${escapeHtml(product.price_text || "实时询价")}</div>
          <div class="actions">
            <button class="detailBtn" type="button" data-action="show-detail" data-id="${Number(product.id)}">查看详情</button>
            <button class="addBtn" type="button" data-action="toggle-select" data-id="${Number(product.id)}">${selected ? "已选" : "加入选品"}</button>
          </div>
        </div>
      </article>
    `;
  }

  function productVisual(product) {
    if (product.image_url) {
      return `<img src="${escapeAttribute(product.image_url)}" alt="${escapeAttribute(product.name)}" loading="lazy" />`;
    }
    return escapeHtml(product.emoji || "🥩");
  }

  function toggleSelect(id) {
    state.selected = state.selected.includes(id)
      ? state.selected.filter((value) => value !== id)
      : [...state.selected, id];

    saveSelected();
    renderProducts();
    toast(state.selected.includes(id) ? "已加入选品" : "已移出选品");
  }

  function showDetail(id) {
    state.current = state.products.find((product) => Number(product.id) === id);
    if (!state.current) return;

    const product = state.current;
    $("detailName").textContent = product.name || "";
    $("detailPic").innerHTML = productVisual(product);
    $("detailMeta").innerHTML = `
      <span class="pill">${escapeHtml(product.category || "其他")}</span>
      <span class="pill">${escapeHtml(product.stock_text || "咨询库存")}</span>
    `;
    $("detailPrice").textContent = product.price_text || "实时询价";
    $("detailDesc").textContent = product.description || "暂无详细介绍";
    $("detailShade").classList.add("show");
  }

  function addCurrent() {
    if (!state.current) return;
    const id = Number(state.current.id);
    if (!state.selected.includes(id)) state.selected.push(id);
    saveSelected();
    renderProducts();
    closeSheet("detailShade");
    toast("已加入选品");
  }

  function shareCurrent() {
    if (state.current) shareText(productText(state.current));
  }

  function productText(product) {
    return [
      `【${state.settings.shop_name}】`,
      `商品：${product.name}`,
      `分类：${product.category || "其他"}`,
      `价格：${product.price_text || "实时询价"}`,
      `库存：${product.stock_text || "咨询库存"}`,
      pageUrl()
    ].join("\n");
  }

  function selectedProducts() {
    return state.selected
      .map((id) => state.products.find((product) => Number(product.id) === id))
      .filter(Boolean);
  }

  function selectedText() {
    const list = selectedProducts();
    if (!list.length) return "";
    return [
      `【${state.settings.shop_name}·选品清单】`,
      ...list.map((product, index) =>
        `${index + 1}. ${product.name}｜${product.price_text || "实时询价"}｜${product.stock_text || "咨询库存"}`
      ),
      "",
      `官方客服：@${normalizeUsername(state.settings.bot_username)}`,
      pageUrl()
    ].join("\n");
  }

  async function shareText(text) {
    if (!text) {
      toast("请先选择商品");
      return;
    }

    try {
      if (navigator.share) {
        await navigator.share({title: state.settings.shop_name, text, url: pageUrl()});
        return;
      }

      await copyText(text);
      window.open(
        `https://t.me/share/url?url=${encodeURIComponent(pageUrl())}&text=${encodeURIComponent(text)}`,
        "_blank",
        "noopener"
      );
    } catch (error) {
      if (error?.name === "AbortError") return;
      try {
        await copyText(text);
        toast("内容已复制");
      } catch {
        toast("请手动复制");
      }
    }
  }

  function shareSelected() {
    shareText(selectedText());
  }

  async function consultSelected() {
    const text = selectedText() || "您好，我想咨询店内商品、价格和库存。";
    try {
      await copyText(text);
      toast("选品信息已复制，正在打开客服");
    } catch {
      toast("正在打开客服");
    }

    const bot = normalizeUsername(state.settings.bot_username);
    if (!bot) {
      toast("尚未配置客服账号");
      return;
    }
    setTimeout(() => window.open(`https://t.me/${bot}`, "_blank", "noopener"), 350);
  }

  function openSelected() {
    const list = selectedProducts();
    $("selectedList").innerHTML = list.length
      ? list.map((product) => `
          <div class="listItem">
            <div>
              <b>${escapeHtml(product.name)}</b>
              <div class="mini">${escapeHtml(product.price_text || "实时询价")} · ${escapeHtml(product.stock_text || "咨询库存")}</div>
            </div>
            <button class="remove" type="button" data-action="remove-selected" data-id="${Number(product.id)}">移除</button>
          </div>
        `).join("")
      : '<div class="empty">暂未选择商品</div>';

    $("selectedShade").classList.add("show");
  }

  function removeSelected(id) {
    state.selected = state.selected.filter((value) => value !== id);
    saveSelected();
    renderProducts();
    openSelected();
  }

  function readSelected() {
    try {
      const parsed = JSON.parse(localStorage.getItem("meat_selected") || "[]");
      return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
    } catch {
      return [];
    }
  }

  function saveSelected() {
    localStorage.setItem("meat_selected", JSON.stringify(state.selected));
    updateCount();
  }

  function updateCount() {
    $("topCount").textContent = String(state.selected.length);
  }

  function closeSheet(id) {
    $(id).classList.remove("show");
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Copy failed");
  }

  function pageUrl() {
    return window.APP_CONFIG?.pageUrl || window.location.href.split("?")[0];
  }

  function toast(message) {
    const element = $("toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = window.setTimeout(() => element.classList.remove("show"), 1800);
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
