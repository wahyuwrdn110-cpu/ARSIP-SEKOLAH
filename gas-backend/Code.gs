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
    const parameters = e && e.parameter || {};
    console.log('POST parameter keys=' + Object.keys(parameters).join(',') +
      '; contentType=' + String(e && e.postData && e.postData.type || '(none)') +
      '; bodyLength=' + body.length);
    request = JSON.parse(e && e.parameter && e.parameter.request || body || '{}');
    console.log('API action=' + String(request.action || '(kosong)') +
      '; bridge=' + JSON.stringify(request.bridge || null));
    let result;
    switch (request.action) {
      case 'getLoginConfig':
        result = getLoginConfig();
        break;
      case 'getBootstrapData':
        result = getBootstrapData(request.idToken);
        break;
      case 'getArchives':
        result = getArchives(request.idToken);
        break;
      case 'getUserPermissions':
        result = getUserPermissions(request.idToken);
        break;
      case 'uploadArchiveFiles':
        result = uploadArchiveFiles(request.idToken, request.files, request.dt, request.kind);
        break;
      case 'deleteDriveFiles':
        result = deleteDriveFiles(request.idToken, request.fileIds, request.cleanupToken);
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
    console.error('API request gagal: ' + (error && error.message || String(error)));
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
  console.log('Bridge origin=' + origin + '; noncePresent=' + Boolean(nonce) +
    '; allowed=' + allowedOrigins.join(','));
  if (!nonce || allowedOrigins.indexOf(origin) < 0) {
    console.error('Bridge ditolak: nonce kosong atau origin tidak diizinkan.');
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
  const loginEmail = String(PROP.getProperty('LOGIN_EMAIL') || '').trim().toLowerCase();
  if (!validEmail_(loginEmail) || loginEmail === adminEmail) {
    throw new Error('Atur LOGIN_EMAIL yang valid dan berbeda dari ADMIN_EMAIL.');
  }
  if (!validLoginUsername_(PROP.getProperty('LOGIN_USERNAME'))) {
    throw new Error('Atur LOGIN_USERNAME dengan 3–32 huruf, angka, titik, garis bawah, atau tanda hubung.');
  }
  requiredProperty_('FIREBASE_API_KEY');
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

function getLoginConfig() {
  const username = normalizeLoginUsername_(PROP.getProperty('LOGIN_USERNAME') || '');
  const loginEmail = String(PROP.getProperty('LOGIN_EMAIL') || '').trim().toLowerCase();
  return {
    ready: validLoginUsername_(username) && validEmail_(loginEmail) &&
      loginEmail !== String(PROP.getProperty('ADMIN_EMAIL') || '').trim().toLowerCase(),
    username: username,
    loginEmail: loginEmail
  };
}

function verifyFirebaseUser(idToken) {
  if (!idToken) throw new Error('Silakan masuk dengan username dan password.');
  const response = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' +
      encodeURIComponent(requiredProperty_('FIREBASE_API_KEY')),
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({idToken: String(idToken)}),
      muteHttpExceptions: true
    }
  );
  if (response.getResponseCode() !== 200) throw new Error('Sesi login tidak valid atau telah kedaluwarsa.');
  const users = JSON.parse(response.getContentText()).users || [];
  const identity = users[0] || {};
  const email = String(identity.email || '').trim().toLowerCase();
  const expectedEmail = String(PROP.getProperty('LOGIN_EMAIL') || '').trim().toLowerCase();
  if (!validEmail_(email) || email !== expectedEmail || identity.disabled === true) {
    throw new Error('Akun username/password tidak diizinkan.');
  }
  return {
    email: email,
    username: normalizeLoginUsername_(PROP.getProperty('LOGIN_USERNAME') || ''),
    isAdmin: true
  };
}

function getUserPermissions(idToken) {
  const user = verifyFirebaseUser(idToken);
  return {email: user.email, isAdmin: user.isAdmin, canView: true, canAdd: true,
    canUpdate: user.isAdmin, canDelete: user.isAdmin, canManageUsers: user.isAdmin};
}

function getBootstrapData(idToken) {
  const user = verifyFirebaseUser(idToken);
  return {
    email: user.email,
    username: user.username,
    isAdmin: user.isAdmin,
    adminEmail: PROP.getProperty('ADMIN_EMAIL'),
    authorizedEmails: user.isAdmin ? readAuthorizedEmails_() : [],
    archives: readArchives_(),
    connection: checkConnections_()
  };
}

