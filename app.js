const SETTINGS_KEY = "webcoder.settings";
const APP_STATE_KEY = "webcoder.appState";
const DB_NAME = "webcoder.workspace";
const DB_STORE = "handles";
const WORKSPACE_HANDLE_KEY = "workspace";
const MAX_VERSIONS = 20;

const state = {
  workspaceHandle: null,
  pendingWorkspaceHandle: null,
  projects: [],
  activeProjectId: null,
  previewMode: "desktop",
  previewObjectUrls: [],
  previewRenderId: 0,
  settings: loadSettings(),
  appState: loadAppState(),
  busy: false,
};

const els = {
  workspaceLabel: document.querySelector("#workspaceLabel"),
  projectList: document.querySelector("#projectList"),
  projectTitle: document.querySelector("#projectTitle"),
  previewStage: document.querySelector(".preview-stage"),
  previewFrame: document.querySelector("#previewFrame"),
  emptyConnectButton: document.querySelector("#emptyConnectButton"),
  connectFolderButton: document.querySelector("#connectFolderButton"),
  newProjectButton: document.querySelector("#newProjectButton"),
  htmlImportInput: document.querySelector("#htmlImportInput"),
  renameProjectButton: document.querySelector("#renameProjectButton"),
  deleteProjectButton: document.querySelector("#deleteProjectButton"),
  desktopPreviewButton: document.querySelector("#desktopPreviewButton"),
  mobilePreviewButton: document.querySelector("#mobilePreviewButton"),
  refreshPreviewButton: document.querySelector("#refreshPreviewButton"),
  saveButton: document.querySelector("#saveButton"),
  exportButton: document.querySelector("#exportButton"),
  undoButton: document.querySelector("#undoButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  languageInput: document.querySelector("#languageInput"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  modelInput: document.querySelector("#modelInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  chatMessages: document.querySelector("#chatMessages"),
  chatForm: document.querySelector("#chatForm"),
  promptInput: document.querySelector("#promptInput"),
  sendButton: document.querySelector("#sendButton"),
  statusText: document.querySelector("#statusText"),
  unsupportedBanner: document.querySelector("#unsupportedBanner"),
  toast: document.querySelector("#toast"),
};

void boot();

async function boot() {
  hydrateSettingsForm();
  bindEvents();
  render();

  if (!supportsFileSystemAccess()) {
    els.unsupportedBanner.hidden = false;
    setStatus("需要 Chrome/Edge");
    return;
  }

  await restoreWorkspace();
}

function bindEvents() {
  els.connectFolderButton.addEventListener("click", connectWorkspace);
  els.emptyConnectButton.addEventListener("click", connectWorkspace);
  els.newProjectButton.addEventListener("click", createWebsiteProject);
  els.htmlImportInput.addEventListener("change", importHTMLProject);
  els.renameProjectButton.addEventListener("click", renameActiveProject);
  els.deleteProjectButton.addEventListener("click", deleteActiveProject);
  els.desktopPreviewButton.addEventListener("click", () => setPreviewMode("desktop"));
  els.mobilePreviewButton.addEventListener("click", () => setPreviewMode("mobile"));
  els.refreshPreviewButton.addEventListener("click", refreshActiveProject);
  els.saveButton.addEventListener("click", saveActiveProject);
  els.exportButton.addEventListener("click", exportActiveProject);
  els.undoButton.addEventListener("click", restorePreviousVersion);
  els.settingsButton.addEventListener("click", openSettings);
  els.saveSettingsButton.addEventListener("click", saveSettings);
  els.chatForm.addEventListener("submit", submitPrompt);
}

async function connectWorkspace() {
  if (!supportsFileSystemAccess()) {
    showToast("请使用 Chrome 或 Edge 打开");
    return;
  }

  try {
    const restoredHandle = state.pendingWorkspaceHandle;
    const canUseRestoredHandle = restoredHandle && (await requestHandlePermission(restoredHandle));
    const handle = canUseRestoredHandle
      ? restoredHandle
      : await window.showDirectoryPicker({ mode: "readwrite" });
    await loadWorkspace(handle);
    showToast(canUseRestoredHandle ? "已恢复上次文件夹" : "已连接文件夹");
  } catch (error) {
    if (error?.name !== "AbortError") {
      clearWorkspace();
      showToast(error.message || "连接文件夹失败");
    }
  }
}

async function restoreWorkspace() {
  const handle = await readStoredWorkspaceHandle();
  if (!handle) return;

  state.pendingWorkspaceHandle = handle;
  els.workspaceLabel.textContent = state.appState.workspaceName || handle.name || "上次文件夹";
  setStatus("正在检查授权");
  renderProjects();

  const hasPermission = await queryHandlePermission(handle);
  if (!hasPermission) {
    setStatus("等待授权");
    showToast("点击连接文件夹恢复上次文件夹");
    updateControls();
    return;
  }

  try {
    await loadWorkspace(handle, { persistHandle: false });
  } catch (error) {
    clearWorkspace();
    showToast(error.message || "恢复文件夹失败，请重新连接");
  }
}

async function loadWorkspace(handle, options = {}) {
  const { persistHandle = true } = options;
  const projects = await scanWorkspace(handle);
  state.workspaceHandle = handle;
  state.pendingWorkspaceHandle = null;
  state.projects = projects;
  state.activeProjectId = projectByName(state.appState.activeProjectName)?.id || state.projects[0]?.id || null;
  if (persistHandle) {
    await storeWorkspaceHandle(handle);
  }
  persistAppState();
  render();
}

async function scanWorkspace(workspaceHandle = state.workspaceHandle) {
  if (!workspaceHandle) return [];

  const previousByName = new Map(state.projects.map((project) => [project.name, project]));
  const projects = [];

  try {
    for await (const [name, handle] of workspaceHandle.entries()) {
      if (handle.kind !== "directory") continue;

      const project = await readWebsiteProject(name, handle, previousByName.get(name));
      if (project) {
        projects.push(project);
      }
    }
  } catch (error) {
    throw new Error(`无法读取文件夹：${error.message || "请重新授权"}`);
  }

  projects.sort((a, b) => a.name.localeCompare(b.name, currentLanguage()));
  return projects;
}

async function readWebsiteProject(name, directoryHandle, previous) {
  try {
    const indexFileHandle = await directoryHandle.getFileHandle("index.html");
    const file = await indexFileHandle.getFile();
    const html = await file.text();
    return {
      id: previous?.id || crypto.randomUUID(),
      name,
      directoryHandle,
      indexFileHandle,
      html,
      updatedAt: file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString(),
      versions: previous?.versions || [],
      messages: previous?.messages || [],
    };
  } catch {
    // A folder without index.html is intentionally not a website project.
    return null;
  }
}

async function createWebsiteProject() {
  if (!ensureWorkspace()) return;

  const suggested = uniqueProjectName("新网站");
  const name = cleanProjectName(window.prompt("新网站名称", suggested));
  if (!name) return;

  try {
    const directoryHandle = await state.workspaceHandle.getDirectoryHandle(name, { create: true });
    const indexFileHandle = await directoryHandle.getFileHandle("index.html", { create: true });
    const html = defaultHTML(name);
    await writeFile(indexFileHandle, html);
    const project = {
      id: crypto.randomUUID(),
      name,
      directoryHandle,
      indexFileHandle,
      html,
      updatedAt: new Date().toISOString(),
      versions: [],
      messages: [],
    };
    state.projects.unshift(project);
    state.activeProjectId = project.id;
    persistAppState();
    render();
    showToast("已新建网站");
  } catch (error) {
    showToast(error.message || "新建网站失败");
  }
}

async function importHTMLProject(event) {
  if (!ensureWorkspace()) {
    event.target.value = "";
    return;
  }

  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  const fallbackName = file.name.replace(/\.(html|htm)$/i, "") || "导入网站";
  const name = uniqueProjectName(cleanProjectName(fallbackName));

  try {
    const html = await file.text();
    const directoryHandle = await state.workspaceHandle.getDirectoryHandle(name, { create: true });
    const indexFileHandle = await directoryHandle.getFileHandle("index.html", { create: true });
    await writeFile(indexFileHandle, html);
    const project = {
      id: crypto.randomUUID(),
      name,
      directoryHandle,
      indexFileHandle,
      html,
      updatedAt: new Date().toISOString(),
      versions: [],
      messages: [],
    };
    state.projects.unshift(project);
    state.activeProjectId = project.id;
    persistAppState();
    render();
    showToast("HTML 已导入");
  } catch (error) {
    showToast(error.message || "导入失败");
  }
}

async function renameActiveProject() {
  const project = activeProject();
  if (!project || !ensureWorkspace()) return;

  const nextName = cleanProjectName(window.prompt("重命名网站", project.name));
  if (!nextName || nextName === project.name) return;

  if (state.projects.some((item) => item.name === nextName)) {
    showToast("项目名称已存在");
    return;
  }

  try {
    const nextDirectoryHandle = await state.workspaceHandle.getDirectoryHandle(nextName, { create: true });
    await copyDirectory(project.directoryHandle, nextDirectoryHandle);
    await state.workspaceHandle.removeEntry(project.name, { recursive: true });
    const indexFileHandle = await nextDirectoryHandle.getFileHandle("index.html");
    project.name = nextName;
    project.directoryHandle = nextDirectoryHandle;
    project.indexFileHandle = indexFileHandle;
    project.updatedAt = new Date().toISOString();
    persistAppState();
    render();
    showToast("已重命名");
  } catch (error) {
    showToast(error.message || "重命名失败");
  }
}

async function deleteActiveProject() {
  const project = activeProject();
  if (!project || !ensureWorkspace()) return;
  if (!window.confirm(`删除网站项目“${project.name}”？此操作会删除对应文件夹。`)) return;

  try {
    await state.workspaceHandle.removeEntry(project.name, { recursive: true });
    state.projects = state.projects.filter((item) => item.id !== project.id);
    state.activeProjectId = state.projects[0]?.id || null;
    persistAppState();
    render();
    showToast("已删除网站项目");
  } catch (error) {
    showToast(error.message || "删除失败");
  }
}

function setPreviewMode(mode) {
  state.previewMode = mode;
  renderPreviewMode();
}

function renderPreviewMode() {
  els.desktopPreviewButton.classList.toggle("active", state.previewMode === "desktop");
  els.mobilePreviewButton.classList.toggle("active", state.previewMode === "mobile");
  els.previewFrame.classList.toggle("mobile", state.previewMode === "mobile");
}

async function refreshActiveProject() {
  const project = activeProject();
  if (!project) return;

  try {
    const file = await project.indexFileHandle.getFile();
    project.html = await file.text();
    project.updatedAt = file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString();
    render();
    showToast("预览已刷新");
  } catch (error) {
    showToast(error.message || "刷新失败");
  }
}

function render() {
  renderProjects();
  renderActiveProject();
  renderChat();
  renderPreviewMode();
  updateControls();
}

function renderProjects() {
  els.workspaceLabel.textContent = state.workspaceHandle?.name || state.appState.workspaceName || "未连接文件夹";
  els.projectList.innerHTML = "";

  if (!state.workspaceHandle) {
    const message = state.pendingWorkspaceHandle
      ? "上次文件夹需要重新授权。点击连接文件夹后会继续加载项目。"
      : "连接一个文件夹后，这里会显示网站项目。";
    els.projectList.append(emptyList(message));
    return;
  }

  if (state.projects.length === 0) {
    els.projectList.append(emptyList("没有发现包含 index.html 的一级子文件夹。"));
    return;
  }

  state.projects.forEach((project) => {
    const button = document.createElement("button");
    button.className = "project-button";
    button.type = "button";
    button.setAttribute("aria-current", String(project.id === state.activeProjectId));
    button.innerHTML = `<strong>${escapeHTML(project.name)}</strong><span>${formatDate(project.updatedAt)}</span>`;
    button.addEventListener("click", () => {
      state.activeProjectId = project.id;
      persistAppState();
      render();
    });
    els.projectList.append(button);
  });
}

function renderActiveProject() {
  const project = activeProject();
  els.projectTitle.textContent = project?.name || "请选择或连接网站项目";
  els.previewStage.classList.toggle("has-project", Boolean(project));
  setStatus(project ? "已就绪" : state.workspaceHandle ? "无项目" : "待连接");
  void renderPreview();
}

async function renderPreview() {
  const project = activeProject();
  const renderId = ++state.previewRenderId;
  revokePreviewObjectUrls();

  if (!project) {
    els.previewFrame.removeAttribute("src");
    els.previewFrame.srcdoc = "";
    return;
  }

  try {
    const html = await createPreviewHTML(project);
    if (renderId === state.previewRenderId) {
      els.previewFrame.removeAttribute("src");
      els.previewFrame.srcdoc = html;
    }
  } catch (error) {
    if (renderId === state.previewRenderId) {
      els.previewFrame.srcdoc = errorPreviewHTML(error);
    }
  }
}

async function createPreviewHTML(project) {
  const document = new DOMParser().parseFromString(project.html, "text/html");
  await rewritePreviewStyleResources(document, project);
  await rewritePreviewAttributeResources(document, project);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

async function rewritePreviewAttributeResources(document, project) {
  const resources = [
    ["img[src]", "src"],
    ["script[src]", "src"],
    ["iframe[src]", "src"],
    ["source[src]", "src"],
    ["video[src]", "src"],
    ["audio[src]", "src"],
    ["track[src]", "src"],
    ["embed[src]", "src"],
    ["object[data]", "data"],
    ["link[href]", "href"],
  ];

  for (const [selector, attribute] of resources) {
    const elements = Array.from(document.querySelectorAll(selector));
    for (const element of elements) {
      const value = element.getAttribute(attribute);
      if (!isLocalResourceURL(value)) continue;

      const objectUrl = await fileObjectURL(project.directoryHandle, value, "");
      if (objectUrl) {
        element.setAttribute(attribute, objectUrl);
      }
    }
  }
}

async function rewritePreviewStyleResources(document, project) {
  const styleElements = Array.from(document.querySelectorAll("style"));
  for (const styleElement of styleElements) {
    styleElement.textContent = await rewriteCssUrls(styleElement.textContent || "", project, "");
  }

  const styledElements = Array.from(document.querySelectorAll("[style]"));
  for (const element of styledElements) {
    element.setAttribute("style", await rewriteCssUrls(element.getAttribute("style") || "", project, ""));
  }

  const stylesheetLinks = Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'));
  for (const link of stylesheetLinks) {
    const href = link.getAttribute("href");
    if (!isLocalResourceURL(href)) continue;

    const css = await readTextFile(project.directoryHandle, href, "");
    if (!css) continue;

    const rewrittenCss = await rewriteCssUrls(css, project, basePathForResource(href));
    const objectUrl = URL.createObjectURL(new Blob([rewrittenCss], { type: "text/css;charset=utf-8" }));
    state.previewObjectUrls.push(objectUrl);
    link.setAttribute("href", objectUrl);
  }
}

async function rewriteCssUrls(css, project, basePath) {
  const matches = Array.from(css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi));
  let rewritten = css;

  for (const match of matches) {
    const rawUrl = match[2];
    if (!isLocalResourceURL(rawUrl)) continue;

    const objectUrl = await fileObjectURL(project.directoryHandle, rawUrl, basePath);
    if (objectUrl) {
      rewritten = rewritten.replace(match[0], `url("${objectUrl}")`);
    }
  }

  return rewritten;
}

async function fileObjectURL(rootHandle, resourcePath, basePath) {
  const file = await readFile(rootHandle, resourcePath, basePath);
  if (!file) return null;

  const type = file.type || mimeTypeForPath(resourcePath);
  const objectUrl = URL.createObjectURL(type ? new Blob([file], { type }) : file);
  state.previewObjectUrls.push(objectUrl);
  return objectUrl;
}

async function readTextFile(rootHandle, resourcePath, basePath) {
  const file = await readFile(rootHandle, resourcePath, basePath);
  return file ? file.text() : null;
}

async function readFile(rootHandle, resourcePath, basePath) {
  const pathParts = normalizeResourcePath(resourcePath, basePath);
  if (!pathParts.length) return null;

  try {
    let directoryHandle = rootHandle;
    for (const part of pathParts.slice(0, -1)) {
      directoryHandle = await directoryHandle.getDirectoryHandle(part);
    }
    const fileHandle = await directoryHandle.getFileHandle(pathParts.at(-1));
    return fileHandle.getFile();
  } catch {
    return null;
  }
}

function normalizeResourcePath(resourcePath, basePath) {
  const [withoutHash] = String(resourcePath).split("#");
  const [withoutQuery] = withoutHash.split("?");
  const rawPath = withoutQuery.startsWith("/") ? withoutQuery.slice(1) : `${basePath || ""}${withoutQuery}`;

  return rawPath
    .split("/")
    .map((part) => safeDecodeURIComponent(part.trim()))
    .reduce((parts, part) => {
      if (!part || part === ".") return parts;
      if (part === "..") {
        parts.pop();
      } else {
        parts.push(part);
      }
      return parts;
    }, []);
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function mimeTypeForPath(path) {
  const extension = String(path).split("?")[0].split("#")[0].split(".").pop()?.toLowerCase();
  return {
    css: "text/css",
    js: "text/javascript",
    mjs: "text/javascript",
    json: "application/json",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    ico: "image/x-icon",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
  }[extension] || "";
}

function basePathForResource(resourcePath) {
  const parts = normalizeResourcePath(resourcePath, "");
  return parts.length > 1 ? `${parts.slice(0, -1).join("/")}/` : "";
}

function isLocalResourceURL(value) {
  const url = String(value || "").trim();
  return Boolean(url) && !url.startsWith("#") && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
}

function revokePreviewObjectUrls() {
  state.previewObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.previewObjectUrls = [];
}

function errorPreviewHTML(error) {
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#111827">
  <main style="padding:28px">
    <h1 style="font-size:20px;margin:0 0 10px">预览加载失败</h1>
    <p style="margin:0;color:#667085">${escapeHTML(error.message || "无法读取项目资源")}</p>
  </main>
</body>
</html>`;
}

function renderChat() {
  const project = activeProject();
  els.chatMessages.innerHTML = "";

  if (!project) {
    els.chatMessages.append(emptyChat("选择一个网站项目后，就可以直接和 AI 对话修改页面。"));
    return;
  }

  if (!project.messages.length) {
    els.chatMessages.append(emptyChat("告诉 AI 你想怎么修改这个网站。AI 会直接更新当前项目的 index.html，并刷新中间预览。"));
    return;
  }

  project.messages.forEach((message) => {
    const item = document.createElement("article");
    item.className = `chat-message ${message.role}`;

    const role = document.createElement("strong");
    role.textContent = message.role === "assistant" ? "AI" : "你";

    const content = document.createElement("p");
    content.textContent = message.content;

    item.append(role, content);
    els.chatMessages.append(item);
  });

  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

async function submitPrompt(event) {
  event.preventDefault();
  const project = activeProject();
  const prompt = els.promptInput.value.trim();
  if (!project || !prompt || state.busy) return;

  if (!state.settings.baseUrl || !state.settings.apiKey) {
    showToast("请先在设置中填写 base URL 和 API Key");
    openSettings();
    return;
  }

  project.messages.push({ role: "user", content: prompt, at: new Date().toISOString() });
  els.promptInput.value = "";
  setBusy(true, "AI 修改中");
  renderChat();

  try {
    const result = await tryRemoteChat(prompt, project);
    if (result.html) {
      saveVersion(project, "ai");
      project.html = result.html;
      await writeFile(project.indexFileHandle, project.html);
      project.updatedAt = new Date().toISOString();
    }
    project.messages.push({
      role: "assistant",
      content: result.reply || "已根据你的要求更新网站。",
      at: new Date().toISOString(),
    });
    render();
    showToast(result.html ? "AI 已修改并保存" : "AI 已回复");
  } catch (error) {
    project.messages.push({
      role: "assistant",
      content: `远程模型不可用：${error.message || "请求失败"}`,
      at: new Date().toISOString(),
    });
    renderChat();
    setStatus("模型不可用");
    showToast("远程模型不可用");
  } finally {
    setBusy(false, activeProject() ? "已就绪" : "待连接");
  }
}

async function tryRemoteChat(prompt, project) {
  const response = await fetch(joinURL(state.settings.baseUrl, "chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.settings.apiKey}`,
    },
    body: JSON.stringify({
      model: state.settings.model || "gpt-4.1-mini",
      temperature: 0.25,
      messages: buildRemoteMessages(prompt, project),
    }),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("empty response");
  return parseAssistantContent(content);
}

function buildRemoteMessages(prompt, project) {
  const history = project.messages
    .slice(-10, -1)
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));

  return [
    {
      role: "system",
      content: [
        "你是 WebCoder 的网站设计与 HTML 修改助手。",
        "用户正在管理一个本地网站项目，你只能修改当前项目的 index.html。",
        "请和用户简短对话，并在需要修改页面时返回完整 HTML。",
        "只返回 JSON，不要 Markdown 代码块。",
        'JSON 格式：{"reply":"给用户的简短中文回复","html":"完整 HTML；如果不需要改代码可省略"}',
      ].join("\n"),
    },
    { role: "user", content: `当前 index.html:\n${project.html.slice(0, 16000)}` },
    ...history,
    { role: "user", content: `用户请求:\n${prompt}` },
  ];
}

