/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");
const profileBtn = document.getElementById("profileBtn");
const profileOverlay = document.getElementById("profileOverlay");
const profileContent = document.getElementById("profileContent");
const closeProfileBtn = document.getElementById("closeProfileBtn");
const clearProfileBtn = document.getElementById("clearProfileBtn");
const clearProfileBtnIcon = clearProfileBtn.querySelector(".material-icons");
const clearProfileBtnLabel = clearProfileBtn.querySelector("span:last-child");

/* Cloudflare Worker endpoint */
const workerURL = "https://08-prj-loreal-chatbot.ryhschwa.workers.dev/";

/* Store user/assistant messages for multi-turn context */
const conversationHistory = [];
const userProfile = {
  name: "",
  skinType: "",
  concerns: [],
  budget: "",
  fragrancePreference: "",
};

let clearIsArmed = false;
let clearArmTimeoutId = null;
let editingProfileField = "";

/* System prompt: keeps the assistant focused on L'Oreal & beauty */
const systemPrompt = `You are the L'Oreal Beauty Advisor chatbot.
Only answer questions related to L'Oreal products, beauty routines, beauty recommendations, skincare, makeup, haircare, fragrance, shade selection, and ingredient guidance.
If a question is outside beauty or unrelated to L'Oreal topics, politely refuse in one short sentence and redirect the user to ask about L'Oreal beauty products or routines.
Keep responses concise, clear, and beginner-friendly.`;

const extractionPrompt = `You extract beauty profile details from ONE user message.
Return only valid JSON with this exact shape:
{
  "name": "",
  "skinType": "",
  "concerns": [],
  "budget": "",
  "fragrancePreference": ""
}

Rules:
- Use empty string or empty array when unknown.
- Never guess missing details.
- If present, skinType must be one of: oily, dry, combination, normal, sensitive.
- concerns should be short labels like acne, dark spots, dullness, redness, frizz, dryness, anti-aging.
- Return JSON only. No markdown and no extra text.`;

const cleaningPrompt = `You clean and validate profile data for a beauty chatbot.
Return only valid JSON with this exact shape:
{
  "name": "",
  "skinType": "",
  "concerns": [],
  "budget": "",
  "fragrancePreference": ""
}

Rules:
- Remove nonsense or unrelated values by setting them to empty string or empty array.
- skinType must be one of: oily, dry, combination, normal, sensitive.
- concerns must be an array of short beauty concern labels, such as acne, dark spots, dullness, redness, frizz, dryness, anti-aging.
- Keep valid values and normalize capitalization.
- Return JSON only. No markdown and no extra text.`;

function appendMessage(role, content) {
  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.textContent = content;

  row.appendChild(bubble);
  chatWindow.appendChild(row);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  return row;
}

function appendThinkingMessage() {
  const row = document.createElement("div");
  row.className = "message-row assistant thinking-row";

  const bubble = document.createElement("div");
  bubble.className = "bubble assistant thinking-bubble";

  const srText = document.createElement("span");
  srText.className = "visually-hidden";
  srText.textContent = "Assistant is thinking";

  const dots = document.createElement("span");
  dots.className = "thinking-dots";
  dots.setAttribute("aria-hidden", "true");

  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement("span");
    dot.className = "thinking-dot";
    dots.appendChild(dot);
  }

  bubble.appendChild(srText);
  bubble.appendChild(dots);

  row.appendChild(bubble);
  chatWindow.appendChild(row);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  return row;
}

function removeThinkingMessage(thinkingRow) {
  if (!thinkingRow || !thinkingRow.parentNode) {
    return;
  }

  thinkingRow.remove();
}

function renderInitialAssistantMessage() {
  appendMessage(
    "assistant",
    "Hello. I can help with L'Oreal products, beauty routines, and recommendations.",
  );
}