function getArchives(idToken) {
  verifyFirebaseUser(idToken);
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

function uploadFilesToDrive(files, date, kind) {
  validateUploadTarget_(date, kind);
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

function uploadArchiveFiles(idToken, files, date, kind) {
  const user = verifyFirebaseUser(idToken);
  validateUploadTarget_(date, kind);
  const driveFiles = uploadFilesToDrive(files || [], date, kind);
  const cleanupToken = Utilities.getUuid();
  CacheService.getScriptCache().put('UPLOAD_CLEANUP_' + cleanupToken,
    JSON.stringify({email: user.email, ids: driveFiles.map(function(file) { return file.id; })}), 21600);
  return {driveFiles: driveFiles, cleanupToken: cleanupToken};
}

function deleteDriveFiles(idToken, fileIds, cleanupToken) {
  const user = verifyFirebaseUser(idToken);
  if (!Array.isArray(fileIds) || fileIds.length > MAX_FILES) {
    throw new Error('Format atau jumlah berkas yang dihapus tidak valid.');
  }
  if (fileIds.some(function(id) { return typeof id !== 'string' || !id.trim(); })) {
    throw new Error('ID berkas yang dihapus tidak valid.');
  }
  const ids = Array.from(new Set(fileIds.map(function(id) { return String(id || '').trim(); }).filter(Boolean)));
  const cache = CacheService.getScriptCache();
  const cacheKey = cleanupToken ? 'UPLOAD_CLEANUP_' + String(cleanupToken) : '';
  let cleanupPermit = null;
  if (!user.isAdmin) {
    cleanupPermit = cacheKey ? JSON.parse(cache.get(cacheKey) || 'null') : null;
    if (!cleanupPermit || cleanupPermit.email !== user.email ||
        ids.some(function(id) { return cleanupPermit.ids.indexOf(id) < 0; })) {
      throw new Error('Hanya admin atau pengunggah berkas sementara yang dapat menghapus berkas.');
    }
  } else {
    requireAdmin_(user);
  }
  const rootId = requiredProperty_('ARCHIVE_FOLDER_ID');
  const trashed = [];
  try {
    ids.forEach(function(id) {
      const file = DriveApp.getFileById(id);
      if (!isInArchiveFolder_(file, rootId)) throw new Error('Berkas bukan bagian dari folder arsip sekolah.');
      file.setTrashed(true);
      trashed.push(id);
    });
  } catch (error) {
    const restoreErrors = [];
    trashed.forEach(function(id) {
      try { DriveApp.getFileById(id).setTrashed(false); }
      catch (restoreError) { restoreErrors.push(id + ': ' + restoreError.message); }
    });
    throw new Error(error.message + (restoreErrors.length ?
      ' Gagal memulihkan sebagian berkas: ' + restoreErrors.join('; ') : ''));
  }
  if (cleanupPermit) cache.remove(cacheKey);
  return {deleted: trashed};
}

function isInArchiveFolder_(file, rootId) {
  const pending = [];
  const visited = {};
  const parents = file.getParents();
  while (parents.hasNext()) pending.push(parents.next());
  while (pending.length) {
    const folder = pending.pop();
    const id = folder.getId();
    if (id === rootId) return true;
    if (visited[id]) continue;
    visited[id] = true;
    const ancestors = folder.getParents();
    while (ancestors.hasNext()) pending.push(ancestors.next());
  }
  return false;
}

function validateUploadTarget_(date, kind) {
  const normalizedDate = String(date || '');
  const parsedDate = new Date(normalizedDate + 'T00:00:00Z');
  if (!['Pembangunan', 'Kegiatan_Sekolah'].includes(kind)) throw new Error('Kategori arsip tidak valid.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) || isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== normalizedDate) throw new Error('Tanggal tidak valid.');
}

function updateSharedSettings(idToken, settings) {
  const user = verifyFirebaseUser(idToken);
  requireAdmin_(user);
  const adminEmail = String(PROP.getProperty('ADMIN_EMAIL') || '').trim().toLowerCase();
  const loginUsername = normalizeLoginUsername_(settings && settings.loginUsername || '');
  if (!validLoginUsername_(loginUsername)) throw new Error('Username harus 3–32 karakter: huruf, angka, titik, garis bawah, atau tanda hubung.');
  const teachers = parseEmails_(settings && settings.authorizedEmails || []);
  const authorized = Array.from(new Set([adminEmail].concat(teachers)));
  const previous = readAuthorizedEmails_();
  const previousUsername = normalizeLoginUsername_(PROP.getProperty('LOGIN_USERNAME') || '');
  const usersSheet = usersSheet_();
  syncFolderViewers_(requiredProperty_('ARCHIVE_FOLDER_ID'), previous, authorized);
  try {
    writeAuthorizedUsers_(usersSheet, authorized, adminEmail);
    PROP.setProperties({
      AUTHORIZED_EMAILS: JSON.stringify(authorized),
      LOGIN_USERNAME: loginUsername
    });
  } catch (error) {
    const rollbackErrors = [];
    try { writeAuthorizedUsers_(usersSheet, previous, adminEmail); }
    catch (rollbackError) { rollbackErrors.push('sheet Pengguna: ' + rollbackError.message); }
    try { syncFolderViewers_(requiredProperty_('ARCHIVE_FOLDER_ID'), authorized, previous); }
    catch (rollbackError) { rollbackErrors.push('izin Drive: ' + rollbackError.message); }
    try {
      PROP.setProperties({
        AUTHORIZED_EMAILS: JSON.stringify(previous),
        LOGIN_USERNAME: previousUsername
      });
    }
    catch (rollbackError) { rollbackErrors.push('Script Properties: ' + rollbackError.message); }
    throw new Error(error.message + (rollbackErrors.length ?
      ' Pemulihan pengaturan gagal (' + rollbackErrors.join('; ') + ').' : ''));
  }
  return {
    adminEmail: adminEmail,
    authorizedEmails: authorized,
    loginUsername: loginUsername,
    isAdmin: true
  };
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

function requireAdmin_(user) {
  if (!user.isAdmin) throw new Error('Hanya admin yang dapat melakukan tindakan ini.');
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

function validLoginUsername_(username) {
  return /^[a-zA-Z0-9._-]{3,32}$/.test(String(username || '').trim());
}

function normalizeLoginUsername_(username) {
  return String(username || '').trim().toLowerCase();
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