function parseAssistantContent(content) {
  const stripped = stripCodeFence(content);

  try {
    const parsed = JSON.parse(stripped);
    return {
      reply: parsed.reply || "已处理。",
      html: parsed.html || null,
    };
  } catch {
    if (/<!doctype html|<html[\s>]/i.test(stripped)) {
      return { reply: "已根据你的要求更新网站。", html: stripped };
    }
    return { reply: stripped, html: null };
  }
}

async function saveActiveProject() {
  const project = activeProject();
  if (!project) return;

  try {
    await writeFile(project.indexFileHandle, project.html);
    project.updatedAt = new Date().toISOString();
    renderProjects();
    showToast("已保存到 index.html");
  } catch (error) {
    showToast(error.message || "保存失败");
  }
}

function exportActiveProject() {
  const project = activeProject();
  if (!project) return;

  const blob = new Blob([project.html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.name || "index"}.html`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("已导出 HTML");
}

async function restorePreviousVersion() {
  const project = activeProject();
  if (!project || !project.versions.length) {
    showToast("没有可撤销的版本");
    return;
  }

  const previous = project.versions.pop();
  project.html = previous.html;
  project.updatedAt = new Date().toISOString();

  try {
    await writeFile(project.indexFileHandle, project.html);
    render();
    showToast("已撤销并保存");
  } catch (error) {
    showToast(error.message || "撤销失败");
  }
}

function openSettings() {
  hydrateSettingsForm();
  els.settingsDialog.showModal();
}

function saveSettings() {
  state.settings = {
    language: currentLanguage(els.languageInput.value),
    baseUrl: els.baseUrlInput.value.trim() || "https://api.openai.com/v1",
    model: els.modelInput.value.trim() || "gpt-4.1-mini",
    apiKey: els.apiKeyInput.value.trim(),
  };
  persistSettings();
  document.documentElement.lang = state.settings.language;
  showToast("设置已保存");
}

function hydrateSettingsForm() {
  els.languageInput.value = currentLanguage(state.settings.language);
  els.baseUrlInput.value = state.settings.baseUrl || "https://api.openai.com/v1";
  els.modelInput.value = state.settings.model || "gpt-4.1-mini";
  els.apiKeyInput.value = state.settings.apiKey || "";
  document.documentElement.lang = currentLanguage(state.settings.language);
}

function updateControls() {
  const hasWorkspace = Boolean(state.workspaceHandle);
  const hasProject = Boolean(activeProject());
  els.newProjectButton.disabled = !hasWorkspace;
  els.htmlImportInput.disabled = !hasWorkspace;
  els.renameProjectButton.disabled = !hasProject;
  els.deleteProjectButton.disabled = !hasProject;
  els.refreshPreviewButton.disabled = !hasProject;
  els.saveButton.disabled = !hasProject;
  els.exportButton.disabled = !hasProject;
  els.undoButton.disabled = !hasProject || !activeProject()?.versions.length;
  els.promptInput.disabled = !hasProject || state.busy;
  els.sendButton.disabled = !hasProject || state.busy;
}

function setBusy(isBusy, label) {
  state.busy = isBusy;
  setStatus(label);
  updateControls();
}

function setStatus(label) {
  els.statusText.textContent = label;
}

function activeProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || null;
}

function projectByName(name) {
  return state.projects.find((project) => project.name === name) || null;
}

function ensureWorkspace() {
  if (state.workspaceHandle) return true;
  showToast(state.pendingWorkspaceHandle ? "请先恢复文件夹授权" : "请先连接文件夹");
  return false;
}

function clearWorkspace() {
  state.workspaceHandle = null;
  state.pendingWorkspaceHandle = null;
  state.projects = [];
  state.activeProjectId = null;
  render();
}

function saveVersion(project, reason) {
  project.versions.push({
    html: project.html,
    reason,
    savedAt: new Date().toISOString(),
  });
  project.versions = project.versions.slice(-MAX_VERSIONS);
}

async function writeFile(fileHandle, content) {
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function copyDirectory(sourceHandle, targetHandle) {
  for await (const [name, handle] of sourceHandle.entries()) {
    if (handle.kind === "file") {
      const file = await handle.getFile();
      const targetFileHandle = await targetHandle.getFileHandle(name, { create: true });
      await writeFile(targetFileHandle, await file.arrayBuffer());
    } else if (handle.kind === "directory") {
      const childTargetHandle = await targetHandle.getDirectoryHandle(name, { create: true });
      await copyDirectory(handle, childTargetHandle);
    }
  }
}

function defaultHTML(name) {
  const title = escapeHTML(name || "新网站");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin: 0; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #111827; }
    main { max-width: 880px; margin: 0 auto; padding: 80px 24px; }
    h1 { margin: 0 0 16px; font-size: clamp(36px, 8vw, 72px); line-height: 1.02; letter-spacing: 0; }
    p { max-width: 640px; margin: 0; color: #475569; font-size: 19px; line-height: 1.7; }
    a { display: inline-block; margin-top: 28px; padding: 12px 16px; border-radius: 8px; background: #2563eb; color: white; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>这是一个由 WebCoder 创建的本地 HTML 网站。你可以在右侧告诉 AI 想怎么修改它。</p>
    <a href="#">开始编辑</a>
  </main>
</body>
</html>`;
}

function emptyList(message) {
  const item = document.createElement("p");
  item.className = "empty-chat";
  item.textContent = message;
  return item;
}

function emptyChat(message) {
  const item = document.createElement("p");
  item.className = "empty-chat";
  item.textContent = message;
  return item;
}

function cleanProjectName(value) {
  return (value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function uniqueProjectName(baseName) {
  const base = cleanProjectName(baseName) || "新网站";
  const names = new Set(state.projects.map((project) => project.name));
  if (!names.has(base)) return base;

  let index = 2;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || defaultSettings();
  } catch {
    return defaultSettings();
  }
}

function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function loadAppState() {
  try {
    return JSON.parse(localStorage.getItem(APP_STATE_KEY)) || {};
  } catch {
    return {};
  }
}

function persistAppState() {
  const project = activeProject();
  state.appState = {
    activeProjectName: project?.name || null,
    workspaceName: state.workspaceHandle?.name || null,
  };
  localStorage.setItem(APP_STATE_KEY, JSON.stringify(state.appState));
}

async function storeWorkspaceHandle(handle) {
  const db = await openWorkspaceDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).put(handle, WORKSPACE_HANDLE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function readStoredWorkspaceHandle() {
  try {
    const db = await openWorkspaceDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, "readonly");
      const request = transaction.objectStore(DB_STORE).get(WORKSPACE_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

function openWorkspaceDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function queryHandlePermission(handle) {
  if (!handle?.queryPermission) return false;
  return (await handle.queryPermission({ mode: "readwrite" })) === "granted";
}

async function requestHandlePermission(handle) {
  if (await queryHandlePermission(handle)) return true;
  if (!handle?.requestPermission) return false;
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}

function defaultSettings() {
  return {
    language: "zh-CN",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiKey: "",
  };
}

function currentLanguage(language = state.settings.language) {
  return language === "en-US" ? "en-US" : "zh-CN";
}

function supportsFileSystemAccess() {
  return "showDirectoryPicker" in window;
}

function joinURL(base, path) {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function stripCodeFence(value) {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString(currentLanguage(), {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 1800);
}
