const PROP = PropertiesService.getScriptProperties();
const ARCHIVE_HEADERS = ['ID', 'Waktu', 'Jenis', 'Nama', 'Tanggal', 'Deskripsi', 'Progres', 'Berkas JSON', 'Pengunggah'];
const USERS_HEADERS = ['Email', 'Peran', 'Diizinkan', 'Diperbarui'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

function doGet() {
  return jsonOutput_({ok: true, result: {service: 'Arsip Sekolah API', status: 'ready'}});
}

function doPost(e) {
  let request = {};
  try {
    const body = e && e.postData && e.postData.contents || '';
    request = JSON.parse(e && e.parameter && e.parameter.request || body || '{}');
    let result;
    switch (request.action) {
      case 'getBootstrapData':
        result = getBootstrapData(request.idToken);
        break;
      case 'getArchives':
        result = getArchives(request.idToken);
        break;
      case 'getUserPermissions':
        result = getUserPermissions(request.idToken);
        break;
      case 'saveArchive':
        result = saveArchive(request.idToken, request.record);
        break;
      case 'updateArchive':
        result = updateArchive(request.idToken, request.record);
        break;
      case 'deleteArchive':
        result = deleteArchive(request.idToken, request.id);
        break;
      case 'updateSharedSettings':
        result = updateSharedSettings(request.idToken, request.settings);
        break;
      default:
        throw new Error('Aksi API tidak dikenal.');
    }
    const response = {ok: true, result: result};
    return request.bridge ? bridgeOutput_(response, request.bridge) : jsonOutput_(response);
  } catch (error) {
    const response = {ok: false, error: error && error.message || String(error)};
    return request.bridge ? bridgeOutput_(response, request.bridge) : jsonOutput_(response);
  }
}

function jsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function bridgeOutput_(response, bridge) {
  const origin = String(bridge && bridge.origin || '');
  const nonce = String(bridge && bridge.nonce || '');
  const allowedOrigins = String(PROP.getProperty('ALLOWED_ORIGINS') || '').split(/[\s,;]+/)
    .map(function(value) { return value.trim(); }).filter(Boolean);
  if (!nonce || allowedOrigins.indexOf(origin) < 0) {
    return HtmlService.createHtmlOutput('Origin API tidak diizinkan. Atur ALLOWED_ORIGINS di Script Properties.');
  }
  const message = JSON.stringify({nonce: nonce, response: response})
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return HtmlService.createHtmlOutput('<!doctype html><script>parent.postMessage(' + message + ',' +
    JSON.stringify(origin) + ');</script>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function initializeDatabase() {
  const adminEmail = String(PROP.getProperty('ADMIN_EMAIL') || '').trim().toLowerCase();
  if (!validEmail_(adminEmail)) throw new Error('Atur ADMIN_EMAIL di Script Properties sebelum inisialisasi.');
  if (!PROP.getProperty('GOOGLE_CLIENT_ID')) throw new Error('Atur GOOGLE_CLIENT_ID di Script Properties.');
  const origins = String(PROP.getProperty('ALLOWED_ORIGINS') || '').split(/[\s,;]+/).filter(Boolean);
  if (!origins.length || origins.some(function(origin) { return !/^https:\/\/[^/]+$/.test(origin); })) {
    throw new Error('Atur ALLOWED_ORIGINS dengan origin HTTPS penuh tanpa path.');
  }

  let folderId = PROP.getProperty('ARCHIVE_FOLDER_ID');
  if (folderId) DriveApp.getFolderById(folderId).setName('Arsip Sekolah');
  else folderId = DriveApp.createFolder('Arsip Sekolah').getId();
  PROP.setProperties({ARCHIVE_FOLDER_ID: folderId});

  let spreadsheetId = PROP.getProperty('ARCHIVE_SHEET_ID');
  let spreadsheet;
  if (spreadsheetId) spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  else {
    spreadsheet = SpreadsheetApp.create('Data Arsip Sekolah');
    spreadsheetId = spreadsheet.getId();
  }
  PROP.setProperties({ARCHIVE_SHEET_ID: spreadsheetId});
  let sheet = spreadsheet.getSheetByName('Arsip');
  if (!sheet) sheet = spreadsheet.insertSheet('Arsip');
  if (sheet.getLastRow() === 0) sheet.appendRow(ARCHIVE_HEADERS);
  else if (sheet.getRange(1, 1, 1, ARCHIVE_HEADERS.length).getValues()[0].join('|') !== ARCHIVE_HEADERS.join('|')) {
    throw new Error('Header sheet Arsip tidak sesuai. Periksa spreadsheet sebelum melanjutkan.');
  }

  const usersSheet = spreadsheet.getSheetByName('Pengguna') || spreadsheet.insertSheet('Pengguna');
  if (usersSheet.getLastRow() === 0) usersSheet.appendRow(USERS_HEADERS);
  else if (usersSheet.getRange(1, 1, 1, USERS_HEADERS.length).getValues()[0].join('|') !== USERS_HEADERS.join('|')) {
    throw new Error('Header sheet Pengguna tidak sesuai. Periksa spreadsheet sebelum melanjutkan.');
  }
  const configuredEmails = parseEmails_(PROP.getProperty('AUTHORIZED_EMAILS') || '');
  const existingEmails = readAuthorizedEmails_(usersSheet);
  const authorized = existingEmails.length ? existingEmails : configuredEmails;
  if (authorized.indexOf(adminEmail) < 0) authorized.unshift(adminEmail);
  writeAuthorizedUsers_(usersSheet, authorized, adminEmail);
  syncFolderViewers_(folderId, [], authorized);
  PROP.setProperties({
    ADMIN_EMAIL: adminEmail,
    ARCHIVE_FOLDER_ID: folderId,
    ARCHIVE_SHEET_ID: spreadsheetId,
    AUTHORIZED_EMAILS: JSON.stringify(authorized)
  });
  return {folderId: folderId, spreadsheetId: spreadsheetId};
}

function verifyGoogleUser(idToken) {
  if (!idToken) throw new Error('Silakan masuk dengan akun Google.');
  const response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(idToken)),
    {muteHttpExceptions: true}
  );
  if (response.getResponseCode() !== 200) throw new Error('Sesi Google tidak valid atau telah kedaluwarsa.');
  const identity = JSON.parse(response.getContentText());
  const email = String(identity.email || '').trim().toLowerCase();
  const verified = identity.email_verified === true || identity.email_verified === 'true';
  const expiresIn = Number(identity.expires_in);
  if (identity.aud !== PROP.getProperty('GOOGLE_CLIENT_ID') || !verified ||
      !validEmail_(email) || !isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Identitas Google tidak valid.');
  }
  const allowed = readAuthorizedEmails_();
  if (allowed.indexOf(email) < 0) throw new Error('Akun ' + email + ' belum diizinkan admin.');
  return {email: email, isAdmin: email === String(PROP.getProperty('ADMIN_EMAIL') || '').toLowerCase()};
}

