const express = require('express');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// --- Format Conversion Utilities ---

function janitorToSillyTavern(entries) {
  return {
    entries: entries.reduce((acc, entry, idx) => {
      acc[idx] = {
        uid: idx,
        key: entry.keysRaw ? entry.keysRaw.split(',').map(k => k.trim()).filter(Boolean) : (entry.key || []),
        keysecondary: entry.keysecondary || [],
        comment: entry.name || entry.comment || '',
        content: entry.content || '',
        constant: entry.constant || false,
        selective: entry.keysecondary && entry.keysecondary.length > 0,
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
        group: '',
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
      return acc;
    }, {})
  };
}

function sillyTavernToJanitor(stData) {
  const entries = stData.entries || {};
  return Object.values(entries).map((entry, idx) => {
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

// --- API Routes ---

app.post('/api/convert/janitor-to-sillytavern', (req, res) => {
  try {
    const entries = req.body;
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'Expected a JSON array of JanitorAI entries' });
    }
    const result = janitorToSillyTavern(entries);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/convert/sillytavern-to-janitor', (req, res) => {
  try {
    const stData = req.body;
    if (!stData.entries) {
      return res.status(400).json({ error: 'Expected SillyTavern lorebook format with "entries" object' });
    }
    const result = sillyTavernToJanitor(stData);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const text = req.file.buffer.toString('utf-8');
    const data = JSON.parse(text);

    // Auto-detect format
    if (Array.isArray(data)) {
      // JanitorAI format (array of entries)
      res.json({ format: 'janitor', data });
    } else if (data.entries && typeof data.entries === 'object') {
      // SillyTavern format
      res.json({ format: 'sillytavern', data });
    } else {
      res.status(400).json({ error: 'Unrecognized lorebook format' });
    }
  } catch (e) {
    res.status(400).json({ error: 'Invalid JSON file: ' + e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Lorebook Editor running on http://localhost:${PORT}`);
});
