const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const initSqlJs = require('sql.js')

let mainWindow = null
let currentWorkspace = ''
let sqlPromise = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'paper-cover',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
])

const now = () => new Date().toISOString()
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`

const safeName = (value) => {
  const cleaned = String(value || 'file')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return cleaned || 'file'
}

const uniqueFileName = (originalName) => {
  const parsed = path.parse(originalName || 'file')
  const suffix = crypto.randomUUID().slice(0, 8)
  return `${suffix}_${safeName(parsed.name)}${parsed.ext ? safeName(parsed.ext) : ''}`
}

const newAssetFileSpecs = {
  md: { extension: '.md', assetType: 'markdown', mimeType: 'text/markdown' },
  docx: {
    extension: '.docx',
    assetType: 'word',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  pptx: {
    extension: '.pptx',
    assetType: 'slides',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  xlsx: {
    extension: '.xlsx',
    assetType: 'data',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
}

const normalizeCreatedFileName = (input = {}) => {
  const spec = newAssetFileSpecs[input.fileType]
  if (!spec) throw new Error('Unsupported file type.')

  const cleaned = String(input.fileName || '')
    .trim()
    .replace(/[\\/]+/g, '-')
  const parsed = path.parse(cleaned || 'Untitled')
  const stem = safeName(parsed.name || cleaned || 'Untitled')
  return `${stem}${spec.extension}`
}

const uniqueCreatedFileName = async (directory, desiredName) => {
  const parsed = path.parse(desiredName)
  let candidate = `${parsed.name}${parsed.ext}`
  let index = 2

  while (fs.existsSync(path.join(directory, candidate))) {
    candidate = `${parsed.name}-${index}${parsed.ext}`
    index += 1
  }

  return candidate
}

const versionArchiveName = async (directory, originalName, label, note) => {
  const parsed = path.parse(originalName || 'asset')
  const stem = safeName(parsed.name)
  const ext = parsed.ext || ''
  const labelPart = safeName(label)
  const notePart = safeName(note)
  const baseName = `${stem}-${labelPart}-${notePart}${ext}`
  let candidate = baseName
  let index = 2

  while (fs.existsSync(path.join(directory, candidate))) {
    candidate = `${stem}-${labelPart}-${notePart}-${index}${ext}`
    index += 1
  }

  return candidate
}

const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return crc >>> 0
})

const crc32 = (buffer) => {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const dosDateTime = (date = new Date()) => {
  const year = Math.max(date.getFullYear(), 1980)
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { dosTime, dosDate }
}

const createZip = (files) => {
  const localParts = []
  const centralParts = []
  let offset = 0
  const { dosTime, dosDate } = dosDateTime()

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)

    offset += local.length + name.length + data.length
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, ...centralParts, end])
}

const buildBlankDocx = () =>
  createZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p/><w:sectPr/></w:body>
</w:document>`,
    },
  ])

const buildBlankXlsx = () =>
  createZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`,
    },
  ])

const buildBlankPptx = () =>
  createZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
    },
    {
      name: 'ppt/presentation.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>
</p:presentation>`,
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`,
    },
    {
      name: 'ppt/slides/slide1.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
</p:sld>`,
    },
  ])

const buildBlankAssetFile = (fileType) => {
  if (fileType === 'md') return Buffer.from('# Untitled\n', 'utf8')
  if (fileType === 'docx') return buildBlankDocx()
  if (fileType === 'pptx') return buildBlankPptx()
  if (fileType === 'xlsx') return buildBlankXlsx()
  throw new Error('Unsupported file type.')
}

const tagsToJson = (tags) => JSON.stringify(Array.isArray(tags) ? tags : [])
const tagsFromJson = (value) => {
  try {
    return JSON.parse(value || '[]')
  } catch {
    return []
  }
}

const getSql = async () => {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => {
        const unpackedPath = path.join(
          process.resourcesPath || '',
          'app.asar.unpacked',
          'node_modules',
          'sql.js',
          'dist',
          file,
        )

        if (app.isPackaged && fs.existsSync(unpackedPath)) {
          return unpackedPath
        }

        return path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file)
      },
    })
  }
  return sqlPromise
}

const appDataDir = (workspace) => path.join(workspace, '.paper-timeline-workbench')
const dbPath = (workspace) => path.join(appDataDir(workspace), 'paper_timeline.sqlite')

const openDb = async () => {
  if (!currentWorkspace) throw new Error('Please select a workspace first.')

  await fsp.mkdir(appDataDir(currentWorkspace), { recursive: true })
  const SQL = await getSql()
  const file = dbPath(currentWorkspace)
  const db = fs.existsSync(file)
    ? new SQL.Database(await fsp.readFile(file))
    : new SQL.Database()
  initDb(db)
  return { db, file }
}