function getUserPermissions(idToken) {
  const user = verifyGoogleUser(idToken);
  return {email: user.email, isAdmin: user.isAdmin, canView: true, canAdd: true,
    canUpdate: user.isAdmin, canDelete: user.isAdmin, canManageUsers: user.isAdmin};
}

function getBootstrapData(idToken) {
  const user = verifyGoogleUser(idToken);
  return {
    email: user.email,
    isAdmin: user.isAdmin,
    adminEmail: PROP.getProperty('ADMIN_EMAIL'),
    authorizedEmails: user.isAdmin ? readAuthorizedEmails_() : [],
    archives: readArchives_(),
    connection: checkConnections_()
  };
}

function getArchives(idToken) {
  verifyGoogleUser(idToken);
  return readArchives_();
}

function readArchives_() {
  const values = sheet_().getDataRange().getValues();
  return values.slice(1).filter(function(row) { return row[0]; }).map(function(row) {
    const files = parseFiles_(row[7]);
    return {
      id: String(row[0]), kind: String(row[2]), nm: String(row[3]),
      dt: normalizeDate_(row[4]), ds: String(row[5] || ''),
      pr: row[6] === '' ? null : Number(row[6]),
      n: files.length, driveFiles: files, uploader: String(row[8] || '')
    };
  }).reverse();
}

function saveArchive(idToken, record) {
  const user = verifyGoogleUser(idToken);
  validateArchive_(record);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let createdFiles = [];
  let appendedRow = 0;
  try {
    const driveFiles = uploadFilesToDrive(idToken, record.files || [], record.dt, record.kind);
    createdFiles = driveFiles;
    const id = Utilities.getUuid();
    const sheet = sheet_();
    sheet.appendRow([id, new Date(), record.kind, cleanText_(record.nm, 200),
      record.dt, cleanText_(record.ds || '', 5000),
      record.kind === 'Pembangunan' ? Number(record.pr) : '', JSON.stringify(driveFiles), user.email]);
    appendedRow = sheet.getLastRow();
    return archiveResult_(id, record, driveFiles, user.email);
  } catch (error) {
    const cleanupErrors = [];
    if (appendedRow) {
      try { sheet_().deleteRow(appendedRow); }
      catch (cleanupError) { cleanupErrors.push('metadata: ' + cleanupError.message); }
    }
    const fileCleanupError = deleteCreatedFiles_(createdFiles);
    if (fileCleanupError) cleanupErrors.push(fileCleanupError);
    throw new Error(error.message + (cleanupErrors.length ?
      ' Pembersihan setelah gagal juga bermasalah (' + cleanupErrors.join('; ') + ').' : ''));
  } finally {
    lock.releaseLock();
  }
}