function clearChatWindow() {
  chatWindow.innerHTML = "";
  renderInitialAssistantMessage();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toTitleCase(text) {
  return text
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toSentenceCase(text) {
  const trimmed = text.trim();

  if (!trimmed) {
    return "";
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function formatProfileValueForDisplay(field, value) {
  if (Array.isArray(value)) {
    return value.map((item) => toTitleCase(item)).join(", ");
  }

  if (field === "name") {
    return toTitleCase(value);
  }

  if (field === "skinType") {
    return toTitleCase(value);
  }

  if (field === "budget" || field === "fragrancePreference") {
    return toSentenceCase(value);
  }

  return String(value).trim();
}

function getRecordedProfileEntries() {
  const entries = [];

  if (userProfile.name) {
    entries.push({ field: "name", label: "Name", value: userProfile.name });
  }

  if (userProfile.skinType) {
    entries.push({
      field: "skinType",
      label: "Skin Type",
      value: userProfile.skinType,
    });
  }

  if (userProfile.concerns.length > 0) {
    entries.push({
      field: "concerns",
      label: "Concerns",
      value: userProfile.concerns,
    });
  }

  if (userProfile.budget) {
    entries.push({
      field: "budget",
      label: "Budget",
      value: userProfile.budget,
    });
  }

  if (userProfile.fragrancePreference) {
    entries.push({
      field: "fragrancePreference",
      label: "Fragrance Preference",
      value: userProfile.fragrancePreference,
    });
  }

  return entries;
}

function renderProfileContent() {
  const entries = getRecordedProfileEntries();

  if (entries.length === 0) {
    profileContent.innerHTML =
      '<p class="profile-empty">Talk to our chatbot to share your preferences.</p>';
    return;
  }

  profileContent.innerHTML = entries
    .map((entry) => {
      const displayValue = formatProfileValueForDisplay(
        entry.field,
        entry.value,
      );
      const isEditing = editingProfileField === entry.field;
      const editValue = escapeHtml(getCurrentProfileValueAsString(entry.field));

      const valueMarkup = isEditing
        ? `
          <div class="profile-inline-edit" data-field="${entry.field}">
            <input
              type="text"
              class="profile-inline-edit__input"
              data-field="${entry.field}"
              value="${editValue}"
              placeholder="Type a value"
            />
            <div class="profile-inline-edit__actions">
              <button type="button" class="profile-inline-edit__btn save" data-action="save" data-field="${entry.field}">Save</button>
              <button type="button" class="profile-inline-edit__btn cancel" data-action="cancel" data-field="${entry.field}">Cancel</button>
            </div>
          </div>
        `
        : `<p class="profile-card__value">${escapeHtml(displayValue)}</p>`;

      return `
        <article class="profile-card ${isEditing ? "is-editing" : ""}" data-field="${entry.field}">
          <div class="profile-card__top">
            <h3>${escapeHtml(entry.label)}</h3>
            <button
              type="button"
              class="profile-card__edit icon-button icon-button--ghost"
              data-field="${entry.field}"
              aria-label="Edit ${escapeHtml(entry.label)}"
            >
              <span class="material-icons" aria-hidden="true">edit</span>
            </button>
          </div>
          ${valueMarkup}
        </article>
      `;
    })
    .join("");

  if (editingProfileField) {
    const activeInput = profileContent.querySelector(
      `.profile-inline-edit__input[data-field="${editingProfileField}"]`,
    );

    if (activeInput) {
      activeInput.focus();
      activeInput.setSelectionRange(
        activeInput.value.length,
        activeInput.value.length,
      );
    }
  }
}

function applyProfileEdit(field, rawValue) {
  const value = rawValue.trim();

  if (field === "name") {
    userProfile.name = toTitleCase(value);
    return;
  }

  if (field === "skinType") {
    userProfile.skinType = value.toLowerCase();
    return;
  }

  if (field === "concerns") {
    userProfile.concerns = value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 6);
    return;
  }

  if (field === "budget") {
    userProfile.budget = value;
    return;
  }

  if (field === "fragrancePreference") {
    userProfile.fragrancePreference = value;
  }
}

function setProfileFieldValue(field, value) {
  if (field === "concerns") {
    userProfile.concerns = Array.isArray(value) ? value : [];
    return;
  }

  if (field in userProfile) {
    userProfile[field] = typeof value === "string" ? value : "";
  }
}

function getCurrentProfileValueAsString(field) {
  if (field === "concerns") {
    return userProfile.concerns.join(", ");
  }

  return userProfile[field] || "";
}

function getProfileFieldLabel(field) {
  const labels = {
    name: "Name",
    skinType: "Skin Type",
    concerns: "Concerns",
    budget: "Budget",
    fragrancePreference: "Fragrance Preference",
  };

  return labels[field] || "Profile Field";
}

function parseJsonFromModelContent(rawContent) {
  if (!rawContent) {
    return null;
  }

  try {
    return JSON.parse(rawContent);
  } catch {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  }
}

function buildCandidateProfileWithEditedField(field, rawValue) {
  const candidate = {
    name: userProfile.name,
    skinType: userProfile.skinType,
    concerns: [...userProfile.concerns],
    budget: userProfile.budget,
    fragrancePreference: userProfile.fragrancePreference,
  };

  if (field === "concerns") {
    candidate.concerns = rawValue
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return candidate;
  }

  if (field in candidate) {
    candidate[field] = rawValue.trim();
  }

  return candidate;
}

async function cleanProfileWithModel(
  profileCandidate,
  contextDescription = "",
) {
  const messages = [
    { role: "system", content: cleaningPrompt },
    {
      role: "user",
      content: `Context: ${contextDescription}\nProfile candidate JSON: ${JSON.stringify(profileCandidate)}`,
    },
  ];

  try {
    const data = await callWorker(messages);
    const rawContent = data?.choices?.[0]?.message?.content?.trim();
    const parsed = parseJsonFromModelContent(rawContent);

    if (!parsed) {
      return normalizeProfile(profileCandidate);
    }

    return normalizeProfile(parsed);
  } catch (error) {
    console.warn("Profile cleaning skipped:", error);
    return normalizeProfile(profileCandidate);
  }
}

function startInlineProfileEdit(field) {
  editingProfileField = field;
  renderProfileContent();
}

function cancelInlineProfileEdit() {
  editingProfileField = "";
  renderProfileContent();
}

async function commitInlineProfileEdit(field) {
  const input = profileContent.querySelector(
    `.profile-inline-edit__input[data-field="${field}"]`,
  );

  if (!input) {
    return;
  }

  const candidate = buildCandidateProfileWithEditedField(field, input.value);
  const cleanedProfile = await cleanProfileWithModel(
    candidate,
    `User manually edited ${field}`,
  );

  setProfileFieldValue(field, cleanedProfile[field]);
  saveConversation();
  editingProfileField = "";
  renderProfileContent();
}

function openProfileWindow() {
  renderProfileContent();
  profileOverlay.classList.remove("hidden");
  profileOverlay.setAttribute("aria-hidden", "false");
  profileBtn.setAttribute("aria-expanded", "true");
}

function closeProfileWindow() {
  profileOverlay.classList.add("hidden");
  profileOverlay.setAttribute("aria-hidden", "true");
  profileBtn.setAttribute("aria-expanded", "false");
  editingProfileField = "";
  resetClearConfirmationState();
}

function toggleProfileWindow() {
  if (profileOverlay.classList.contains("hidden")) {
    openProfileWindow();
    return;
  }

  closeProfileWindow();
}

function resetProfileState() {
  userProfile.name = "";
  userProfile.skinType = "";
  userProfile.concerns = [];
  userProfile.budget = "";
  userProfile.fragrancePreference = "";
}

function resetClearConfirmationState() {
  clearIsArmed = false;

  if (clearArmTimeoutId) {
    clearTimeout(clearArmTimeoutId);
    clearArmTimeoutId = null;
  }

  clearProfileBtnIcon.textContent = "delete";
  clearProfileBtnLabel.textContent = "Clear";
  clearProfileBtn.removeAttribute("aria-live");
}

function armClearConfirmation() {
  clearIsArmed = true;
  clearProfileBtnIcon.textContent = "warning";
  clearProfileBtnLabel.textContent = "Confirm";
  clearProfileBtn.setAttribute("aria-live", "polite");

  clearArmTimeoutId = setTimeout(() => {
    resetClearConfirmationState();
  }, 4000);
}

function clearAllProfileAndChatData() {
  if (!clearIsArmed) {
    armClearConfirmation();
    return;
  }

  resetClearConfirmationState();
  resetProfileState();
  conversationHistory.length = 0;
  localStorage.removeItem("lorealChatState");
  clearChatWindow();
  renderProfileContent();
  userInput.focus();
}

function setLoading(isLoading) {
  sendBtn.disabled = isLoading;
  userInput.disabled = isLoading;
}

async function callWorker(messages) {
  const response = await fetch(workerURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

function normalizeProfile(profileUpdate) {
  const validSkinTypes = ["oily", "dry", "combination", "normal", "sensitive"];

  const normalized = {
    name: "",
    skinType: "",
    concerns: [],
    budget: "",
    fragrancePreference: "",
  };

  if (typeof profileUpdate.name === "string") {
    normalized.name = toTitleCase(profileUpdate.name.trim());
  }

  if (typeof profileUpdate.skinType === "string") {
    const candidate = profileUpdate.skinType.trim().toLowerCase();
    normalized.skinType = validSkinTypes.includes(candidate) ? candidate : "";
  }

  if (Array.isArray(profileUpdate.concerns)) {
    normalized.concerns = profileUpdate.concerns
      .filter((item) => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0)
      .slice(0, 6);
  }

  if (typeof profileUpdate.budget === "string") {
    normalized.budget = toSentenceCase(profileUpdate.budget.trim());
  }

  if (typeof profileUpdate.fragrancePreference === "string") {
    normalized.fragrancePreference = toSentenceCase(
      profileUpdate.fragrancePreference.trim(),
    );
  }

  return normalized;
}

function mergeProfile(profileUpdate) {
  if (!profileUpdate) {
    return;
  }

  if (profileUpdate.name) {
    userProfile.name = profileUpdate.name;
  }

  if (profileUpdate.skinType) {
    userProfile.skinType = profileUpdate.skinType;
  }

  if (profileUpdate.concerns.length > 0) {
    userProfile.concerns = profileUpdate.concerns;
  }

  if (profileUpdate.budget) {
    userProfile.budget = profileUpdate.budget;
  }

  if (profileUpdate.fragrancePreference) {
    userProfile.fragrancePreference = profileUpdate.fragrancePreference;
  }
}

async function extractProfileFromMessage(question) {
  const messages = [
    { role: "system", content: extractionPrompt },
    {
      role: "user",
      content: `Existing profile: ${JSON.stringify(userProfile)}\nLatest user message: ${question}`,
    },
  ];

  try {
    const data = await callWorker(messages);
    const rawContent = data?.choices?.[0]?.message?.content?.trim();

    if (!rawContent) {
      return;
    }

    const parsed = parseJsonFromModelContent(rawContent);

    if (!parsed) {
      return;
    }

    const cleanedProfile = await cleanProfileWithModel(
      parsed,
      "Data extracted from latest user message",
    );

    mergeProfile(cleanedProfile);
  } catch (error) {
    // Keep chat flow running even if profile extraction fails.
    console.warn("Profile extraction skipped:", error);
  }
}

function buildMessagesForRequest() {
  const messages = [{ role: "system", content: systemPrompt }];

  const hasProfileData =
    userProfile.name ||
    userProfile.skinType ||
    userProfile.concerns.length > 0 ||
    userProfile.budget ||
    userProfile.fragrancePreference;

  if (hasProfileData) {
    messages.push({
      role: "system",
      content: `Known user profile data: ${JSON.stringify(userProfile)}. Use this only when relevant and do not invent missing profile details.`,
    });
  }

  // Send recent turns to keep context while staying lightweight.
  return messages.concat(conversationHistory.slice(-12));
}

function saveConversation() {
  const appState = {
    history: conversationHistory,
    profile: userProfile,
  };

  localStorage.setItem("lorealChatState", JSON.stringify(appState));
}

function loadConversation() {
  const rawState = localStorage.getItem("lorealChatState");

  if (!rawState) {
    renderInitialAssistantMessage();
    return;
  }

  try {
    const parsedState = JSON.parse(rawState);
    const savedHistory = parsedState.history || [];

    savedHistory.forEach((message) => {
      if (message.role === "user" || message.role === "assistant") {
        conversationHistory.push(message);
        appendMessage(message.role, message.content);
      }
    });

    if (parsedState.profile) {
      mergeProfile(normalizeProfile(parsedState.profile));
    }
  } catch (error) {
    console.error("Could not load saved conversation:", error);
    renderInitialAssistantMessage();
  }
}

profileBtn.addEventListener("click", toggleProfileWindow);
closeProfileBtn.addEventListener("click", closeProfileWindow);
clearProfileBtn.addEventListener("click", clearAllProfileAndChatData);

profileContent.addEventListener("click", (event) => {
  const editButton = event.target.closest(".profile-card__edit");

  if (editButton) {
    const field = editButton.getAttribute("data-field");

    const allowedFields = [
      "name",
      "skinType",
      "concerns",
      "budget",
      "fragrancePreference",
    ];

    if (field && allowedFields.includes(field)) {
      startInlineProfileEdit(field);
    }

    return;
  }

  const actionButton = event.target.closest(".profile-inline-edit__btn");

  if (!actionButton) {
    return;
  }

  const action = actionButton.getAttribute("data-action");
  const field = actionButton.getAttribute("data-field");

  const allowedFields = [
    "name",
    "skinType",
    "concerns",
    "budget",
    "fragrancePreference",
  ];

  if (!field || !allowedFields.includes(field)) {
    return;
  }

  if (action === "cancel") {
    cancelInlineProfileEdit();
    return;
  }

  if (action === "save") {
    void commitInlineProfileEdit(field);
  }
});

profileContent.addEventListener("keydown", (event) => {
  if (!event.target.classList.contains("profile-inline-edit__input")) {
    return;
  }

  const field = event.target.getAttribute("data-field");

  if (!field) {
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    void commitInlineProfileEdit(field);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    cancelInlineProfileEdit();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileOverlay.classList.contains("hidden")) {
    closeProfileWindow();
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = userInput.value.trim();

  if (!question) {
    return;
  }

  appendMessage("user", question);
  conversationHistory.push({ role: "user", content: question });
  saveConversation();

  userInput.value = "";
  setLoading(true);

  const thinkingRow = appendThinkingMessage();

  try {
    await extractProfileFromMessage(question);
    saveConversation();

    const data = await callWorker(buildMessagesForRequest());
    const assistantReply = data?.choices?.[0]?.message?.content?.trim();

    if (!assistantReply) {
      throw new Error("Assistant response was empty.");
    }

    removeThinkingMessage(thinkingRow);
    appendMessage("assistant", assistantReply);
    conversationHistory.push({ role: "assistant", content: assistantReply });
    saveConversation();
  } catch (error) {
    console.error("Chat request error:", error);

    const fallback =
      "I can only help with L'Oreal beauty topics right now. Please ask about products, routines, skincare, makeup, haircare, or fragrance.";

    removeThinkingMessage(thinkingRow);
    appendMessage("assistant", fallback);
    conversationHistory.push({ role: "assistant", content: fallback });
    saveConversation();
  } finally {
    removeThinkingMessage(thinkingRow);
    setLoading(false);
    userInput.focus();
  }
});

loadConversation();