const saveDb = async (db, file) => {
  const data = db.export()
  await fsp.writeFile(file, Buffer.from(data))
  db.close()
}

const run = (db, sql, params = []) => {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  while (stmt.step()) {
    // Consume the statement.
  }
  stmt.free()
}

const rows = (db, sql, params = []) => {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const result = []
  while (stmt.step()) {
    result.push(stmt.get())
  }
  stmt.free()
  return result
}

const scalar = (db, sql, params = []) => rows(db, sql, params)[0]?.[0] ?? null

const ensureColumn = (db, tableName, columnName, definition) => {
  const columns = rows(db, `PRAGMA table_info(${tableName})`)
  const exists = columns.some((column) => column[1] === columnName)
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  }
}

const initDb = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      research_direction TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'idea',
      target_venue TEXT NOT NULL DEFAULT '',
      cover_path TEXT NOT NULL DEFAULT '',
      workspace_path TEXT NOT NULL,
      tags TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      tags TEXT NOT NULL,
      current_version_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_versions (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      label TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL,
      asset_id TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_plan_ranges (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      color TEXT NOT NULL,
      is_deadline INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      asset_id TEXT,
      idea_id TEXT,
      version_id TEXT,
      event_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_summaries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      day TEXT NOT NULL,
      summary TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, day)
    );
  `)
  ensureColumn(db, 'ideas', 'completed', 'INTEGER NOT NULL DEFAULT 0')
}

const detectFileType = (name) => {
  const ext = path.extname(name).slice(1).toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx'].includes(ext)) return 'word'
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'slides'
  if (['md', 'markdown'].includes(ext)) return 'markdown'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (['csv', 'tsv', 'xlsx', 'xls', 'json'].includes(ext)) return 'data'
  return 'other'
}

const rowToProject = (row) => ({
  id: row[0],
  title: row[1],
  description: row[2],
  researchDirection: row[3],
  stage: row[4],
  targetVenue: row[5],
  coverPath: row[6],
  workspacePath: row[7],
  tags: tagsFromJson(row[8]),
  createdAt: row[9],
  updatedAt: row[10],
})

const rowToAsset = (row) => ({
  id: row[0],
  projectId: row[1],
  title: row[2],
  originalName: row[3],
  fileName: row[4],
  filePath: row[5],
  fileType: row[6],
  mimeType: row[7],
  sizeBytes: row[8],
  tags: tagsFromJson(row[9]),
  currentVersionId: row[10],
  createdAt: row[11],
  updatedAt: row[12],
})

const rowToVersion = (row) => ({
  id: row[0],
  assetId: row[1],
  label: row[2],
  fileName: row[3],
  filePath: row[4],
  sizeBytes: row[5],
  note: row[6],
  createdAt: row[7],
})

const rowToIdea = (row) => ({
  id: row[0],
  projectId: row[1],
  title: row[2],
  content: row[3],
  tags: tagsFromJson(row[4]),
  assetId: row[5],
  completed: Boolean(row[6]),
  createdAt: row[7],
  updatedAt: row[8],
})

const rowToPlanRange = (row) => ({
  id: row[0],
  projectId: row[1],
  title: row[2],
  description: row[3],
  startDate: row[4],
  endDate: row[5],
  color: row[6],
  isDeadline: Boolean(row[7]),
  createdAt: row[8],
  updatedAt: row[9],
})

const rowToEvent = (row) => ({
  id: row[0],
  projectId: row[1],
  eventType: row[2],
  title: row[3],
  description: row[4],
  assetId: row[5],
  ideaId: row[6],
  versionId: row[7],
  eventDate: row[8],
})

const rowToSummary = (row) => ({
  id: row[0],
  projectId: row[1],
  day: row[2],
  summary: row[3],
  updatedAt: row[4],
})

const selectProjectSql = `
  SELECT id, title, description, research_direction, stage, target_venue, cover_path,
         workspace_path, tags, created_at, updated_at
  FROM projects