function updateArchive(idToken, record) {
  const user = verifyGoogleUser(idToken);
  requireAdmin_(user);
  validateArchive_(record);
  if (!record.id) throw new Error('ID arsip wajib diisi.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let createdFiles = [];
  try {
    const sheet = sheet_();
    const row = findArchiveRow_(sheet, record.id);
    if (!row) throw new Error('Arsip tidak ditemukan.');
    const oldFiles = parseFiles_(sheet.getRange(row, 8).getValue());
    createdFiles = uploadFilesToDrive(idToken, record.files || [], record.dt, record.kind);
    const allFiles = oldFiles.concat(createdFiles);
    sheet.getRange(row, 3, 1, 7).setValues([[
      record.kind, cleanText_(record.nm, 200), record.dt, cleanText_(record.ds || '', 5000),
      record.kind === 'Pembangunan' ? Number(record.pr) : '', JSON.stringify(allFiles),
      String(sheet.getRange(row, 9).getValue() || user.email)
    ]]);
    const result = archiveResult_(String(record.id), record, allFiles, user.email);
    result.n = allFiles.length;
    return result;
  } catch (error) {
    const cleanupError = deleteCreatedFiles_(createdFiles);
    throw new Error(error.message + (cleanupError ? ' ' + cleanupError : ''));
  } finally {
    lock.releaseLock();
  }
}

function deleteArchive(idToken, id) {
  const user = verifyGoogleUser(idToken);
  requireAdmin_(user);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = sheet_();
    const row = findArchiveRow_(sheet, id);
    if (!row) throw new Error('Arsip tidak ditemukan.');
    const files = parseFiles_(sheet.getRange(row, 8).getValue());
    const trashed = [];
    try {
      files.forEach(function(file) {
        DriveApp.getFileById(file.id).setTrashed(true);
        trashed.push(file.id);
      });
      sheet.deleteRow(row);
    } catch (error) {
      const restoreErrors = [];
      trashed.forEach(function(fileId) {
        try { DriveApp.getFileById(fileId).setTrashed(false); }
        catch (restoreError) { restoreErrors.push(fileId + ': ' + restoreError.message); }
      });
      throw new Error(error.message + (restoreErrors.length ?
        ' Gagal memulihkan sebagian berkas: ' + restoreErrors.join('; ') : ''));
    }
    return {id: String(id), deleted: true};
  } finally {
    lock.releaseLock();
  }
}

function uploadFilesToDrive(idToken, files, date, kind) {
  verifyGoogleUser(idToken);
  if (!Array.isArray(files)) throw new Error('Format daftar berkas tidak valid.');
  if (files.length > MAX_FILES) throw new Error('Maksimal ' + MAX_FILES + ' berkas per arsip.');
  const totalBytes = files.reduce(function(sum, file) {
    return sum + Math.ceil(String(file && file.data || '').length * 3 / 4);
  }, 0);
  if (totalBytes > MAX_FILE_BYTES) throw new Error('Ukuran total unggahan maksimal 10 MB per arsip.');

  const root = DriveApp.getFolderById(requiredProperty_('ARCHIVE_FOLDER_ID'));
  const yearFolder = findOrCreateFolder_(root, String(date).slice(0, 4));
  const categoryFolder = findOrCreateFolder_(yearFolder,
    kind === 'Kegiatan_Sekolah' ? 'Kegiatan Sekolah' : 'Pembangunan');
  const saved = [];
  try {
    files.forEach(function(file) {
      const mimeType = String(file.type || '').toLowerCase();
      const name = cleanText_(file.name || '', 180);
      if (ALLOWED_MIME_TYPES.indexOf(mimeType) < 0) throw new Error('Tipe berkas tidak diizinkan: ' + name);
      if (!name || !file.data) throw new Error('Ada berkas yang tidak lengkap.');
      const bytes = Utilities.base64Decode(String(file.data));
      if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error('Ukuran berkas tidak valid: ' + name);
      if (!matchesMime_(bytes, mimeType)) throw new Error('Isi berkas tidak cocok dengan tipenya: ' + name);
      const blob = Utilities.newBlob(bytes, mimeType, name);
      const driveFile = categoryFolder.createFile(blob);
      saved.push({id: driveFile.getId(), name: driveFile.getName(), mimeType: mimeType,
        webViewLink: driveFile.getUrl()});
    });
    return saved;
  } catch (error) {
    const cleanupError = deleteCreatedFiles_(saved);
    throw new Error(error.message + (cleanupError ? ' ' + cleanupError : ''));
  }
}

