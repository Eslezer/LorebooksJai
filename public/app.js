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
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
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
    $('btn-find-replace').disabled = !has;
    $('btn-bulk-retag').disabled = !has;
    $('btn-reindex').disabled = !has;
  }

  // ---- Rendering ----
  function render() {
    updateToolbar();
    // Autosave on every render (which follows every mutation)
    if (entries.length) saveToLocal();

    if (!entries.length) {
      emptyStateEl.classList.remove('hidden');
      entryListEl.classList.add('hidden');
      filterBar.classList.add('hidden');
      return;
    }

    emptyStateEl.classList.add('hidden');
    entryListEl.classList.remove('hidden');
    filterBar.classList.remove('hidden');

    renderFilters();
    renderEntries();
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

  // ---- Import / Load ----
  function loadData(data, format) {
    if (format === 'janitor') {
      entries = data;
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
          extensions: {},
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
          minMessages: 0,
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
    } catch (e) {
      alert('Invalid JSON: ' + e.message);
      return;
    }

    if (Array.isArray(data)) {
      loadData(data, 'janitor');
    } else if (data.entries && typeof data.entries === 'object') {
      loadData(data, 'sillytavern');
    } else {
      alert('Unrecognized lorebook format. Expected a JanitorAI array or SillyTavern object with "entries".');
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
        displayIndex: idx,
        extensions: {
          janitor_id: entry.id || '',
          janitor_category: entry.category || '',
          janitor_tags: entry.tags || [],
          janitor_priority: entry.priority || 0,
          janitor_activationMode: entry.activationMode || 'standard'
        }
      };
    });
    downloadJSON(stData, 'lorebook-sillytavern.json');
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

    const obj = {
      activationMode: $('ed-activation-mode').value,
      activationScript: '',
      case_sensitive: $('ed-case-sensitive').checked,
      category: $('ed-category').value,
      comment: '',
      constant: $('ed-constant').checked,
      content: $('ed-content').value,
      enabled: $('ed-enabled').checked,
      extensions: {},
      groupWeight: 100,
      id: $('ed-id').value,
      inclusionGroupRaw: '',
      insertion_order: parseInt($('ed-insertion-order').value) || 0,
      key: keys,
      keyMatchPriority: false,
      keysecondary: secKeys,
      keysecondaryRaw: secKeys.join(', '),
      keysRaw: keys.join(', '),
      matchWholeWords: $('ed-match-whole').checked,
      minMessages: 0,
      name: $('ed-name').value,
      prioritizeInclusion: false,
      priority: newPriority,
      probability: parseInt($('ed-probability').value) || 100,
      selectiveLogic: 0,
      tags: tags,
      keywordsRaw: keys.join(', ')
    };

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

    // Panels
    $('btn-find-replace').addEventListener('click', () => {
      $('find-replace-panel').classList.toggle('hidden');
      $('retag-panel').classList.add('hidden');
      $('reindex-panel').classList.add('hidden');
    });

    $('btn-bulk-retag').addEventListener('click', () => {
      $('retag-panel').classList.toggle('hidden');
      $('find-replace-panel').classList.add('hidden');
      $('reindex-panel').classList.add('hidden');
    });

    $('btn-reindex').addEventListener('click', () => {
      $('reindex-panel').classList.toggle('hidden');
      $('find-replace-panel').classList.add('hidden');
      $('retag-panel').classList.add('hidden');
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

    // Entry list delegation
    entryListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      const checkbox = e.target.closest('.entry-checkbox');

      if (checkbox) {
        const idx = parseInt(checkbox.dataset.index);
        if (checkbox.checked) selectedIndices.add(idx);
        else selectedIndices.delete(idx);
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