`

const getProject = (db, projectId) =>
  rows(db, `${selectProjectSql} WHERE id = ?`, [projectId]).map(rowToProject)[0]

const getAsset = (db, assetId) =>
  rows(
    db,
    `SELECT id, project_id, title, original_name, file_name, file_path, file_type, mime_type,
            size_bytes, tags, current_version_id, created_at, updated_at
     FROM assets WHERE id = ?`,
    [assetId],
  ).map(rowToAsset)[0]

const getVersion = (db, versionId) =>
  rows(
    db,
    `SELECT id, asset_id, label, file_name, file_path, size_bytes, note, created_at
     FROM asset_versions WHERE id = ?`,
    [versionId],
  ).map(rowToVersion)[0]

const getIdea = (db, ideaId) =>
  rows(
    db,
    `SELECT id, project_id, title, content, tags, asset_id, completed, created_at, updated_at
     FROM ideas WHERE id = ?`,
    [ideaId],
  ).map(rowToIdea)[0]

const getPlanRange = (db, rangeId) =>
  rows(
    db,
    `SELECT id, project_id, title, description, start_date, end_date, color, is_deadline,
            created_at, updated_at
     FROM project_plan_ranges WHERE id = ?`,
    [rangeId],
  ).map(rowToPlanRange)[0]

const getTimelineEvent = (db, eventId) =>
  rows(
    db,
    `SELECT id, project_id, event_type, title, description, asset_id, idea_id, version_id, event_date
     FROM timeline_events WHERE id = ?`,
    [eventId],
  ).map(rowToEvent)[0]

const getTimelineEvents = (db, projectId) =>
  rows(
    db,
    `SELECT id, project_id, event_type, title, description, asset_id, idea_id, version_id, event_date
     FROM timeline_events WHERE project_id = ? ORDER BY event_date ASC`,
    [projectId],
  ).map(rowToEvent)

const refreshAssetMetadata = async (db, assetId, options = {}) => {
  const asset = getAsset(db, assetId)
  if (!asset) throw new Error(`Asset not found: ${assetId}`)

  let stat
  try {
    stat = await fsp.stat(asset.filePath)
  } catch {
    return asset
  }

  const modifiedAt = stat.mtime.toISOString()
  const previousModifiedAt = Date.parse(asset.updatedAt)
  const nextModifiedAt = Date.parse(modifiedAt)
  const changed =
    Number.isNaN(previousModifiedAt) ||
    Math.abs(nextModifiedAt - previousModifiedAt) > 1000 ||
    Number(asset.sizeBytes) !== Number(stat.size)

  if (!changed) return asset

  run(
    db,
    `UPDATE assets SET size_bytes = ?, updated_at = ? WHERE id = ?`,
    [stat.size, modifiedAt, assetId],
  )

  if (options.recordEvent !== false) {
    insertEvent(
      db,
      asset.projectId,
      'asset_updated',
      `Update asset: ${asset.title}`,
      `Last modified: ${modifiedAt}`,
      assetId,
    )
  }

  return getAsset(db, assetId)
}

const insertEvent = (db, projectId, eventType, title, description, assetId = null, ideaId = null, versionId = null) => {
  run(
    db,
    `INSERT INTO timeline_events
     (id, project_id, event_type, title, description, asset_id, idea_id, version_id, event_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id('event'), projectId, eventType, title, description || '', assetId, ideaId, versionId, now()],
  )
}

const listProjects = (db) =>
  rows(db, `${selectProjectSql} ORDER BY updated_at DESC`).map(rowToProject)

const getProjectBundle = (db, projectId) => {
  const assets = rows(
    db,
    `SELECT id, project_id, title, original_name, file_name, file_path, file_type, mime_type,
            size_bytes, tags, current_version_id, created_at, updated_at
     FROM assets WHERE project_id = ? ORDER BY updated_at DESC`,
    [projectId],
  ).map(rowToAsset)
  const assetIds = new Set(assets.map((asset) => asset.id))
  const versions = rows(
    db,
    `SELECT v.id, v.asset_id, v.label, v.file_name, v.file_path, v.size_bytes, v.note, v.created_at
     FROM asset_versions v
     INNER JOIN assets a ON a.id = v.asset_id
     WHERE a.project_id = ?
     ORDER BY v.created_at DESC`,
    [projectId],
  ).map(rowToVersion)

  return {
    assets,
    versions: versions.filter((version) => assetIds.has(version.assetId)),
    ideas: rows(
      db,
      `SELECT id, project_id, title, content, tags, asset_id, completed, created_at, updated_at
       FROM ideas WHERE project_id = ? ORDER BY updated_at DESC`,
      [projectId],
    ).map(rowToIdea),
    planRanges: rows(
      db,
      `SELECT id, project_id, title, description, start_date, end_date, color, is_deadline,
              created_at, updated_at
       FROM project_plan_ranges WHERE project_id = ? ORDER BY start_date ASC, end_date ASC`,
      [projectId],
    ).map(rowToPlanRange),
    events: rows(
      db,
      `SELECT id, project_id, event_type, title, description, asset_id, idea_id, version_id, event_date
       FROM timeline_events WHERE project_id = ? ORDER BY event_date DESC`,
      [projectId],
    ).map(rowToEvent),
    summaries: rows(
      db,
      `SELECT id, project_id, day, summary, updated_at
       FROM daily_summaries WHERE project_id = ? ORDER BY day DESC`,
      [projectId],
    ).map(rowToSummary),
  }
}