function updateSharedSettings(idToken, settings) {
  const user = verifyGoogleUser(idToken);
  requireAdmin_(user);
  const adminEmail = String(settings && settings.adminEmail || '').trim().toLowerCase();
  if (!validEmail_(adminEmail)) throw new Error('Email administrator tidak valid.');
  const teachers = parseEmails_(settings && settings.authorizedEmails || []);
  const authorized = Array.from(new Set([adminEmail].concat(teachers)));
  const previousAdmin = String(PROP.getProperty('ADMIN_EMAIL') || '').toLowerCase();
  const previous = readAuthorizedEmails_();
  const usersSheet = usersSheet_();
  syncFolderViewers_(requiredProperty_('ARCHIVE_FOLDER_ID'), previous, authorized);
  try {
    writeAuthorizedUsers_(usersSheet, authorized, adminEmail);
    PROP.setProperties({ADMIN_EMAIL: adminEmail, AUTHORIZED_EMAILS: JSON.stringify(authorized)});
  } catch (error) {
    const rollbackErrors = [];
    try { writeAuthorizedUsers_(usersSheet, previous, previousAdmin); }
    catch (rollbackError) { rollbackErrors.push('sheet Pengguna: ' + rollbackError.message); }
    try { syncFolderViewers_(requiredProperty_('ARCHIVE_FOLDER_ID'), authorized, previous); }
    catch (rollbackError) { rollbackErrors.push('izin Drive: ' + rollbackError.message); }
    try { PROP.setProperties({ADMIN_EMAIL: previousAdmin, AUTHORIZED_EMAILS: JSON.stringify(previous)}); }
    catch (rollbackError) { rollbackErrors.push('Script Properties: ' + rollbackError.message); }
    throw new Error(error.message + (rollbackErrors.length ?
      ' Pemulihan pengaturan gagal (' + rollbackErrors.join('; ') + ').' : ''));
  }
  return {adminEmail: adminEmail, authorizedEmails: authorized, isAdmin: user.email === adminEmail};
}

function syncFolderViewers_(folderId, previous, next) {
  const folder = DriveApp.getFolderById(folderId);
  const owner = folder.getOwner();
  const ownerEmail = owner ? owner.getEmail().toLowerCase() : '';
  const added = [];
  const removed = [];
  try {
    next.forEach(function(email) {
      if (email !== ownerEmail && previous.indexOf(email) < 0) {
        folder.addViewer(email);
        added.push(email);
      }
    });
    previous.forEach(function(email) {
      if (email !== ownerEmail && next.indexOf(email) < 0) {
        folder.removeViewer(email);
        removed.push(email);
      }
    });
  } catch (error) {
    const rollbackErrors = [];
    removed.forEach(function(email) {
      try { folder.addViewer(email); }
      catch (rollbackError) { rollbackErrors.push(email + ': ' + rollbackError.message); }
    });
    added.forEach(function(email) {
      try { folder.removeViewer(email); }
      catch (rollbackError) { rollbackErrors.push(email + ': ' + rollbackError.message); }
    });
    throw new Error('Gagal memperbarui izin Drive: ' + error.message +
      (rollbackErrors.length ? ' Pemulihan izin juga gagal: ' + rollbackErrors.join('; ') : ''));
  }
}

function checkConnections_() {
  let sheet = false;
  let drive = false;
  try { sheet = !!sheet_(); } catch (error) { console.error(error); }
  try { DriveApp.getFolderById(requiredProperty_('ARCHIVE_FOLDER_ID')).getName(); drive = true; }
  catch (error) { console.error(error); }
  return {spreadsheet: sheet, drive: drive};
}

