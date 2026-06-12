(function () {
  'use strict';

  // ---- State ----
  let entries = [];          // Working data — always in JanitorAI format internally
  let sourceFormat = null;   // 'janitor' | 'sillytavern'
  let activeTagFilter = null;
  let editingIndex = -1;
  let selectedIndices = new Set();
  let undoStack = [];
  const MAX_UNDO = 30;

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);
  const entryListEl = $('entry-list');
  const emptyStateEl = $('empty-state');
  const filterBar = $('filter-bar');

  // ---- LocalStorage Autosave ----
  const STORAGE_KEY = 'lorebook-autosave';
  const STORAGE_FORMAT_KEY = 'lorebook-autosave-format';

  function saveToLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      if (sourceFormat) localStorage.setItem(STORAGE_FORMAT_KEY, sourceFormat);
      showAutosaveStatus('Saved');
    } catch (e) {
      showAutosaveStatus('Save failed');
    }
  }

  function loadFromLocal() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return false;
      const data = JSON.parse(saved);
      if (!Array.isArray(data) || data.length === 0) return false;
      entries = data;
      sourceFormat = localStorage.getItem(STORAGE_FORMAT_KEY) || 'janitor';
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearLocalSave() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_FORMAT_KEY);
  }

  function showAutosaveStatus(msg) {
    const el = $('autosave-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('visible'), 2000);
  }

  // ---- Helpers ----
  function pushUndo() {
    undoStack.push(JSON.parse(JSON.stringify(entries)));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }

  function undo() {
    if (!undoStack.length) return;
    entries = undoStack.pop();
    if (!entries.length) clearLocalSave();
    render();
  }

  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 30);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function downloadJSON(data, filename) {
    downloadText(JSON.stringify(data, null, 2), filename, 'application/json');
  }

  function downloadText(text, filename, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function collectTags() {
    const tags = new Set();
    entries.forEach(e => (e.tags || []).forEach(t => tags.add(t)));
    return [...tags].sort();
  }

  function collectCategories() {
    const cats = new Set();
    entries.forEach(e => { if (e.category) cats.add(e.category); });
    return [...cats].sort();
  }

  // ---- Enable/Disable toolbar ----
  function updateToolbar() {
    const has = entries.length > 0;
    $('btn-new-entry').disabled = false;
    $('btn-export-janitor').disabled = !has;
    $('btn-export-st').disabled = !has;
    $('btn-export-script').disabled = !has;
    $('btn-find-replace').disabled = !has;
    $('btn-bulk-retag').disabled = !has;
    $('btn-reindex').disabled = !has;
    $('btn-code-editor').disabled = !has;
  }

  // ---- Rendering ----
  function render() {
    updateToolbar();
    // Autosave on every render (which follows every mutation)
    if (entries.length) {
      saveToLocal();
    } else {
      clearLocalSave();
    }

    if (!entries.length) {
      emptyStateEl.classList.remove('hidden');
      entryListEl.classList.add('hidden');
      filterBar.classList.add('hidden');
      $('selection-bar').classList.add('hidden');
      return;
    }

    emptyStateEl.classList.add('hidden');
    entryListEl.classList.remove('hidden');
    filterBar.classList.remove('hidden');

    renderFilters();
    renderEntries();
    updateSelectionBar();
  }

  function renderFilters() {
    // Tags
    const tagContainer = $('tag-filters');
    const tags = collectTags();
    tagContainer.innerHTML = tags.map(t =>
      `<span class="tag-chip ${activeTagFilter === t ? 'active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`
    ).join('');

    // Categories
    const catSelect = $('filter-category');
    const cats = collectCategories();
    const currentCat = catSelect.value;
    catSelect.innerHTML = '<option value="">All</option>' +
      cats.map(c => `<option value="${escapeHtml(c)}" ${c === currentCat ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  }

  function getFilteredIndices() {
    const search = ($('filter-search').value || '').toLowerCase();
    const cat = $('filter-category').value;

    return entries.map((e, i) => i).filter(i => {
      const e = entries[i];
      if (activeTagFilter && !(e.tags || []).includes(activeTagFilter)) return false;
      if (cat && e.category !== cat) return false;
      if (search) {
        const haystack = [e.name, e.content, e.keysRaw, e.id, ...(e.tags || [])].join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  function renderEntries() {
    const indices = getFilteredIndices();
    $('entry-count').textContent = `${indices.length} / ${entries.length} entries`;

    entryListEl.innerHTML = indices.map(i => {
      const e = entries[i];
      const tags = (e.tags || []).map(t => `<span class="entry-badge tag">${escapeHtml(t)}</span>`).join('');
      const preview = (e.content || '').replace(/\n/g, ' ').slice(0, 120);
      const keywords = (e.keysRaw || e.key?.join(', ') || '').slice(0, 80);
      return `
        <div class="entry-card ${e.enabled === false ? 'disabled' : ''}" data-index="${i}" draggable="true">
          <span class="entry-drag-handle" title="Drag to reorder">&#9776;</span>
          <input type="checkbox" class="entry-checkbox" data-index="${i}" ${selectedIndices.has(i) ? 'checked' : ''}>
          <div class="entry-info">
            <div class="entry-header">
              <span class="entry-name">${escapeHtml(e.name || 'Unnamed')}</span>
              <span class="entry-id">${escapeHtml(e.id || '')}</span>
            </div>
            <div class="entry-meta">
              ${e.category ? `<span class="entry-badge category">${escapeHtml(e.category)}</span>` : ''}
              <span class="entry-badge priority">P${e.priority || 0}</span>
              <span class="entry-badge order">Order: ${e.insertion_order}</span>
              ${tags}
            </div>
            <div class="entry-preview">${escapeHtml(preview)}</div>
            ${keywords ? `<div class="entry-keywords">Keys: ${escapeHtml(keywords)}</div>` : ''}
          </div>
          <div class="entry-actions">
            <button class="btn-edit" data-index="${i}" title="Edit">Edit</button>
            <button class="btn-dup" data-index="${i}" title="Duplicate">Dup</button>
            <button class="btn-move-up" data-index="${i}" title="Move up">&uarr;</button>
            <button class="btn-move-down" data-index="${i}" title="Move down">&darr;</button>
          </div>
        </div>`;
    }).join('');
  }

  // ---- JanitorAI Script Parsing ----
  // Extracts a balanced [...] array literal starting at `start` (position of '['),
  // skipping strings, template literals and comments.
  function extractBalancedArray(text, start) {
    let depth = 0;
    let i = start;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        const quote = ch;
        i++;
        while (i < text.length && text[i] !== quote) {
          if (text[i] === '\\') i++;
          i++;
        }
      } else if (ch === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++;
      } else if (ch === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i++;
      } else if (ch === '[' || ch === '{' || ch === '(') {
        depth++;
      } else if (ch === ']' || ch === '}' || ch === ')') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
      i++;
    }
    return null;
  }

  // Finds the lore entry array in a JanitorAI script and returns the raw
  // entry objects, or null if the text doesn't look like a script.
  function tryParseScript(text) {
    const entryKeyRe = /["']?\b(keywords|keys)["']?\s*:/;
    if (!entryKeyRe.test(text)) return null;

    const assignRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g;
    let m;
    let best = null;
    while ((m = assignRe.exec(text)) !== null) {
      const arrText = extractBalancedArray(text, assignRe.lastIndex - 1);
      if (!arrText || !entryKeyRe.test(arrText)) continue;
      const score = /lore|entr|book/i.test(m[1]) ? 2 : 1;
      if (!best || score > best.score || (score === best.score && arrText.length > best.text.length)) {
        best = { text: arrText, score };
      }
    }
    if (!best) return null;

    let arr;
    try {
      arr = new Function('"use strict"; return (' + best.text + ');')();
    } catch (e) {
      throw new Error('Found a lore array in the script but could not parse it: ' + e.message);
    }
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr;
  }

  function looksLikeScriptEntry(raw) {
    return raw && Array.isArray(raw.keywords) && raw.content == null &&
      (raw.personality != null || raw.scenario != null || raw.triggers != null || raw.minMessages != null);
  }

  // Converts one raw script entry ({keywords, priority, personality, ...})
  // to the internal JanitorAI entry format.
  function scriptEntryToInternal(raw, idx) {
    const keys = (raw.keywords || raw.keys || raw.key || []).map(String);
    const personality = String(raw.personality || '').replace(/^[\s,;]+/, '').trim();
    const scenario = String(raw.scenario || '').trim();

    let content = raw.content || '';
    if (!content) {
      const parts = [];
      if (personality) parts.push('{{char}} is ' + personality.replace(/\.$/, '') + '.');
      if (scenario) parts.push(scenario);
      content = parts.join('\n');
    }

    // Map script filters to SillyTavern-style secondary keys.
    // selectiveLogic: 0 = AND ANY, 2 = NOT ANY, 3 = AND ALL
    let keysecondary = [];
    let selectiveLogic = 0;
    const filters = raw.filters || null;
    if (filters) {
      if (Array.isArray(filters.requiresAll) && filters.requiresAll.length) {
        keysecondary = filters.requiresAll.map(String);
        selectiveLogic = 3;
      } else if (Array.isArray(filters.requiresAny) && filters.requiresAny.length) {
        keysecondary = filters.requiresAny.map(String);
        selectiveLogic = 0;
      } else if (Array.isArray(filters.notWith) && filters.notWith.length) {
        keysecondary = filters.notWith.map(String);
        selectiveLogic = 2;
      }
    }

    // Probability in scripts is a 0–1 fraction; internally we use percent.
    let probability = 100;
    if (raw.probability != null) {
      probability = raw.probability <= 1 ? Math.round(raw.probability * 100) : Math.round(raw.probability);
    }

    const firstKey = keys[0] || 'entry';
    const name = raw.name || (firstKey.charAt(0).toUpperCase() + firstKey.slice(1)) + (raw.category ? ` (${raw.category})` : '');

    const ext = {};
    const script = {};
    if (personality) script.personality = raw.personality;
    if (scenario) script.scenario = raw.scenario;
    if (Array.isArray(raw.triggers) && raw.triggers.length) script.triggers = raw.triggers;
    if (filters) script.filters = filters;
    if (Object.keys(script).length) ext.script = script;

    return {
      activationMode: 'standard',
      activationScript: '',
      case_sensitive: false,
      category: raw.category || '',
      comment: '',
      constant: raw.constant || false,
      content: content,
      enabled: raw.enabled !== false,
      extensions: ext,
      groupWeight: 100,
      id: `script-${String(idx + 1).padStart(4, '0')}-${slugify(firstKey)}`,
      inclusionGroupRaw: '',
      insertion_order: (raw.priority != null ? raw.priority : idx + 1) * 100,
      key: keys,
      keyMatchPriority: false,
      keysecondary: keysecondary,
      keysecondaryRaw: keysecondary.join(', '),
      keysRaw: keys.join(', '),
      matchWholeWords: false,
      minMessages: raw.minMessages || 0,
      name: name,
      prioritizeInclusion: false,
      priority: raw.priority != null ? raw.priority : idx + 1,
      probability: probability,
      selectiveLogic: selectiveLogic,
      tags: raw.category ? [raw.category] : [],
      keywordsRaw: keys.join(', ')
    };
  }

  // ---- Import / Load ----
  function loadData(data, format) {
    if (format === 'janitor') {
      entries = data;
    } else if (format === 'script') {
      entries = data.map((raw, idx) => scriptEntryToInternal(raw, idx));
      format = 'janitor';
    } else if (format === 'sillytavern') {
      // Convert to JanitorAI internal format
      const stEntries = data.entries || {};
      entries = Object.values(stEntries).map((entry, idx) => {
        const ext = entry.extensions || {};
        const keys = Array.isArray(entry.key) ? entry.key : (typeof entry.key === 'string' ? entry.key.split(',').map(k => k.trim()).filter(Boolean) : []);
        return {
          activationMode: ext.janitor_activationMode || 'standard',
          activationScript: '',
          case_sensitive: entry.caseSensitive || false,
          category: ext.janitor_category || 'character',
          comment: '',
          constant: entry.constant || false,
          content: entry.content || '',
          enabled: !entry.disable,
          extensions: ext.janitor_script ? { script: ext.janitor_script } : {},
          groupWeight: entry.groupWeight || 100,
          id: ext.janitor_id || `entry-${String(idx + 1).padStart(4, '0')}`,
          inclusionGroupRaw: entry.group || '',
          insertion_order: entry.order != null ? entry.order : (idx * 100),
          key: keys,
          keyMatchPriority: false,
          keysecondary: entry.keysecondary || [],
          keysecondaryRaw: Array.isArray(entry.keysecondary) ? entry.keysecondary.join(', ') : '',
          keysRaw: keys.join(', '),
          matchWholeWords: entry.matchWholeWords != null ? entry.matchWholeWords : true,
          minMessages: entry.delay || 0,
          name: entry.comment || `Entry ${idx + 1}`,
          prioritizeInclusion: false,
          priority: ext.janitor_priority || (idx + 1),
          probability: entry.probability != null ? entry.probability : 100,
          selectiveLogic: entry.selectiveLogic || 0,
          tags: ext.janitor_tags || [],
          keywordsRaw: keys.join(', ')
        };
      });
    }
    sourceFormat = format;
    selectedIndices.clear();
    undoStack = [];
    render();
  }

  function autoDetectAndLoad(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (jsonErr) {
      // Not JSON — maybe a JanitorAI script with an embedded lore array
      let scriptEntries;
      try {
        scriptEntries = tryParseScript(text);
      } catch (scriptErr) {
        alert(scriptErr.message);
        return;
      }
      if (scriptEntries) {
        loadData(scriptEntries, 'script');
        showAutosaveStatus(`Imported ${scriptEntries.length} entries from script`);
        return;
      }
      alert('Invalid JSON: ' + jsonErr.message);
      return;
    }

    if (Array.isArray(data)) {
      // Could be a JanitorAI lorebook export or an array of script-style entries
      if (data.every(looksLikeScriptEntry)) {
        loadData(data, 'script');
      } else {
        loadData(data, 'janitor');
      }
    } else if (data.entries && typeof data.entries === 'object') {
      loadData(data, 'sillytavern');
    } else {
      alert('Unrecognized lorebook format. Expected a JanitorAI array, SillyTavern object with "entries", or a JanitorAI script.');
    }
  }

  // ---- Export ----
  function exportJanitor() {
    downloadJSON(entries, 'lorebook-janitor.json');
  }

  function exportSillyTavern() {
    const stData = { entries: {} };
    entries.forEach((entry, idx) => {
      stData.entries[idx] = {
        uid: idx,
        key: entry.key || [],
        keysecondary: entry.keysecondary || [],
        comment: entry.name || '',
        content: entry.content || '',
        constant: entry.constant || false,
        selective: (entry.keysecondary || []).length > 0,
        selectiveLogic: entry.selectiveLogic || 0,
        addMemo: true,
        order: entry.insertion_order != null ? entry.insertion_order : (idx * 100),
        position: 0,
        disable: !entry.enabled,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: false,
        probability: entry.probability != null ? entry.probability : 100,
        matchWholeWords: entry.matchWholeWords != null ? entry.matchWholeWords : true,
        useProbability: entry.probability != null && entry.probability < 100,
        depth: 4,
        group: entry.inclusionGroupRaw || '',
        groupOverride: false,
        groupWeight: entry.groupWeight || 100,
        scanDepth: null,
        caseSensitive: entry.case_sensitive || false,
        automationId: '',
        role: null,
        vectorized: false,
        sticky: 0,
        cooldown: 0,
        delay: entry.minMessages || 0,
        displayIndex: idx,
        extensions: Object.assign({
          janitor_id: entry.id || '',
          janitor_category: entry.category || '',
          janitor_tags: entry.tags || [],
          janitor_priority: entry.priority || 0,
          janitor_activationMode: entry.activationMode || 'standard'
        }, entry.extensions && entry.extensions.script ? { janitor_script: entry.extensions.script } : {})
      };
    });
    downloadJSON(stData, 'lorebook-sillytavern.json');
  }

  // ---- Export as JanitorAI Script ----
  function exportJanitorScript() {
    const scriptEntries = entries.filter(e => e.enabled !== false).map(e => {
      const script = (e.extensions && e.extensions.script) || {};
      const obj = { keywords: e.key || [] };
      obj.priority = e.priority != null ? e.priority : 0;
      if (e.minMessages) obj.minMessages = e.minMessages;
      if (e.category) obj.category = e.category;
      if (e.constant) obj.constant = true;
      if (e.probability != null && e.probability < 100) {
        obj.probability = Math.round(e.probability) / 100;
      }

      // Rebuild filters from stored script data or from secondary keys
      if (script.filters) {
        obj.filters = script.filters;
      } else if ((e.keysecondary || []).length) {
        if (e.selectiveLogic === 3) obj.filters = { requiresAll: e.keysecondary };
        else if (e.selectiveLogic === 2) obj.filters = { notWith: e.keysecondary };
        else obj.filters = { requiresAny: e.keysecondary };
      }

      if (script.personality != null) obj.personality = script.personality;
      if (script.scenario != null) {
        obj.scenario = script.scenario;
      } else {
        obj.scenario = ' ' + (e.content || '').replace(/\s*\n+\s*/g, ' ').trim();
      }
      if (Array.isArray(script.triggers) && script.triggers.length) obj.triggers = script.triggers;
      return obj;
    });

    const script = `/**
 * Lorebook Script for JanitorAI
 * Generated by Lorebook Editor
 * Keyword activation with priorities, filters, probability,
 * minMessages and recursive triggers.
 */

const lastMessage = context.chat.last_message.toLowerCase();
const messageCount = context.chat.message_count;

// === LOREBOOK DATABASE ===
const loreEntries = ${JSON.stringify(scriptEntries, null, 4)};

// === ACTIVATION ENGINE ===
const activatedEntries = [];
const triggeredKeywords = [];

function passesFilters(entry) {
    if (!entry.filters) return true;
    if (entry.filters.notWith &&
        entry.filters.notWith.some(word => lastMessage.includes(word.toLowerCase()))) {
        return false;
    }
    if (entry.filters.requiresAny &&
        !entry.filters.requiresAny.some(word => lastMessage.includes(word.toLowerCase()))) {
        return false;
    }
    if (entry.filters.requiresAll &&
        !entry.filters.requiresAll.every(word => lastMessage.includes(word.toLowerCase()))) {
        return false;
    }
    return true;
}

// First pass: direct keyword matches (constant entries always match)
loreEntries.forEach(entry => {
    if (messageCount < (entry.minMessages || 0)) return;
    const hasKeyword = entry.constant ||
        entry.keywords.some(keyword => lastMessage.includes(keyword.toLowerCase()));
    if (!hasKeyword) return;
    if (entry.probability && Math.random() > entry.probability) return;
    if (!passesFilters(entry)) return;

    activatedEntries.push(entry);
    if (entry.triggers) {
        entry.triggers.forEach(trigger => triggeredKeywords.push(trigger));
    }
});

// Second pass: recursive activation via triggers from other entries
if (triggeredKeywords.length > 0) {
    loreEntries.forEach(entry => {
        if (activatedEntries.includes(entry)) return;
        if (messageCount < (entry.minMessages || 0)) return;
        const isTriggered = entry.keywords.some(keyword =>
            triggeredKeywords.some(trigger =>
                keyword.toLowerCase().includes(trigger.toLowerCase()) ||
                trigger.toLowerCase().includes(keyword.toLowerCase()))
        );
        if (!isTriggered) return;
        if (entry.probability && Math.random() > entry.probability) return;
        if (!passesFilters(entry)) return;
        activatedEntries.push(entry);
    });
}

// === APPLY LORE (sorted by priority, highest first) ===
activatedEntries
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .forEach(entry => {
        if (entry.personality) context.character.personality += entry.personality;
        if (entry.scenario) context.character.scenario += entry.scenario;
    });
`;
    downloadText(script, 'lorebook-script.js', 'text/javascript');
  }

  // ---- Entry Editor ----
  function openEditor(index) {
    editingIndex = index;
    const e = index >= 0 ? entries[index] : null;
    const isNew = !e;

    $('editor-title').textContent = isNew ? 'New Entry' : `Edit: ${e.name || 'Unnamed'}`;
    $('ed-name').value = e ? e.name || '' : '';
    $('ed-id').value = e ? e.id || '' : '';
    $('ed-category').value = e ? e.category || '' : '';
    $('ed-priority').value = e ? e.priority || 0 : entries.length + 1;
    $('ed-insertion-order').value = e ? e.insertion_order || 0 : (entries.length + 1) * 100;
    $('ed-probability').value = e ? e.probability ?? 100 : 100;
    $('ed-min-messages').value = e ? e.minMessages || 0 : 0;
    $('ed-keywords').value = e ? (e.keysRaw || e.key?.join(', ') || '') : '';
    $('ed-secondary-keys').value = e ? (e.keysecondaryRaw || '') : '';
    $('ed-tags').value = e ? (e.tags || []).join(', ') : '';
    $('ed-content').value = e ? e.content || '' : '';
    $('ed-enabled').checked = e ? e.enabled !== false : true;
    $('ed-constant').checked = e ? e.constant || false : false;
    $('ed-case-sensitive').checked = e ? e.case_sensitive || false : false;
    $('ed-match-whole').checked = e ? e.matchWholeWords !== false : true;
    $('ed-activation-mode').value = e ? e.activationMode || 'standard' : 'standard';

    $('editor-delete').classList.toggle('hidden', isNew);
    $('editor-modal').classList.remove('hidden');
  }

  function saveEditor() {
    pushUndo();
    const keys = $('ed-keywords').value.split(',').map(k => k.trim()).filter(Boolean);
    const secKeys = $('ed-secondary-keys').value.split(',').map(k => k.trim()).filter(Boolean);
    const tags = $('ed-tags').value.split(',').map(t => t.trim()).filter(Boolean);
    const newPriority = parseInt($('ed-priority').value) || 0;
    const prev = editingIndex >= 0 ? entries[editingIndex] : null;

    const obj = {
      activationMode: $('ed-activation-mode').value,
      activationScript: prev ? prev.activationScript || '' : '',
      case_sensitive: $('ed-case-sensitive').checked,
      category: $('ed-category').value,
      comment: prev ? prev.comment || '' : '',
      constant: $('ed-constant').checked,
      content: $('ed-content').value,
      enabled: $('ed-enabled').checked,
      extensions: prev ? prev.extensions || {} : {},
      groupWeight: prev ? prev.groupWeight || 100 : 100,
      id: $('ed-id').value,
      inclusionGroupRaw: prev ? prev.inclusionGroupRaw || '' : '',
      insertion_order: parseInt($('ed-insertion-order').value) || 0,
      key: keys,
      keyMatchPriority: prev ? prev.keyMatchPriority || false : false,
      keysecondary: secKeys,
      keysecondaryRaw: secKeys.join(', '),
      keysRaw: keys.join(', '),
      matchWholeWords: $('ed-match-whole').checked,
      minMessages: parseInt($('ed-min-messages').value) || 0,
      name: $('ed-name').value,
      prioritizeInclusion: prev ? prev.prioritizeInclusion || false : false,
      priority: newPriority,
      probability: parseInt($('ed-probability').value) || 100,
      selectiveLogic: prev ? prev.selectiveLogic || 0 : 0,
      tags: tags,
      keywordsRaw: keys.join(', ')
    };

    // If the content was edited, the stored script personality/scenario split
    // is stale — drop it so script export uses the new content instead.
    if (prev && obj.content !== prev.content && obj.extensions.script) {
      const script = Object.assign({}, obj.extensions.script);
      delete script.personality;
      delete script.scenario;
      obj.extensions = Object.assign({}, obj.extensions, { script });
    }

    if (editingIndex >= 0) {
      const oldPriority = entries[editingIndex].priority;
      entries[editingIndex] = obj;

      // Renumber priorities: shift other entries to make room
      if (oldPriority !== newPriority) {
        entries.forEach((e, i) => {
          if (i === editingIndex) return;
          if (oldPriority > newPriority) {
            // Moved up: push entries in [newPriority, oldPriority) down by 1
            if (e.priority >= newPriority && e.priority < oldPriority) {
              e.priority++;
            }
          } else {
            // Moved down: pull entries in (oldPriority, newPriority] up by 1
            if (e.priority > oldPriority && e.priority <= newPriority) {
              e.priority--;
            }
          }
        });
      }
    } else {
      // New entry: push down anything at or below the new priority
      entries.forEach(e => {
        if (e.priority >= newPriority) {
          e.priority++;
        }
      });
      entries.push(obj);
    }

    $('editor-modal').classList.add('hidden');
    render();
  }

  function deleteEntry(index) {
    if (!confirm(`Delete "${entries[index].name || 'Unnamed'}"?`)) return;
    pushUndo();
    entries.splice(index, 1);
    selectedIndices.clear();
    render();
  }

  function duplicateEntry(index) {
    pushUndo();
    const copy = JSON.parse(JSON.stringify(entries[index]));
    copy.name = copy.name + ' (copy)';
    copy.id = copy.id + '-copy';
    entries.splice(index + 1, 0, copy);
    render();
  }

  function moveEntry(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= entries.length) return;
    pushUndo();
    const temp = entries[index];
    entries[index] = entries[newIndex];
    entries[newIndex] = temp;
    render();
  }

  // ---- Find & Replace ----
  function findReplace(preview) {
    const findText = $('fr-find').value;
    if (!findText) return;

    const replaceText = $('fr-replace').value;
    const caseSensitive = $('fr-case').checked;
    const inContent = $('fr-content').checked;
    const inNames = $('fr-names').checked;
    const inKeys = $('fr-keys').checked;

    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

    let count = 0;
    const results = [];

    if (!preview) pushUndo();

    entries.forEach((e, i) => {
      const fields = [];
      if (inContent) fields.push('content');
      if (inNames) fields.push('name');
      if (inKeys) fields.push('keysRaw', 'keywordsRaw');

      fields.forEach(field => {
        if (!e[field]) return;
        const matches = e[field].match(regex);
        if (matches) {
          count += matches.length;
          if (preview) {
            results.push({ entry: e.name, field, count: matches.length });
          } else {
            e[field] = e[field].replace(regex, replaceText);
          }
        }
      });

      // Also update the key array if replacing in keys
      if (!preview && inKeys && e.key) {
        e.key = e.keysRaw.split(',').map(k => k.trim()).filter(Boolean);
        e.keywordsRaw = e.keysRaw;
      }
    });

    $('fr-count').textContent = `${count} match${count !== 1 ? 'es' : ''} found`;

    if (preview) {
      $('fr-results').innerHTML = results.map(r =>
        `<div class="fr-match"><strong>${escapeHtml(r.entry)}</strong> — ${r.field}: ${r.count} match${r.count !== 1 ? 'es' : ''}</div>`
      ).join('') || '<div class="fr-match">No matches found.</div>';
    } else {
      $('fr-results').innerHTML = `<div class="fr-match">Replaced ${count} occurrence${count !== 1 ? 's' : ''}.</div>`;
      render();
    }
  }

  // ---- Bulk Retag ----
  function applyRetag() {
    const addTag = $('retag-add').value.trim();
    const removeTag = $('retag-remove').value.trim();
    const selectedOnly = $('retag-selected-only').checked;

    if (!addTag && !removeTag) return;
    pushUndo();

    entries.forEach((e, i) => {
      if (selectedOnly && !selectedIndices.has(i)) return;
      if (!e.tags) e.tags = [];
      if (removeTag) {
        e.tags = e.tags.filter(t => t !== removeTag);
      }
      if (addTag && !e.tags.includes(addTag)) {
        e.tags.push(addTag);
      }
    });

    render();
    alert('Tags updated.');
  }

  // ---- Reindex ----
  function applyReindex() {
    const prefix = $('reindex-prefix').value.trim() || 'entry';
    const start = parseInt($('reindex-start').value) || 1;
    const step = parseInt($('reindex-step').value) || 100;
    const useName = $('reindex-use-name').checked;

    pushUndo();
    entries.forEach((e, i) => {
      const num = String(start + i).padStart(4, '0');
      const nameSlug = useName && e.name ? '-' + slugify(e.name) : '';
      e.id = `${prefix}-${num}${nameSlug}`;
      e.insertion_order = (start + i) * step;
      e.priority = start + i;
    });

    render();
    alert('IDs, insertion order, and priorities reindexed.');
  }

  // ---- Mass Selection ----
  function updateSelectionBar() {
    const bar = $('selection-bar');
    if (!entries.length) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    $('selection-count').textContent = `${selectedIndices.size} selected`;
  }

  function selectAllVisible() {
    const indices = getFilteredIndices();
    indices.forEach(i => selectedIndices.add(i));
    renderEntries();
    updateSelectionBar();
  }

  function deselectAll() {
    selectedIndices.clear();
    renderEntries();
    updateSelectionBar();
  }

  let massModalAction = null;

  function openMassModal(action, title, label, placeholder) {
    massModalAction = action;
    $('mass-modal-title').textContent = title;
    $('mass-modal-label').textContent = label;
    $('mass-modal-input').placeholder = placeholder || 'value1, value2, ...';
    $('mass-modal-input').value = '';
    $('mass-modal').classList.remove('hidden');
    $('mass-modal-input').focus();
  }

  function closeMassModal() {
    $('mass-modal').classList.add('hidden');
    massModalAction = null;
  }

  function applyMassAction() {
    if (!massModalAction || !selectedIndices.size) return;
    const values = $('mass-modal-input').value.split(',').map(v => v.trim()).filter(Boolean);
    if (!values.length) return;

    pushUndo();

    selectedIndices.forEach(i => {
      const e = entries[i];
      if (!e) return;

      switch (massModalAction) {
        case 'add-tags':
          if (!e.tags) e.tags = [];
          values.forEach(v => { if (!e.tags.includes(v)) e.tags.push(v); });
          break;
        case 'remove-tags':
          if (e.tags) e.tags = e.tags.filter(t => !values.includes(t));
          break;
        case 'add-keys':
          if (!e.key) e.key = [];
          values.forEach(v => { if (!e.key.includes(v)) e.key.push(v); });
          e.keysRaw = e.key.join(', ');
          e.keywordsRaw = e.keysRaw;
          break;
        case 'remove-keys':
          if (e.key) e.key = e.key.filter(k => !values.includes(k));
          e.keysRaw = (e.key || []).join(', ');
          e.keywordsRaw = e.keysRaw;
          break;
      }
    });

    closeMassModal();
    render();
  }

  function massDelete() {
    if (!selectedIndices.size) return;
    if (!confirm(`Delete ${selectedIndices.size} selected entries?`)) return;
    pushUndo();
    // Delete in reverse order to preserve indices
    const sorted = [...selectedIndices].sort((a, b) => b - a);
    sorted.forEach(i => entries.splice(i, 1));
    selectedIndices.clear();
    render();
  }

  // ---- Code Editor ----
  function openCodeEditor() {
    const panel = $('code-editor-panel');
    if (!panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
      return;
    }
    // Hide other panels
    $('find-replace-panel').classList.add('hidden');
    $('retag-panel').classList.add('hidden');
    $('reindex-panel').classList.add('hidden');

    $('code-editor-textarea').value = JSON.stringify(entries, null, 2);
    $('code-editor-status').textContent = `${entries.length} entries`;
    $('code-editor-textarea').classList.remove('json-error');
    panel.classList.remove('hidden');
  }

  function formatCodeEditor() {
    const ta = $('code-editor-textarea');
    try {
      const data = JSON.parse(ta.value);
      ta.value = JSON.stringify(data, null, 2);
      ta.classList.remove('json-error');
      $('code-editor-status').textContent = 'Formatted';
    } catch (e) {
      ta.classList.add('json-error');
      $('code-editor-status').textContent = 'Invalid JSON: ' + e.message;
    }
  }

  function applyCodeEditor() {
    const ta = $('code-editor-textarea');
    let data;
    try {
      data = JSON.parse(ta.value);
    } catch (e) {
      ta.classList.add('json-error');
      $('code-editor-status').textContent = 'Invalid JSON: ' + e.message;
      return;
    }

    if (!Array.isArray(data)) {
      ta.classList.add('json-error');
      $('code-editor-status').textContent = 'Expected a JSON array of entries';
      return;
    }

    pushUndo();
    entries = data;
    selectedIndices.clear();
    $('code-editor-status').textContent = `Applied ${entries.length} entries`;
    ta.classList.remove('json-error');
    render();
  }

  // ---- Snippet Import ----
  function normalizeSnippetEntry(raw, idx) {
    // Script-style entry ({keywords, personality, scenario, ...})
    if (looksLikeScriptEntry(raw)) {
      return scriptEntryToInternal(raw, entries.length + idx);
    }

    // If it looks like a SillyTavern entry (has uid/comment but no name), convert it
    if (raw.uid != null && !raw.name && raw.comment != null) {
      const ext = raw.extensions || {};
      const keys = Array.isArray(raw.key) ? raw.key : (typeof raw.key === 'string' ? raw.key.split(',').map(k => k.trim()).filter(Boolean) : []);
      return {
        activationMode: ext.janitor_activationMode || 'standard',
        activationScript: '',
        case_sensitive: raw.caseSensitive || false,
        category: ext.janitor_category || 'character',
        comment: '',
        constant: raw.constant || false,
        content: raw.content || '',
        enabled: !raw.disable,
        extensions: ext.janitor_script ? { script: ext.janitor_script } : {},
        groupWeight: raw.groupWeight || 100,
        id: ext.janitor_id || `snippet-${String(entries.length + idx + 1).padStart(4, '0')}`,
        inclusionGroupRaw: raw.group || '',
        insertion_order: raw.order != null ? raw.order : ((entries.length + idx + 1) * 100),
        key: keys,
        keyMatchPriority: false,
        keysecondary: raw.keysecondary || [],
        keysecondaryRaw: Array.isArray(raw.keysecondary) ? raw.keysecondary.join(', ') : '',
        keysRaw: keys.join(', '),
        matchWholeWords: raw.matchWholeWords != null ? raw.matchWholeWords : true,
        minMessages: raw.delay || 0,
        name: raw.comment || `Entry ${entries.length + idx + 1}`,
        prioritizeInclusion: false,
        priority: ext.janitor_priority || (entries.length + idx + 1),
        probability: raw.probability != null ? raw.probability : 100,
        selectiveLogic: raw.selectiveLogic || 0,
        tags: ext.janitor_tags || [],
        keywordsRaw: keys.join(', ')
      };
    }

    // Already JanitorAI format or close enough — fill in missing fields
    return {
      activationMode: raw.activationMode || 'standard',
      activationScript: raw.activationScript || '',
      case_sensitive: raw.case_sensitive || false,
      category: raw.category || '',
      comment: raw.comment || '',
      constant: raw.constant || false,
      content: raw.content || '',
      enabled: raw.enabled !== false,
      extensions: raw.extensions || {},
      groupWeight: raw.groupWeight || 100,
      id: raw.id || `snippet-${String(entries.length + idx + 1).padStart(4, '0')}`,
      inclusionGroupRaw: raw.inclusionGroupRaw || '',
      insertion_order: raw.insertion_order != null ? raw.insertion_order : ((entries.length + idx + 1) * 100),
      key: raw.key || [],
      keyMatchPriority: raw.keyMatchPriority || false,
      keysecondary: raw.keysecondary || [],
      keysecondaryRaw: raw.keysecondaryRaw || (raw.keysecondary || []).join(', '),
      keysRaw: raw.keysRaw || (raw.key || []).join(', '),
      matchWholeWords: raw.matchWholeWords != null ? raw.matchWholeWords : true,
      minMessages: raw.minMessages || 0,
      name: raw.name || `Entry ${entries.length + idx + 1}`,
      prioritizeInclusion: raw.prioritizeInclusion || false,
      priority: raw.priority != null ? raw.priority : (entries.length + idx + 1),
      probability: raw.probability != null ? raw.probability : 100,
      selectiveLogic: raw.selectiveLogic || 0,
      tags: raw.tags || [],
      keywordsRaw: raw.keywordsRaw || (raw.key || []).join(', ')
    };
  }

  function parseSnippet(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (jsonErr) {
      // Not JSON — try parsing as a JanitorAI script
      const scriptEntries = tryParseScript(text);
      if (scriptEntries) return scriptEntries;
      throw jsonErr;
    }

    // Full lorebook (SillyTavern format)
    if (data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) {
      return Object.values(data.entries);
    }
    // Array of entries
    if (Array.isArray(data)) {
      return data;
    }
    // Single entry object (must have at least content or name)
    if (typeof data === 'object' && (data.content != null || data.name != null || data.comment != null)) {
      return [data];
    }
    throw new Error('Unrecognized format. Expected an entry object, array of entries, or a lorebook.');
  }

  function openSnippetModal() {
    $('snippet-input').value = '';
    $('snippet-preview').textContent = '';
    $('snippet-modal').classList.remove('hidden');
    $('snippet-input').focus();
  }

  function previewSnippet() {
    const text = $('snippet-input').value.trim();
    if (!text) { $('snippet-preview').textContent = ''; return; }
    try {
      const raw = parseSnippet(text);
      const names = raw.slice(0, 5).map(e => e.name || e.comment || 'Unnamed').join(', ');
      const more = raw.length > 5 ? ` and ${raw.length - 5} more` : '';
      $('snippet-preview').textContent = `Found ${raw.length} entry/entries: ${names}${more}`;
      $('snippet-preview').style.color = 'var(--success)';
    } catch (e) {
      $('snippet-preview').textContent = 'Error: ' + e.message;
      $('snippet-preview').style.color = 'var(--accent)';
    }
  }

  function addSnippet() {
    const text = $('snippet-input').value.trim();
    if (!text) return;

    let rawEntries;
    try {
      rawEntries = parseSnippet(text);
    } catch (e) {
      alert('Invalid snippet: ' + e.message);
      return;
    }

    pushUndo();
    const normalized = rawEntries.map((e, i) => normalizeSnippetEntry(e, i));
    entries.push(...normalized);

    if (!sourceFormat) sourceFormat = 'janitor';

    $('snippet-modal').classList.add('hidden');
    $('snippet-input').value = '';
    render();
    showAutosaveStatus(`Added ${normalized.length} entries`);
  }

  // ---- Restart Workspace ----
  function restartWorkspace() {
    if (!confirm('Clear everything and start fresh? This cannot be undone.')) return;
    entries = [];
    sourceFormat = null;
    selectedIndices.clear();
    undoStack = [];
    activeTagFilter = null;
    clearLocalSave();
    render();
  }

  // ---- Drag & Drop ----
  let dragIndex = null;

  function handleDragStart(e) {
    const card = e.target.closest('.entry-card');
    if (!card) return;
    dragIndex = parseInt(card.dataset.index);
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e) {
    e.preventDefault();
    const card = e.target.closest('.entry-card');
    if (!card) return;
    document.querySelectorAll('.entry-card').forEach(c => c.classList.remove('drag-over'));
    card.classList.add('drag-over');
  }

  function handleDrop(e) {
    e.preventDefault();
    const card = e.target.closest('.entry-card');
    if (!card || dragIndex === null) return;
    const dropIndex = parseInt(card.dataset.index);
    if (dragIndex === dropIndex) return;

    pushUndo();
    const item = entries.splice(dragIndex, 1)[0];
    entries.splice(dropIndex, 0, item);
    dragIndex = null;
    render();
  }

  function handleDragEnd() {
    document.querySelectorAll('.entry-card').forEach(c => {
      c.classList.remove('dragging', 'drag-over');
    });
    dragIndex = null;
  }

  // ---- Event Binding ----
  function init() {
    // Import
    $('btn-import').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => autoDetectAndLoad(reader.result);
      reader.readAsText(file);
      e.target.value = '';
    });

    // Paste
    $('btn-paste').addEventListener('click', () => $('paste-modal').classList.remove('hidden'));
    $('paste-close').addEventListener('click', () => $('paste-modal').classList.add('hidden'));
    $('paste-cancel').addEventListener('click', () => $('paste-modal').classList.add('hidden'));
    $('paste-load').addEventListener('click', () => {
      autoDetectAndLoad($('paste-input').value);
      $('paste-modal').classList.add('hidden');
      $('paste-input').value = '';
    });

    // New Entry
    $('btn-new-entry').addEventListener('click', () => openEditor(-1));

    // Export
    $('btn-export-janitor').addEventListener('click', exportJanitor);
    $('btn-export-st').addEventListener('click', exportSillyTavern);
    $('btn-export-script').addEventListener('click', exportJanitorScript);

    // Panels
    $('btn-find-replace').addEventListener('click', () => {
      $('find-replace-panel').classList.toggle('hidden');
      $('retag-panel').classList.add('hidden');
      $('reindex-panel').classList.add('hidden');
      $('code-editor-panel').classList.add('hidden');
    });

    $('btn-bulk-retag').addEventListener('click', () => {
      $('retag-panel').classList.toggle('hidden');
      $('find-replace-panel').classList.add('hidden');
      $('reindex-panel').classList.add('hidden');
      $('code-editor-panel').classList.add('hidden');
    });

    $('btn-reindex').addEventListener('click', () => {
      $('reindex-panel').classList.toggle('hidden');
      $('find-replace-panel').classList.add('hidden');
      $('retag-panel').classList.add('hidden');
      $('code-editor-panel').classList.add('hidden');
    });

    // Close buttons
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        $(btn.dataset.close).classList.add('hidden');
      });
    });

    // Find & Replace
    $('fr-preview').addEventListener('click', () => findReplace(true));
    $('fr-apply').addEventListener('click', () => findReplace(false));

    // Retag
    $('retag-apply').addEventListener('click', applyRetag);

    // Reindex
    $('reindex-apply').addEventListener('click', applyReindex);

    // Editor modal
    $('editor-close').addEventListener('click', () => $('editor-modal').classList.add('hidden'));
    $('editor-cancel').addEventListener('click', () => $('editor-modal').classList.add('hidden'));
    $('editor-save').addEventListener('click', saveEditor);
    $('editor-delete').addEventListener('click', () => {
      deleteEntry(editingIndex);
      $('editor-modal').classList.add('hidden');
    });

    // Filter
    $('filter-search').addEventListener('input', renderEntries);
    $('filter-category').addEventListener('change', renderEntries);

    $('tag-filters').addEventListener('click', (e) => {
      const chip = e.target.closest('.tag-chip');
      if (!chip) return;
      const tag = chip.dataset.tag;
      activeTagFilter = activeTagFilter === tag ? null : tag;
      renderFilters();
      renderEntries();
    });

    // Code Editor
    $('btn-code-editor').addEventListener('click', openCodeEditor);
    $('code-editor-format').addEventListener('click', formatCodeEditor);
    $('code-editor-apply').addEventListener('click', applyCodeEditor);
    $('code-editor-textarea').addEventListener('input', () => {
      const ta = $('code-editor-textarea');
      try {
        const data = JSON.parse(ta.value);
        ta.classList.remove('json-error');
        $('code-editor-status').textContent = Array.isArray(data) ? `${data.length} entries` : 'Valid JSON';
      } catch {
        ta.classList.add('json-error');
        $('code-editor-status').textContent = 'Invalid JSON';
      }
    });

    // Snippet Import
    $('btn-snippet').addEventListener('click', openSnippetModal);
    $('snippet-close').addEventListener('click', () => $('snippet-modal').classList.add('hidden'));
    $('snippet-cancel').addEventListener('click', () => $('snippet-modal').classList.add('hidden'));
    $('snippet-add').addEventListener('click', addSnippet);
    $('snippet-input').addEventListener('input', previewSnippet);

    // Restart
    $('btn-restart').addEventListener('click', restartWorkspace);

    // Mass Selection
    $('sel-all').addEventListener('click', selectAllVisible);
    $('sel-none').addEventListener('click', deselectAll);
    $('sel-delete').addEventListener('click', massDelete);
    $('sel-add-tags').addEventListener('click', () => openMassModal('add-tags', 'Add Tags to Selected', 'Tags to add (comma separated)', 'tag1, tag2, ...'));
    $('sel-remove-tags').addEventListener('click', () => openMassModal('remove-tags', 'Remove Tags from Selected', 'Tags to remove (comma separated)', 'tag1, tag2, ...'));
    $('sel-add-keys').addEventListener('click', () => openMassModal('add-keys', 'Add Keywords to Selected', 'Keywords to add (comma separated)', 'keyword1, keyword2, ...'));
    $('sel-remove-keys').addEventListener('click', () => openMassModal('remove-keys', 'Remove Keywords from Selected', 'Keywords to remove (comma separated)', 'keyword1, keyword2, ...'));
    $('mass-modal-close').addEventListener('click', closeMassModal);
    $('mass-modal-cancel').addEventListener('click', closeMassModal);
    $('mass-modal-apply').addEventListener('click', applyMassAction);
    $('mass-modal-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyMassAction(); });

    // Entry list delegation
    entryListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      const checkbox = e.target.closest('.entry-checkbox');

      if (checkbox) {
        const idx = parseInt(checkbox.dataset.index);
        if (checkbox.checked) selectedIndices.add(idx);
        else selectedIndices.delete(idx);
        updateSelectionBar();
        return;
      }

      if (btn) {
        const idx = parseInt(btn.dataset.index);
        if (btn.classList.contains('btn-edit')) openEditor(idx);
        else if (btn.classList.contains('btn-dup')) duplicateEntry(idx);
        else if (btn.classList.contains('btn-move-up')) moveEntry(idx, -1);
        else if (btn.classList.contains('btn-move-down')) moveEntry(idx, 1);
        return;
      }

      // Click on card itself opens editor
      const card = e.target.closest('.entry-card');
      if (card && !e.target.closest('.entry-drag-handle') && !e.target.closest('.entry-checkbox')) {
        openEditor(parseInt(card.dataset.index));
      }
    });

    // Drag & Drop
    entryListEl.addEventListener('dragstart', handleDragStart);
    entryListEl.addEventListener('dragover', handleDragOver);
    entryListEl.addEventListener('drop', handleDrop);
    entryListEl.addEventListener('dragend', handleDragEnd);

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    });

    // Restore from localStorage if available
    if (loadFromLocal()) {
      showAutosaveStatus('Restored from local save');
    }

    render();
  }

  init();
})();