const syncProjectAssetMetadata = async (db, projectId) => {
  const assets = rows(db, 'SELECT id FROM assets WHERE project_id = ?', [projectId])
  for (const [assetId] of assets) {
    await refreshAssetMetadata(db, assetId)
  }
}

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'Paper Timeline Workbench',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.setMenu(null)

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

const registerLocalFileProtocol = () => {
  protocol.handle('paper-cover', (request) => {
    const url = new URL(request.url)
    const targetPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))

    if (!targetPath || !path.isAbsolute(targetPath)) {
      return new Response('Invalid cover path', { status: 400 })
    }

    return net.fetch(pathToFileURL(targetPath).toString())
  })
}

const handle = (channel, fn) => {
  ipcMain.handle(channel, async (_event, args = {}) => fn(args))
}

handle('choose_workspace', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Paper Timeline Workspace',
    properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

handle('set_workspace', async ({ workspacePath }) => {
  currentWorkspace = workspacePath
  await fsp.mkdir(currentWorkspace, { recursive: true })
  const { db, file } = await openDb()
  const projects = listProjects(db)
  await saveDb(db, file)
  return { workspacePath: currentWorkspace, projects }
})

handle('list_projects', async () => {
  const { db, file } = await openDb()
  const projects = listProjects(db)
  await saveDb(db, file)
  return projects
})

handle('create_project', async ({ input }) => {
  const { db, file } = await openDb()
  const timestamp = now()
  const projectId = id('project')
  const projectDir = path.join(currentWorkspace, 'projects', `${safeName(input.title)}_${projectId.slice(-8)}`)
  await fsp.mkdir(path.join(projectDir, 'assets'), { recursive: true })
  await fsp.mkdir(path.join(projectDir, 'versions'), { recursive: true })
  await fsp.mkdir(path.join(projectDir, 'covers'), { recursive: true })

  run(
    db,
    `INSERT INTO projects
     (id, title, description, research_direction, stage, target_venue, cover_path,
      workspace_path, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      input.title,
      input.description,
      input.researchDirection,
      input.stage,
      input.targetVenue,
      '',
      projectDir,
      tagsToJson(input.tags),
      timestamp,
      timestamp,
    ],
  )
  insertEvent(db, projectId, 'project_created', `Create project: ${input.title}`, input.description)
  const project = getProject(db, projectId)
  await saveDb(db, file)
  return project
})

handle('update_project', async ({ projectId, input }) => {
  const { db, file } = await openDb()
  const timestamp = now()
  run(
    db,
    `UPDATE projects
     SET title = ?, description = ?, research_direction = ?, stage = ?, target_venue = ?,
         tags = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.title,
      input.description,
      input.researchDirection,
      input.stage,
      input.targetVenue,
      tagsToJson(input.tags),
      timestamp,
      projectId,
    ],
  )
  insertEvent(db, projectId, 'asset_updated', `Update project: ${input.title}`, input.description)
  const project = getProject(db, projectId)
  await saveDb(db, file)
  return project
})

handle('set_project_cover', async ({ projectId }) => {
  const { db, file } = await openDb()
  const project = getProject(db, projectId)
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose project cover',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  })
  if (result.canceled) {
    await saveDb(db, file)
    return project
  }

  const source = result.filePaths[0]
  const coversDir = path.join(project.workspacePath, 'covers')
  await fsp.mkdir(coversDir, { recursive: true })
  const destination = path.join(coversDir, uniqueFileName(path.basename(source)))
  await fsp.copyFile(source, destination)
  run(db, `UPDATE projects SET cover_path = ?, updated_at = ? WHERE id = ?`, [destination, now(), projectId])
  insertEvent(db, projectId, 'asset_updated', 'Set project cover', 'Project cover updated')
  const updated = getProject(db, projectId)
  await saveDb(db, file)
  return updated
})

handle('get_project_bundle', async ({ projectId }) => {
  const { db, file } = await openDb()
  await syncProjectAssetMetadata(db, projectId)
  const bundle = getProjectBundle(db, projectId)
  await saveDb(db, file)
  return bundle
})