function validateArchive_(record) {
  if (!record || !['Pembangunan', 'Kegiatan_Sekolah'].includes(record.kind)) {
    throw new Error('Kategori arsip tidak valid.');
  }
  if (!String(record.nm || '').trim() || String(record.nm).length > 200) {
    throw new Error('Nama wajib diisi dan maksimal 200 karakter.');
  }
  const date = String(record.dt || '');
  const parsedDate = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date) throw new Error('Tanggal tidak valid.');
  if (record.kind === 'Pembangunan' &&
      (!Number.isInteger(Number(record.pr)) || Number(record.pr) < 0 || Number(record.pr) > 100)) {
    throw new Error('Progres pembangunan harus bernilai 0 sampai 100.');
  }
}

function matchesMime_(bytes, mimeType) {
  const startsWith = function(signature) {
    return signature.every(function(byte, index) { return bytes[index] === byte; });
  };
  if (mimeType === 'image/jpeg') return startsWith([0xff, 0xd8, 0xff]);
  if (mimeType === 'image/png') return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === 'image/gif') return startsWith([0x47, 0x49, 0x46, 0x38]) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
  if (mimeType === 'image/webp') return startsWith([0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (mimeType === 'application/pdf') return startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]);
  return false;
}

function archiveResult_(id, record, files, email) {
  return {id: String(id), kind: record.kind, nm: cleanText_(record.nm, 200), dt: record.dt,
    ds: cleanText_(record.ds || '', 5000),
    pr: record.kind === 'Pembangunan' ? Number(record.pr) : null,
    n: files.length, driveFiles: files, uploader: email};
}

function requireAdmin_(user) {
  if (!user.isAdmin) throw new Error('Hanya admin yang dapat melakukan tindakan ini.');
}

function findArchiveRow_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === String(id)) return i + 2;
  return 0;
}

function deleteCreatedFiles_(files) {
  const failures = [];
  files.forEach(function(file) {
    try { DriveApp.getFileById(file.id).setTrashed(true); }
    catch (error) { failures.push(file.id + ': ' + error.message); }
  });
  return failures.length ? 'Gagal membersihkan berkas sementara: ' + failures.join('; ') : '';
}

function parseFiles_(value) {
  try { return JSON.parse(String(value || '[]')); }
  catch (error) { throw new Error('Metadata berkas arsip rusak.'); }
}

function sheet_() {
  const spreadsheet = SpreadsheetApp.openById(requiredProperty_('ARCHIVE_SHEET_ID'));
  const sheet = spreadsheet.getSheetByName('Arsip');
  if (!sheet) throw new Error('Sheet Arsip tidak ditemukan. Jalankan initializeDatabase().');
  return sheet;
}

function usersSheet_() {
  const spreadsheet = SpreadsheetApp.openById(requiredProperty_('ARCHIVE_SHEET_ID'));
  const sheet = spreadsheet.getSheetByName('Pengguna');
  if (!sheet) throw new Error('Sheet Pengguna tidak ditemukan. Jalankan initializeDatabase().');
  return sheet;
}

function readAuthorizedEmails_(sheet) {
  const usersSheet = sheet || usersSheet_();
  const lastRow = usersSheet.getLastRow();
  if (lastRow < 2) return [];
  const emails = usersSheet.getRange(2, 1, lastRow - 1, 3).getValues()
    .filter(function(row) { return row[0] && (row[2] === true || String(row[2]).toLowerCase() === 'true'); })
    .map(function(row) { return String(row[0]).trim().toLowerCase(); });
  return Array.from(new Set(emails));
}

function writeAuthorizedUsers_(sheet, emails, adminEmail) {
  sheet.clearContents();
  sheet.appendRow(USERS_HEADERS);
  if (!emails.length) return;
  const updatedAt = new Date();
  const rows = emails.map(function(email) {
    return [email, email === adminEmail ? 'Admin' : 'Guru', true, updatedAt];
  });
  sheet.getRange(2, 1, rows.length, USERS_HEADERS.length).setValues(rows);
}

function findOrCreateFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function parseEmails_(value) {
  let parsed = value;
  if (typeof value === 'string' && value.trim().charAt(0) === '[') {
    try { parsed = JSON.parse(value); } catch (error) { parsed = value; }
  }
  const emails = (Array.isArray(parsed) ? parsed : String(parsed || '').split(/[\s,;]+/))
    .map(function(email) { return String(email).trim().toLowerCase(); }).filter(Boolean);
  if (emails.some(function(email) { return !validEmail_(email); })) {
    throw new Error('Ada alamat email yang tidak valid.');
  }
  return Array.from(new Set(emails));
}

function validEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

function cleanText_(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeDate_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(value || '').slice(0, 10);
}

function requiredProperty_(name) {
  const value = PROP.getProperty(name);
  if (!value) throw new Error('Script Property ' + name + ' belum diatur. Jalankan initializeDatabase().');
  return value;
}