handle('import_assets', async ({ projectId }) => {
  const { db, file } = await openDb()
  const project = getProject(db, projectId)
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import assets into project workspace',
    properties: ['openFile', 'multiSelections'],
  })
  if (result.canceled) {
    await saveDb(db, file)
    return []
  }

  const imported = []
  const assetDir = path.join(project.workspacePath, 'assets')
  await fsp.mkdir(assetDir, { recursive: true })

  for (const source of result.filePaths) {
    const originalName = path.basename(source)
    const fileName = uniqueFileName(originalName)
    const destination = path.join(assetDir, fileName)
    await fsp.copyFile(source, destination)
    const stat = await fsp.stat(destination)
    const assetId = id('asset')
    const versionId = id('version')
    const timestamp = now()
    const modifiedAt = stat.mtime.toISOString()
    const fileType = detectFileType(originalName)
    const versionDir = path.join(project.workspacePath, 'versions', assetId)
    await fsp.mkdir(versionDir, { recursive: true })
    const versionFileName = await versionArchiveName(versionDir, originalName, 'v1', 'initial-import')
    const versionDestination = path.join(versionDir, versionFileName)
    await fsp.copyFile(destination, versionDestination)

    run(
      db,
      `INSERT INTO assets
       (id, project_id, title, original_name, file_name, file_path, file_type, mime_type,
        size_bytes, tags, current_version_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        assetId,
        projectId,
        originalName,
        originalName,
        fileName,
        destination,
        fileType,
        '',
        stat.size,
        '[]',
        versionId,
        timestamp,
        modifiedAt,
      ],
    )
    run(
      db,
      `INSERT INTO asset_versions
       (id, asset_id, label, file_name, file_path, size_bytes, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [versionId, assetId, 'v1', versionFileName, versionDestination, stat.size, 'Initial import', timestamp],
    )
    insertEvent(db, projectId, 'asset_imported', `Import asset: ${originalName}`, source, assetId, null, versionId)
    imported.push(getAsset(db, assetId))
  }

  await saveDb(db, file)
  return imported
})

handle('create_asset_file', async ({ projectId, input }) => {
  const requestedName = String(input?.fileName || '').trim()
  if (!requestedName) throw new Error('File name is required.')

  const { db, file } = await openDb()
  const project = getProject(db, projectId)
  if (!project) {
    await saveDb(db, file)
    throw new Error(`Project not found: ${projectId}`)
  }

  const spec = newAssetFileSpecs[input.fileType]
  if (!spec) {
    await saveDb(db, file)
    throw new Error('Unsupported file type.')
  }

  const assetDir = path.join(project.workspacePath, 'assets')
  await fsp.mkdir(assetDir, { recursive: true })
  const originalName = normalizeCreatedFileName(input)
  const fileName = await uniqueCreatedFileName(assetDir, originalName)
  const destination = path.join(assetDir, fileName)
  await fsp.writeFile(destination, buildBlankAssetFile(input.fileType))

  const stat = await fsp.stat(destination)
  const assetId = id('asset')
  const versionId = id('version')
  const timestamp = now()
  const modifiedAt = stat.mtime.toISOString()
  const versionDir = path.join(project.workspacePath, 'versions', assetId)
  await fsp.mkdir(versionDir, { recursive: true })
  const versionFileName = await versionArchiveName(versionDir, fileName, 'v1', 'initial-file')
  const versionDestination = path.join(versionDir, versionFileName)
  await fsp.copyFile(destination, versionDestination)

  run(
    db,
    `INSERT INTO assets
     (id, project_id, title, original_name, file_name, file_path, file_type, mime_type,
      size_bytes, tags, current_version_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      assetId,
      projectId,
      fileName,
      fileName,
      fileName,
      destination,
      spec.assetType,
      spec.mimeType,
      stat.size,
      '[]',
      versionId,
      timestamp,
      modifiedAt,
    ],
  )
  run(
    db,
    `INSERT INTO asset_versions
     (id, asset_id, label, file_name, file_path, size_bytes, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [versionId, assetId, 'v1', versionFileName, versionDestination, stat.size, 'Initial blank file', timestamp],
  )
  run(db, 'UPDATE projects SET updated_at = ? WHERE id = ?', [timestamp, projectId])
  insertEvent(db, projectId, 'asset_imported', `Create asset: ${fileName}`, destination, assetId, null, versionId)
  const bundle = getProjectBundle(db, projectId)
  await saveDb(db, file)
  return bundle
})

handle('delete_asset', async ({ assetId }) => {
  const { db, file } = await openDb()
  const asset = getAsset(db, assetId)
  if (!asset) {
    await saveDb(db, file)
    throw new Error(`Asset not found: ${assetId}`)
  }

  const versions = rows(
    db,
    `SELECT id, asset_id, label, file_name, file_path, size_bytes, note, created_at
     FROM asset_versions WHERE asset_id = ?`,
    [assetId],
  ).map(rowToVersion)

  for (const target of [asset.filePath, ...versions.map((version) => version.filePath)]) {
    try {
      await fsp.rm(target, { force: true })
    } catch {
      // Ignore missing files; database cleanup still needs to proceed.
    }
  }

  try {
    await fsp.rm(path.join(getProject(db, asset.projectId).workspacePath, 'versions', assetId), {
      recursive: true,
      force: true,
    })
  } catch {
    // Ignore missing version directory.
  }

  run(db, 'DELETE FROM asset_versions WHERE asset_id = ?', [assetId])
  run(db, 'DELETE FROM assets WHERE id = ?', [assetId])
  run(db, 'UPDATE ideas SET asset_id = NULL, updated_at = ? WHERE asset_id = ?', [now(), assetId])
  insertEvent(db, asset.projectId, 'asset_updated', `Delete asset: ${asset.title}`, asset.filePath)
  const bundle = getProjectBundle(db, asset.projectId)
  await saveDb(db, file)
  return bundle
})

handle('open_asset', async ({ assetId }) => {
  const { db, file } = await openDb()
  const asset = getAsset(db, assetId)
  await saveDb(db, file)
  await shell.openPath(asset.filePath)
})

handle('reveal_asset', async ({ assetId }) => {
  const { db, file } = await openDb()
  const asset = getAsset(db, assetId)
  await saveDb(db, file)
  shell.showItemInFolder(asset.filePath)
})

handle('refresh_asset_metadata', async ({ assetId }) => {
  const { db, file } = await openDb()
  const asset = await refreshAssetMetadata(db, assetId)
  const bundle = getProjectBundle(db, asset.projectId)
  await saveDb(db, file)
  return bundle
})

handle('save_asset_version', async ({ assetId, label, note }) => {
  const versionLabel = String(label || '').trim()
  const versionNote = String(note || '').trim()

  if (!versionLabel || !versionNote) {
    throw new Error('Version label and change description are required.')
  }

  const { db, file } = await openDb()
  const refreshedAsset = await refreshAssetMetadata(db, assetId)
  const asset = getAsset(db, refreshedAsset.id)
  const project = getProject(db, asset.projectId)
  const versionDir = path.join(project.workspacePath, 'versions', assetId)
  await fsp.mkdir(versionDir, { recursive: true })

  const fileName = await versionArchiveName(versionDir, asset.originalName || asset.fileName, versionLabel, versionNote)
  const destination = path.join(versionDir, fileName)
  await fsp.copyFile(asset.filePath, destination)
  const stat = await fsp.stat(destination)
  const versionId = id('version')
  const timestamp = now()

  run(
    db,
    `INSERT INTO asset_versions
     (id, asset_id, label, file_name, file_path, size_bytes, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [versionId, assetId, versionLabel, fileName, destination, stat.size, versionNote, timestamp],
  )
  run(
    db,
    `UPDATE assets
     SET current_version_id = ?, size_bytes = ?, updated_at = ?
     WHERE id = ?`,
    [versionId, stat.size, asset.updatedAt, assetId],
  )
  insertEvent(
    db,
    asset.projectId,
    'version_saved',
    `Save version: ${asset.title}`,
    `${versionLabel}: ${versionNote}`,
    assetId,
    null,
    versionId,
  )
  const bundle = getProjectBundle(db, asset.projectId)
  await saveDb(db, file)
  return bundle
})

handle('open_asset_version', async ({ versionId }) => {
  const { db, file } = await openDb()
  const version = getVersion(db, versionId)
  await saveDb(db, file)

  if (!version) {
    throw new Error(`Version not found: ${versionId}`)
  }

  await shell.openPath(version.filePath)
})

handle('create_idea', async ({ projectId, title, content, tags, assetId }) => {
  const { db, file } = await openDb()
  const ideaId = id('idea')
  const timestamp = now()
  run(
    db,
    `INSERT INTO ideas (id, project_id, title, content, tags, asset_id, completed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ideaId, projectId, title, content, tagsToJson(tags), assetId, 0, timestamp, timestamp],
  )
  insertEvent(db, projectId, 'idea_created', `Record idea: ${title}`, content, assetId, ideaId)
  const idea = getIdea(db, ideaId)
  await saveDb(db, file)
  return idea
})

handle('update_idea', async ({ ideaId, title, content, tags, assetId, completed }) => {
  const { db, file } = await openDb()
  const existing = getIdea(db, ideaId)
  if (!existing) {
    await saveDb(db, file)
    throw new Error(`Idea not found: ${ideaId}`)
  }

  const nextTitle = String(title || '').trim()
  const nextContent = String(content || '').trim()
  if (!nextTitle || !nextContent) {
    await saveDb(db, file)
    throw new Error('Idea title and content are required.')
  }

  const timestamp = now()
  run(
    db,
    `UPDATE ideas
     SET title = ?, content = ?, tags = ?, asset_id = ?, completed = ?, updated_at = ?
     WHERE id = ?`,
    [
      nextTitle,
      nextContent,
      tagsToJson(tags),
      assetId || null,
      completed ? 1 : 0,
      timestamp,
      ideaId,
    ],
  )
  insertEvent(
    db,
    existing.projectId,
    'idea_updated',
    `Update idea: ${nextTitle}`,
    completed ? 'Marked as completed' : nextContent,
    assetId || null,
    ideaId,
  )
  const idea = getIdea(db, ideaId)
  await saveDb(db, file)
  return idea
})

handle('delete_idea', async ({ ideaId }) => {
  const { db, file } = await openDb()
  const idea = getIdea(db, ideaId)
  if (!idea) {
    await saveDb(db, file)
    throw new Error(`Idea not found: ${ideaId}`)
  }

  run(db, 'DELETE FROM ideas WHERE id = ?', [ideaId])
  insertEvent(db, idea.projectId, 'idea_deleted', `Delete idea: ${idea.title}`, idea.content, idea.assetId, ideaId)
  const bundle = getProjectBundle(db, idea.projectId)
  await saveDb(db, file)
  return bundle
})

handle('create_plan_range', async ({ projectId, input }) => {
  const { db, file } = await openDb()
  const rangeId = id('plan')
  const timestamp = now()
  const startDate = String(input.startDate || '').trim()
  const endDate = String(input.endDate || '').trim()
  const title = String(input.title || '').trim()

  if (!title || !startDate || !endDate) {
    await saveDb(db, file)
    throw new Error('Plan title, start date, and end date are required.')
  }

  if (startDate > endDate) {
    await saveDb(db, file)
    throw new Error('Plan start date cannot be later than end date.')
  }

  run(
    db,
    `INSERT INTO project_plan_ranges
     (id, project_id, title, description, start_date, end_date, color, is_deadline, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rangeId,
      projectId,
      title,
      String(input.description || '').trim(),
      startDate,
      endDate,
      String(input.color || 'blue'),
      input.isDeadline ? 1 : 0,
      timestamp,
      timestamp,
    ],
  )
  run(db, 'UPDATE projects SET updated_at = ? WHERE id = ?', [timestamp, projectId])
  const bundle = getProjectBundle(db, projectId)
  await saveDb(db, file)
  return bundle
})

handle('update_plan_range', async ({ rangeId, input }) => {
  const { db, file } = await openDb()
  const existing = getPlanRange(db, rangeId)
  if (!existing) {
    await saveDb(db, file)
    throw new Error(`Plan range not found: ${rangeId}`)
  }

  const startDate = String(input.startDate || '').trim()
  const endDate = String(input.endDate || '').trim()
  const title = String(input.title || '').trim()
  if (!title || !startDate || !endDate) {
    await saveDb(db, file)
    throw new Error('Plan title, start date, and end date are required.')
  }

  if (startDate > endDate) {
    await saveDb(db, file)
    throw new Error('Plan start date cannot be later than end date.')
  }

  const timestamp = now()
  run(
    db,
    `UPDATE project_plan_ranges
     SET title = ?, description = ?, start_date = ?, end_date = ?, color = ?, is_deadline = ?, updated_at = ?
     WHERE id = ?`,
    [
      title,
      String(input.description || '').trim(),
      startDate,
      endDate,
      String(input.color || 'blue'),
      input.isDeadline ? 1 : 0,
      timestamp,
      rangeId,
    ],
  )
  run(db, 'UPDATE projects SET updated_at = ? WHERE id = ?', [timestamp, existing.projectId])
  const updated = getPlanRange(db, rangeId)
  await saveDb(db, file)
  return updated
})

handle('delete_plan_range', async ({ rangeId }) => {
  const { db, file } = await openDb()
  const existing = getPlanRange(db, rangeId)
  if (!existing) {
    await saveDb(db, file)
    throw new Error(`Plan range not found: ${rangeId}`)
  }

  const timestamp = now()
  run(db, 'DELETE FROM project_plan_ranges WHERE id = ?', [rangeId])
  run(db, 'UPDATE projects SET updated_at = ? WHERE id = ?', [timestamp, existing.projectId])
  const bundle = getProjectBundle(db, existing.projectId)
  await saveDb(db, file)
  return bundle
})

handle('save_daily_summary', async ({ projectId, day, summary }) => {
  const { db, file } = await openDb()
  const timestamp = now()
  const existingId = scalar(
    db,
    'SELECT id FROM daily_summaries WHERE project_id = ? AND day = ?',
    [projectId, day],
  )
  const summaryId = existingId || id('summary')
  run(
    db,
    `INSERT OR REPLACE INTO daily_summaries (id, project_id, day, summary, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [summaryId, projectId, day, summary, timestamp],
  )
  insertEvent(db, projectId, 'daily_summary', `Update daily summary: ${day}`, summary)
  const saved = rows(
    db,
    `SELECT id, project_id, day, summary, updated_at FROM daily_summaries WHERE id = ?`,
    [summaryId],
  ).map(rowToSummary)[0]
  await saveDb(db, file)
  return saved
})

handle('update_timeline_event', async ({ eventId, title, description }) => {
  const { db, file } = await openDb()
  run(
    db,
    'UPDATE timeline_events SET title = ?, description = ? WHERE id = ?',
    [String(title || '').trim(), String(description || '').trim(), eventId],
  )
  const event = getTimelineEvent(db, eventId)
  await saveDb(db, file)
  return event
})

handle('delete_timeline_event', async ({ eventId }) => {
  const { db, file } = await openDb()
  const event = getTimelineEvent(db, eventId)
  if (!event) {
    await saveDb(db, file)
    throw new Error(`Timeline event not found: ${eventId}`)
  }
  run(db, 'DELETE FROM timeline_events WHERE id = ?', [eventId])
  const bundle = getProjectBundle(db, event.projectId)
  await saveDb(db, file)
  return bundle
})

const timelineRowsForExport = (events) =>
  events.map((event, index) => ({
    No: index + 1,
    Date: event.eventDate.slice(0, 10),
    Time: new Date(event.eventDate).toLocaleTimeString(),
    Type: event.eventType,
    Title: event.title,
    Description: event.description,
  }))

const buildTimelineDocx = (project, exportRows) => {
  const paragraphs = [
    `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(project.title)} Timeline</w:t></w:r></w:p>`,
    ...exportRows.flatMap((row) => [
      `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(`${row.No}. ${row.Date} ${row.Time} - ${row.Title}`)}</w:t></w:r></w:p>`,
      `<w:p><w:r><w:t>${escapeXml(row.Description || '')}</w:t></w:r></w:p>`,
    ]),
  ].join('')

  return createZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs}<w:sectPr/></w:body>
</w:document>`,
    },
  ])
}

const buildTimelineXlsx = (exportRows) => {
  const headers = ['No', 'Date', 'Time', 'Type', 'Title', 'Description']
  const cell = (column, row, value) =>
    `<c r="${column}${row}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
  const columnName = (index) => String.fromCharCode(65 + index)
  const sheetRows = [
    `<row r="1">${headers.map((header, index) => cell(columnName(index), 1, header)).join('')}</row>`,
    ...exportRows.map((row, rowIndex) => {
      const excelRow = rowIndex + 2
      return `<row r="${excelRow}">${headers
        .map((header, index) => cell(columnName(index), excelRow, row[header]))
        .join('')}</row>`
    }),
  ].join('')

  return createZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Timeline" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`,
    },
  ])
}

handle('export_timeline', async ({ projectId, format }) => {
  const { db, file } = await openDb()
  const project = getProject(db, projectId)
  const events = getTimelineEvents(db, projectId)
  const exportRows = timelineRowsForExport(events)
  const extension = format === 'docx' ? 'docx' : format === 'xlsx' ? 'xlsx' : 'json'
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export timeline',
    defaultPath: `${safeName(project.title)}_timeline.${extension}`,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  })

  if (result.canceled) {
    await saveDb(db, file)
    return ''
  }

  if (format === 'json') {
    await fsp.writeFile(result.filePath, JSON.stringify(events, null, 2), 'utf8')
  } else if (format === 'docx') {
    await fsp.writeFile(result.filePath, buildTimelineDocx(project, exportRows))
  } else {
    await fsp.writeFile(result.filePath, buildTimelineXlsx(exportRows))
  }

  await saveDb(db, file)
  return result.filePath
})

handle('export_project_package', async ({ projectId }) => {
  const { db, file } = await openDb()
  const project = getProject(db, projectId)
  const bundle = getProjectBundle(db, projectId)
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export project package',
    defaultPath: `${safeName(project.title)}_package.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled) {
    await saveDb(db, file)
    return ''
  }

  const payload = {
    exportedAt: now(),
    project,
    ...bundle,
  }
  await fsp.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8')
  await saveDb(db, file)
  return result.filePath
})

app.whenReady().then(async () => {
  registerLocalFileProtocol()
  await createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
