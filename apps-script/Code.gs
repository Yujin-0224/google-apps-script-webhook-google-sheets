const SHEETS = {
  DASHBOARD: '대시보드',
  SCHEDULE: '편성표',
  RULES: '매핑규칙',
  LOG: '입고로그',
  REVIEW: '미매칭검수',
  PICKLIST: '선택목록',
};

const HEADER_ROW = 1;
const DATA_START_ROW = 2;
const DATE_FORMAT = 'yyyy-MM-dd HH:mm:ss';
const TIME_FORMAT = 'HH:mm';
const PICKLIST_MAX_ROWS = 1000;
const HEADER_SCAN_ROWS = 10;
const DASHBOARD_REFRESH_INTERVAL_MS = 30000;

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (expectedSecret && (!e.parameter || e.parameter.secret !== expectedSecret)) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    const update = JSON.parse(e.postData.contents);
    const message = update.message || update.channel_post || update.edited_message || update.edited_channel_post;
    if (!message) return json_({ ok: true, skipped: 'no_message' });

    const messageKey = makeMessageKey_(update, message);
    if (isProcessedMessage_(messageKey)) {
      return json_({ ok: true, skipped: 'already_processed', messageKey });
    }

    const text = message.text || message.caption || '';
    const arrival = parseArrival_(text);
    if (!arrival) return json_({ ok: true, skipped: 'not_arrival_message' });

    arrival.chatTitle = getChatTitle_(message.chat);
    arrival.messageId = String(message.message_id || '');

    const result = processArrival_(arrival);
    markProcessedMessage_(messageKey);
    return json_({ ok: true, result });
  } catch (err) {
    return json_({ ok: false, error: String(err), stack: err.stack || '' });
  } finally {
    lock.releaseLock();
  }
}

function testWithSampleMessages() {
  const samples = [
    `[완료]\n파일명:32.mpg\n경로:HYKMEDIA/시리즈/영상/알부민종교/32.mpg\n발생시간: 2026-05-08 04:11:08`,
    `[완료]\n파일명:33.mpg\n경로:HYKMEDIA/입고/알부민종교/영상/33.mpg\n발생시간: 2026-05-08 04:15:30`,
    `[완료]\n파일명:34.mpg\n경로:HYKMEDIA/시리즈/영상/알부민종교/34.mpg\n발생시간: 2026-05-08 04:19:39`,
    `[완료]\n파일명:44.mpg\n경로:HYKMEDIA/SPORTS/KPGA REPLAY/완료본/44.mpg\n발생시간: 2026-05-08 16:44:00`,
    `[완료]\n파일명:test.mpg\n경로:HYKMEDIA/UNKNOWN/테스트/test.mpg\n발생시간: 2026-05-08 19:00:00`,
  ];

  samples.forEach((text, index) => {
    processArrival_({
      ...parseArrival_(text),
      chatTitle: 'TVING 입고 테스트',
      messageId: `sample-${index + 1}`,
    });
  });
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('입고 자동화')
    .addItem('선택한 검수 적용', 'applySelectedReviewRows')
    .addItem('검수 드롭다운 새로고침', 'setupReviewSheet')
    .addItem('대시보드 새로고침', 'manualRefreshDashboard')
    .addItem('편집 트리거 설치', 'installEditTrigger')
    .addItem('처리 메시지 기록 초기화', 'clearProcessedMessageKeys')
    .addToUi();
}

function onEdit(e) {
  handleEdit_(e);
}

function handleEditTrigger(e) {
  handleEdit_(e);
}

function handleEdit_(e) {
  if (!e || !e.range) return;

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) return;

  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() === SHEETS.SCHEDULE && e.range.getRow() >= dataStartRow_(sheet)) {
      const headers = headerMap_(sheet);
      const editStartColumn = e.range.getColumn();
      const editEndColumn = editStartColumn + e.range.getNumColumns() - 1;
      const keyColumns = [
        headers['작업일'],
        headers['채널'],
        headers['프로그램'],
        headers['회차'] || headers['회차/묶음'],
      ].filter(Boolean);
      const touchesKeyColumn = keyColumns.some(column => editStartColumn <= column && editEndColumn >= column);
      if (touchesKeyColumn) {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        refreshPicklist_(ss);
        applyReviewValidation_(ss);
      }
      return;
    }

    if (sheet.getName() !== SHEETS.REVIEW || e.range.getRow() < DATA_START_ROW) return;

    const headers = headerMap_(sheet);
    const pickColumn = headers['편성표선택'];
    const editStartColumn = e.range.getColumn();
    const editEndColumn = editStartColumn + e.range.getNumColumns() - 1;
    if (editStartColumn > pickColumn || editEndColumn < pickColumn) return;

    const startRow = Math.max(e.range.getRow(), DATA_START_ROW);
    const endRow = e.range.getLastRow();
    for (let row = startRow; row <= endRow; row += 1) {
      const selected = String(sheet.getRange(row, pickColumn).getDisplayValue() || sheet.getRange(row, pickColumn).getValue() || '').trim();
      if (!selected) continue;

      const status = String(sheet.getRange(row, headers['처리상태']).getDisplayValue() || '').trim();
      if (status === '적용완료' || status === '중복') continue;

      applyReviewSelection_(row, selected);
    }
  } finally {
    lock.releaseLock();
  }
}

function setupReviewSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  refreshPicklist_(ss);
  applyRulesValidation_(ss);
  applyReviewValidation_(ss);
}

function manualRefreshDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  refreshDashboard_(ss);
  PropertiesService.getScriptProperties().setProperty('LAST_DASHBOARD_REFRESH_MS', String(Date.now()));
}

function installEditTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers()
    .filter(trigger => ['handleEdit_', 'handleEditTrigger'].includes(trigger.getHandlerFunction()))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('handleEditTrigger')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  setupReviewSheet();
  SpreadsheetApp.getUi().alert('미매칭검수 편집 트리거를 설치했습니다.');
}

function applySelectedReviewRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== SHEETS.REVIEW) {
    SpreadsheetApp.getUi().alert('미매칭검수 시트에서 실행해주세요.');
    return;
  }

  const headers = headerMap_(sheet);
  const range = sheet.getActiveRange();
  if (!range) return;

  const startRow = Math.max(range.getRow(), DATA_START_ROW);
  const endRow = range.getLastRow();
  const appliedGroups = {};

  for (let row = startRow; row <= endRow; row += 1) {
    const selected = String(sheet.getRange(row, headers['편성표선택']).getDisplayValue() || '').trim();
    if (!selected) continue;

    const groupKey = String(sheet.getRange(row, headers['그룹키']).getDisplayValue() || '').trim();
    if (groupKey && appliedGroups[groupKey]) continue;
    if (groupKey) appliedGroups[groupKey] = true;

    applyReviewSelection_(row, selected);
  }
}

function processArrival_(arrival) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rulesSheet = ss.getSheetByName(SHEETS.RULES);
  const scheduleSheet = ss.getSheetByName(SHEETS.SCHEDULE);
  const logSheet = ss.getSheetByName(SHEETS.LOG);
  const reviewSheet = ss.getSheetByName(SHEETS.REVIEW);

  const rules = readRules_(rulesSheet);
  const scheduleRows = readSchedule_(scheduleSheet);
  const match = matchArrival_(rules, scheduleRows, arrival);

  if (!match.scheduleRow) {
    const status = match.rule ? '편성표없음' : '미매칭';
    appendLog_(logSheet, arrival, {
      arrivalKey: '',
      matchStatus: status,
      matchMethod: match.rule ? '예외규칙' : '',
      ruleKeyword: match.rule ? match.rule.keyword : '',
      program: match.rule ? match.rule.program : '',
      episodeText: '',
      duplicate: false,
    });
    appendReview_(reviewSheet, arrival, {
      reason: status,
      guessedKeyword: match.rule ? match.rule.keyword : guessKeyword_(arrival),
    });
    groupReviewRows_(reviewSheet);
    setupReviewSheet();
    maybeRefreshDashboard_(ss);
    return `${status}: ${arrival.filename || arrival.path}`;
  }

  const target = match.scheduleRow;
  const previous = existingArrivals_(logSheet, target.arrivalKey);
  const duplicate = Object.prototype.hasOwnProperty.call(previous, arrival.filename);
  if (duplicate) {
    return `${target.arrivalKey}: duplicate skipped ${arrival.filename}`;
  }

  appendLog_(logSheet, arrival, {
    arrivalKey: target.arrivalKey,
    matchStatus: '매칭완료',
    matchMethod: match.method,
    ruleKeyword: match.rule ? match.rule.keyword : '',
    program: target.program,
    episodeText: target.episodeText,
    duplicate,
  });

  const refreshed = refreshSchedule_(ss, target.arrivalKey);
  maybeRefreshDashboard_(ss);

  return `${target.program} ${target.episodeText}: ${refreshed.receivedCount}/${refreshed.expectedLabel} ${refreshed.status}`;
}

function parseArrival_(text) {
  if (!text) return null;

  const filename = firstLineValue_(text, ['파일명', '파일', 'filename', 'file']) || inferFilename_(text);
  const filePath = firstLineValue_(text, ['경로', 'path', '폴더']) || inferPath_(text);
  const occurredAtText = firstLineValue_(text, ['발생시간', '도착시간', '입고시간', 'time']);

  if (!filename && !filePath) return null;

  return {
    filename: filename || inferFilename_(filePath),
    path: filePath || '',
    occurredAt: occurredAtText ? parseKoreanDateTime_(occurredAtText) : new Date(),
    rawText: text,
  };
}

function firstLineValue_(text, labels) {
  for (let i = 0; i < labels.length; i += 1) {
    const escaped = labels[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`^${escaped}\\s*[:：]\\s*(.+?)\\s*$`, 'im'));
    if (match) return match[1].trim();
  }
  return '';
}

function inferPath_(text) {
  const match = String(text).match(/[A-Za-z0-9가-힣_ .()\-]+(?:\/[A-Za-z0-9가-힣_ .()\-]+)+\.(?:mpg|mpeg|mp4|mxf|mov|avi)/i);
  return match ? match[0].trim() : '';
}

function inferFilename_(value) {
  const text = String(value || '');
  const match = text.match(/([^\\/\s]+?\.(?:mpg|mpeg|mp4|mxf|mov|avi))/i);
  return match ? match[1].trim() : '';
}

function parseKoreanDateTime_(value) {
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid date: ${value}`);
  const [, y, m, d, hh, mm, ss] = match.map(Number);
  return new Date(y, m - 1, d, hh, mm, ss);
}

function readRules_(sheet) {
  if (!sheet) return [];

  const headers = headerMap_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];

  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, sheet.getLastColumn()).getValues();
  return values
    .filter(row => row[headers['텔레그램키워드'] - 1])
    .map(row => ({
      active: String(row[headers['활성'] - 1] || 'Y').trim().toUpperCase() === 'Y',
      priority: Number(row[headers['우선순위'] - 1] || 999),
      keyword: String(row[headers['텔레그램키워드'] - 1] || '').trim(),
      program: String(row[headers['프로그램'] - 1] || '').trim(),
      channel: String(row[headers['채널'] - 1] || '').trim(),
    }))
    .filter(rule => rule.active)
    .sort((a, b) => a.priority - b.priority);
}

function readSchedule_(sheet) {
  const headers = headerMap_(sheet);
  const lastRow = sheet.getLastRow();
  const startRow = dataStartRow_(sheet);
  if (lastRow < startRow) return [];

  const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, sheet.getLastColumn()).getValues();
  return values
    .map((row, index) => {
      const workDateColumn = headers['작업일'];
      const channelColumn = headers['채널'];
      const programColumn = headers['프로그램'];
      const episodeColumn = headers['회차'] || headers['회차/묶음'];
      const expectedColumn = headers['예상파일수'];

      const workDate = workDateColumn ? formatCellDate_(row[workDateColumn - 1]) : '';
      const channel = channelColumn ? String(row[channelColumn - 1] || '').trim() : '';
      const program = programColumn ? String(row[programColumn - 1] || '').trim() : '';
      const episodeText = episodeColumn ? String(row[episodeColumn - 1] || '').trim() : '';
      if (!program) return null;

      const enteredExpected = expectedColumn ? Number(row[expectedColumn - 1] || 0) : 0;
      const parsedExpected = parseExpectedCount_(episodeText);

      return {
        rowNumber: startRow + index,
        workDate,
        channel,
        program,
        episodeText,
        arrivalKey: makeArrivalKey_(workDate, channel, program, episodeText),
        expectedCount: enteredExpected || parsedExpected || null,
        expectedKnown: Boolean(enteredExpected || parsedExpected),
      };
    })
    .filter(Boolean);
}

function matchArrival_(rules, scheduleRows, arrival) {
  const haystack = normalizeSearch_([arrival.rawText, arrival.path, arrival.filename].join(' '));
  const episodeNumber = extractEpisodeNumber_(arrival);

  const directCandidates = scheduleRows.filter(row => keywordMatches_(haystack, row.program));
  const directMatch = pickScheduleMatch_(directCandidates, episodeNumber);
  if (directMatch) {
    return { method: '프로그램명', rule: null, scheduleRow: directMatch };
  }

  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (!keywordMatches_(haystack, rule.keyword)) continue;

    const candidates = scheduleRows.filter(row => scheduleMatchesRule_(row, rule));
    const ruleMatch = pickScheduleMatch_(candidates, episodeNumber);
    if (ruleMatch) {
      return { method: '예외규칙', rule, scheduleRow: ruleMatch };
    }

    return { method: '예외규칙', rule, scheduleRow: null };
  }

  return { method: '', rule: null, scheduleRow: null };
}

function pickScheduleMatch_(candidates, episodeNumber) {
  if (!candidates.length) return null;

  if (episodeNumber) {
    const episodeMatches = candidates.filter(row => episodeInRange_(episodeNumber, row.episodeText));
    if (episodeMatches.length === 1) return episodeMatches[0];
    if (episodeMatches.length > 1) return episodeMatches[0];
  }

  return candidates.length === 1 ? candidates[0] : null;
}

function scheduleMatchesRule_(row, rule) {
  if (rule.program && normalizeSearch_(row.program) !== normalizeSearch_(rule.program)) return false;
  if (rule.channel && normalizeSearch_(row.channel) !== normalizeSearch_(rule.channel)) return false;
  return Boolean(rule.program || rule.channel);
}

function keywordMatches_(haystack, keyword) {
  const variants = String(keyword || '')
    .split('|')
    .map(part => normalizeSearch_(part))
    .filter(Boolean);

  return variants.some(variant => haystack.indexOf(variant) !== -1);
}

function extractEpisodeNumber_(arrival) {
  const source = arrival.filename || inferFilename_(arrival.path) || '';
  const baseName = source.replace(/\.[^.]+$/, '');
  const match = baseName.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function episodeInRange_(episodeNumber, episodeText) {
  const normalized = String(episodeText || '').replace(/\s+/g, '').replace(/회/g, '');
  if (!normalized) return false;

  const range = normalized.match(/^(\d+)[~-](\d+)?/);
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : null;
    return episodeNumber >= start && (end === null || episodeNumber <= end);
  }

  const single = normalized.match(/^(\d+)/);
  return single ? episodeNumber === Number(single[1]) : false;
}

function parseExpectedCount_(episodeText) {
  const normalized = String(episodeText || '').replace(/\s+/g, '').replace(/회/g, '');
  const range = normalized.match(/^(\d+)[~-](\d+)$/);
  if (range) return Number(range[2]) - Number(range[1]) + 1;

  const openRange = normalized.match(/^(\d+)[~-]$/);
  if (openRange) return null;

  const single = normalized.match(/^(\d+)/);
  return single ? 1 : null;
}

function existingArrivals_(sheet, arrivalKey) {
  const headers = headerMap_(sheet);
  const lastRow = sheet.getLastRow();
  const arrivals = {};
  if (lastRow < DATA_START_ROW) return arrivals;

  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, sheet.getLastColumn()).getValues();
  values.forEach(row => {
    const key = row[headers['입고키'] - 1];
    const filename = row[headers['파일명'] - 1];
    const duplicate = String(row[headers['중복여부'] - 1] || '').trim().toUpperCase();
    const occurredAt = row[headers['발생시간'] - 1];
    if (key === arrivalKey && filename && duplicate !== 'Y') {
      arrivals[String(filename)] = occurredAt instanceof Date ? occurredAt : parseKoreanDateTime_(String(occurredAt));
    }
  });

  return arrivals;
}

function existingArrivalsByKey_(sheet) {
  const headers = headerMap_(sheet);
  const lastRow = sheet.getLastRow();
  const arrivalsByKey = {};
  if (lastRow < DATA_START_ROW) return arrivalsByKey;

  const values = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, sheet.getLastColumn()).getValues();
  values.forEach(row => {
    const key = row[headers['입고키'] - 1];
    const filename = row[headers['파일명'] - 1];
    const duplicate = String(row[headers['중복여부'] - 1] || '').trim().toUpperCase();
    const occurredAt = row[headers['발생시간'] - 1];
    if (!key || !filename || duplicate === 'Y') return;

    if (!arrivalsByKey[key]) arrivalsByKey[key] = {};
    arrivalsByKey[key][String(filename)] = occurredAt instanceof Date
      ? occurredAt
      : parseKoreanDateTime_(String(occurredAt));
  });

  return arrivalsByKey;
}

function appendLog_(sheet, arrival, options) {
  const headers = headerMap_(sheet);
  const row = Math.max(sheet.getLastRow() + 1, DATA_START_ROW);
  const values = new Array(sheet.getLastColumn()).fill('');

  values[headers['수신시각'] - 1] = new Date();
  values[headers['입고키'] - 1] = options.arrivalKey || '';
  values[headers['매칭상태'] - 1] = options.matchStatus || '';
  values[headers['매칭방식'] - 1] = options.matchMethod || '';
  values[headers['규칙키워드'] - 1] = options.ruleKeyword || '';
  values[headers['프로그램'] - 1] = options.program || '';
  values[headers['회차'] - 1] = options.episodeText || '';
  values[headers['파일명'] - 1] = arrival.filename || '';
  values[headers['경로'] - 1] = arrival.path || '';
  values[headers['발생시간'] - 1] = arrival.occurredAt || '';
  values[headers['텔레그램채팅'] - 1] = arrival.chatTitle || '';
  values[headers['메시지ID'] - 1] = arrival.messageId || '';
  values[headers['중복여부'] - 1] = options.duplicate ? 'Y' : '';
  values[headers['원문'] - 1] = arrival.rawText || '';

  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  sheet.getRange(row, headers['수신시각']).setNumberFormat(DATE_FORMAT);
  sheet.getRange(row, headers['입고키']).setNumberFormat('@');
  sheet.getRange(row, headers['회차']).setNumberFormat('@');
  sheet.getRange(row, headers['파일명']).setNumberFormat('@');
  if (arrival.occurredAt) sheet.getRange(row, headers['발생시간']).setNumberFormat(DATE_FORMAT);
}

function appendReview_(sheet, arrival, options) {
  if (!sheet) return;

  const headers = headerMap_(sheet);
  const row = Math.max(sheet.getLastRow() + 1, DATA_START_ROW);
  const values = new Array(sheet.getLastColumn()).fill('');

  const telegramName = guessTelegramProgramName_(arrival);

  values[headers['텔레그램명칭'] - 1] = telegramName;
  values[headers['파일명'] - 1] = arrival.filename || '';
  values[headers['경로'] - 1] = arrival.path || '';
  values[headers['발생시간'] - 1] = arrival.occurredAt || '';
  values[headers['편성표선택'] - 1] = '';
  values[headers['처리상태'] - 1] = '대기';
  values[headers['메모'] - 1] = '';
  values[headers['그룹키'] - 1] = normalizeSearch_(telegramName || options.guessedKeyword || arrival.path);
  values[headers['원문'] - 1] = arrival.rawText || '';

  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  if (arrival.occurredAt) sheet.getRange(row, headers['발생시간']).setNumberFormat(TIME_FORMAT);
}

function applyReviewSelection_(reviewRowNumber, selectedLabel) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reviewSheet = ss.getSheetByName(SHEETS.REVIEW);
  const rulesSheet = ss.getSheetByName(SHEETS.RULES);
  const headers = headerMap_(reviewSheet);
  reviewSheet.getRange(reviewRowNumber, headers['처리상태']).setValue('처리중');
  reviewSheet.getRange(reviewRowNumber, headers['메모']).setValue('선택한 편성표로 적용 중');

  try {
    const selectedSchedule = findScheduleByLabel_(ss, selectedLabel);

    if (!selectedSchedule) {
      reviewSheet.getRange(reviewRowNumber, headers['처리상태']).setValue('선택오류');
      reviewSheet.getRange(reviewRowNumber, headers['메모']).setValue(`편성표에서 찾을 수 없음: ${selectedLabel}`);
      return;
    }

    const rowValues = reviewSheet.getRange(reviewRowNumber, 1, 1, reviewSheet.getLastColumn()).getValues()[0];
    const groupKey = String(rowValues[headers['그룹키'] - 1] || '').trim();
    const telegramName = String(rowValues[headers['텔레그램명칭'] - 1] || '').trim();

    const rowsToApply = groupKey ? findReviewRowsByGroup_(reviewSheet, headers, groupKey) : [reviewRowNumber];
    rowsToApply.forEach(rowNumber => {
      applySingleReviewRow_(ss, reviewSheet, headers, rowNumber, selectedSchedule, telegramName, selectedLabel, rowNumber === reviewRowNumber);
    });

    if (telegramName) upsertRule_(rulesSheet, telegramName, selectedSchedule);

    refreshDashboard_(ss);
  } catch (err) {
    reviewSheet.getRange(reviewRowNumber, headers['처리상태']).setValue('선택오류');
    reviewSheet.getRange(reviewRowNumber, headers['메모']).setValue(`검수 적용 실패: ${String(err)}`);
  }
}

function findReviewRowsByGroup_(reviewSheet, headers, groupKey) {
  if (!groupKey) return [];

  const lastRow = reviewSheet.getLastRow();
  if (lastRow < DATA_START_ROW) return [];

  const values = reviewSheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, reviewSheet.getLastColumn()).getValues();
  return values
    .map((row, index) => ({ row, rowNumber: DATA_START_ROW + index }))
    .filter(item => String(item.row[headers['그룹키'] - 1] || '').trim() === groupKey)
    .filter(item => !['적용완료', '중복'].includes(String(item.row[headers['처리상태'] - 1] || '').trim()))
    .map(item => item.rowNumber);
}

function applySingleReviewRow_(ss, reviewSheet, headers, rowNumber, selectedSchedule, telegramName, selectedLabel, useSelectedSchedule) {
  const logSheet = ss.getSheetByName(SHEETS.LOG);
  const rowValues = reviewSheet.getRange(rowNumber, 1, 1, reviewSheet.getLastColumn()).getValues()[0];
  const arrival = reviewRowToArrival_(rowValues, headers);
  const schedule = useSelectedSchedule ? selectedSchedule : resolveScheduleForReview_(ss, selectedSchedule, arrival);

  if (!schedule) {
    reviewSheet.getRange(rowNumber, headers['처리상태']).setValue('선택오류');
    reviewSheet.getRange(rowNumber, headers['메모']).setValue(`회차에 맞는 편성표를 찾을 수 없음: ${selectedLabel}`);
    return;
  }

  if (!arrival.filename) {
    reviewSheet.getRange(rowNumber, headers['처리상태']).setValue('선택오류');
    reviewSheet.getRange(rowNumber, headers['메모']).setValue('파일명이 없어 입고로그에 반영할 수 없음');
    return;
  }

  const previous = existingArrivals_(logSheet, schedule.arrivalKey);
  const duplicate = Object.prototype.hasOwnProperty.call(previous, arrival.filename);
  if (!duplicate) {
    appendLog_(logSheet, arrival, {
      arrivalKey: schedule.arrivalKey,
      matchStatus: '검수매칭',
      matchMethod: '수동검수',
      ruleKeyword: telegramName,
      program: schedule.program,
      episodeText: schedule.episodeText,
      duplicate: false,
    });
  }

  refreshSchedule_(ss, schedule.arrivalKey);

  reviewSheet.getRange(rowNumber, headers['편성표선택']).setValue(scheduleSelectionLabel_(schedule));
  reviewSheet.getRange(rowNumber, headers['처리상태']).setValue(duplicate ? '중복' : '적용완료');
  reviewSheet.getRange(rowNumber, headers['메모']).setValue(
    duplicate
      ? `이미 반영된 파일: ${arrival.filename}`
      : `입고 반영: ${arrival.filename} → ${schedule.program} ${schedule.episodeText}`
  );
}

function resolveScheduleForReview_(ss, selectedSchedule, arrival) {
  const episodeNumber = extractEpisodeNumber_(arrival);
  const candidates = readSchedule_(ss.getSheetByName(SHEETS.SCHEDULE))
    .filter(row => normalizeText_(row.program) === normalizeText_(selectedSchedule.program))
    .filter(row => normalizeText_(row.channel) === normalizeText_(selectedSchedule.channel));

  const episodeMatch = pickScheduleMatch_(candidates, episodeNumber);
  return episodeMatch || selectedSchedule;
}

function reviewRowToArrival_(rowValues, headers) {
  const occurredAt = rowValues[headers['발생시간'] - 1];
  const rawText = String(rowValues[headers['원문'] - 1] || '');
  const parsed = parseArrival_(rawText);
  return {
    filename: String(rowValues[headers['파일명'] - 1] || (parsed && parsed.filename) || '').trim(),
    path: String(rowValues[headers['경로'] - 1] || (parsed && parsed.path) || '').trim(),
    occurredAt: parsed && parsed.occurredAt ? parsed.occurredAt : occurredAt,
    rawText,
    chatTitle: '미매칭검수',
    messageId: `review-${new Date().getTime()}`,
  };
}

function upsertRule_(rulesSheet, telegramName, scheduleRow) {
  if (!telegramName) return;

  const headers = headerMap_(rulesSheet);
  const lastRow = rulesSheet.getLastRow();
  const values = lastRow >= DATA_START_ROW
    ? rulesSheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, rulesSheet.getLastColumn()).getValues()
    : [];

  const normalizedTelegramName = normalizeText_(telegramName);
  const existingIndex = values.findIndex(row =>
    normalizeText_(row[headers['텔레그램키워드'] - 1]) === normalizedTelegramName
  );

  const rowValues = new Array(rulesSheet.getLastColumn()).fill('');
  rowValues[headers['활성'] - 1] = 'Y';
  rowValues[headers['우선순위'] - 1] = 10;
  rowValues[headers['텔레그램키워드'] - 1] = telegramName;
  rowValues[headers['프로그램'] - 1] = scheduleRow.program;
  rowValues[headers['채널'] - 1] = scheduleRow.channel;
  rowValues[headers['비고'] - 1] = `미매칭검수 자동등록 ${formatCellDate_(new Date())}`;

  const targetRow = existingIndex === -1 ? Math.max(rulesSheet.getLastRow() + 1, DATA_START_ROW) : DATA_START_ROW + existingIndex;
  rulesSheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
}

function findScheduleByLabel_(ss, selectedLabel) {
  const scheduleRows = readSchedule_(ss.getSheetByName(SHEETS.SCHEDULE));
  const normalizedLabel = normalizeSelectionLabel_(selectedLabel);
  const exactMatch = scheduleRows.find(row => normalizeSelectionLabel_(scheduleSelectionLabel_(row)) === normalizedLabel);
  if (exactMatch) return exactMatch;

  const parts = parseSelectionLabel_(selectedLabel);
  if (!parts.program) return null;

  return scheduleRows.find(row =>
    normalizeText_(row.program) === normalizeText_(parts.program) &&
    normalizeText_(row.episodeText) === normalizeText_(parts.episodeText) &&
    (!parts.workDate || normalizeText_(row.workDate) === normalizeText_(parts.workDate)) &&
    (!parts.channel || normalizeText_(row.channel) === normalizeText_(parts.channel))
  ) || null;
}

function normalizeSelectionLabel_(label) {
  return String(label || '')
    .split('|')
    .map(part => part.trim())
    .join('|');
}

function parseSelectionLabel_(label) {
  const parts = String(label || '').split('|').map(part => part.trim());
  return {
    workDate: parts[0] || '',
    channel: parts[1] || '',
    program: parts[2] || '',
    episodeText: parts[3] || '',
  };
}

function refreshPicklist_(ss) {
  let picklistSheet = ss.getSheetByName(SHEETS.PICKLIST);
  if (!picklistSheet) {
    picklistSheet = ss.insertSheet(SHEETS.PICKLIST);
  }

  picklistSheet.clearContents();
  picklistSheet.getRange(1, 1, 1, 6).setValues([['편성표선택', '작업일', '채널', '프로그램', '회차', '입고키']]);
  const scheduleSheet = ss.getSheetByName(SHEETS.SCHEDULE);
  if (scheduleSheet) {
    const rows = readSchedule_(scheduleSheet)
      .slice(0, PICKLIST_MAX_ROWS - 1)
      .map(row => [
        scheduleSelectionLabel_(row),
        row.workDate,
        row.channel,
        row.program,
        row.episodeText,
        row.arrivalKey,
      ]);
    if (rows.length) {
      picklistSheet.getRange(2, 1, rows.length, 6).setValues(rows);
    }
  }
  picklistSheet.hideSheet();
}

function applyReviewValidation_(ss) {
  const reviewSheet = ss.getSheetByName(SHEETS.REVIEW);
  const picklistSheet = ss.getSheetByName(SHEETS.PICKLIST);
  if (!reviewSheet || !picklistSheet) return;

  const headers = headerMap_(reviewSheet);
  const dataRows = reviewSheet.getMaxRows() - 1;
  if (dataRows <= 0) return;

  reviewSheet.getRange(DATA_START_ROW, 1, dataRows, reviewSheet.getLastColumn()).clearDataValidations();

  const selectionColumn = headers['편성표선택'];
  if (selectionColumn) {
    const selectionRule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(picklistSheet.getRange(DATA_START_ROW, 1, PICKLIST_MAX_ROWS - 1, 1), true)
      .setAllowInvalid(false)
      .build();
    reviewSheet.getRange(DATA_START_ROW, selectionColumn, dataRows, 1).setDataValidation(selectionRule);
  }

  const statusColumn = headers['처리상태'];
  if (statusColumn) {
    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['대기', '처리중', '적용완료', '중복', '선택오류'], true)
      .setAllowInvalid(true)
      .build();
    reviewSheet.getRange(DATA_START_ROW, statusColumn, dataRows, 1).setDataValidation(statusRule);
  }
}

function applyRulesValidation_(ss) {
  const rulesSheet = ss.getSheetByName(SHEETS.RULES);
  if (!rulesSheet) return;

  const headers = headerMap_(rulesSheet);
  const dataRows = rulesSheet.getMaxRows() - 1;
  if (dataRows <= 0) return;

  rulesSheet.getRange(DATA_START_ROW, 1, dataRows, rulesSheet.getLastColumn()).clearDataValidations();

  const activeColumn = headers['활성'];
  if (activeColumn) {
    const activeRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Y', 'N'], true)
      .setAllowInvalid(false)
      .build();
    rulesSheet.getRange(DATA_START_ROW, activeColumn, dataRows, 1).setDataValidation(activeRule);
  }
}

function groupReviewRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= DATA_START_ROW) return;

  const headers = headerMap_(sheet);
  sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, sheet.getLastColumn())
    .sort([
      { column: headers['처리상태'], ascending: true },
      { column: headers['그룹키'], ascending: true },
      { column: headers['텔레그램명칭'], ascending: true },
    ]);
}

function scheduleSelectionLabel_(row) {
  return `${row.workDate} | ${row.channel} | ${row.program} | ${row.episodeText}`;
}

function refreshSchedule_(ss, arrivalKey) {
  const scheduleSheet = ss.getSheetByName(SHEETS.SCHEDULE);
  const logSheet = ss.getSheetByName(SHEETS.LOG);
  const headers = headerMap_(scheduleSheet);
  const scheduleRows = readSchedule_(scheduleSheet);
  const target = scheduleRows.find(row => row.arrivalKey === arrivalKey);
  if (!target) return { status: '편성표없음', receivedCount: 0, expectedLabel: '?' };

  const arrivals = existingArrivals_(logSheet, arrivalKey);
  const entries = Object.entries(arrivals);
  const receivedCount = entries.length;
  const latest = entries.sort((a, b) => b[1].getTime() - a[1].getTime())[0] || ['', null];
  const status = decideStatus_(receivedCount, target.expectedCount, target.expectedKnown);

  const row = target.rowNumber;
  if (headers['예상파일수']) scheduleSheet.getRange(row, headers['예상파일수']).setValue(target.expectedCount || '');
  if (headers['입고파일수']) scheduleSheet.getRange(row, headers['입고파일수']).setValue(receivedCount);
  if (headers['상태']) scheduleSheet.getRange(row, headers['상태']).setValue(status);
  if (headers['마지막파일명']) scheduleSheet.getRange(row, headers['마지막파일명']).setValue(latest[0] || '');

  if (headers['파일입고시간']) {
    const arrivalCell = scheduleSheet.getRange(row, headers['파일입고시간']);
    if (status === '완료') {
      arrivalCell.setValue(formatTime_(latest[1]));
    } else {
      arrivalCell.clearContent();
    }
  }

  const lastReceivedHeader = headers['마지막수신시각'];
  if (lastReceivedHeader) {
    const lastReceivedCell = scheduleSheet.getRange(row, lastReceivedHeader);
    if (latest[1]) {
      lastReceivedCell.setValue(latest[1]);
      lastReceivedCell.setNumberFormat(DATE_FORMAT);
    } else {
      lastReceivedCell.clearContent();
    }
  }

  return {
    status,
    receivedCount,
    expectedLabel: target.expectedKnown ? String(target.expectedCount) : '확인필요',
  };
}

function decideStatus_(receivedCount, expectedCount, expectedKnown) {
  if (!expectedKnown) return '확인필요';
  if (receivedCount >= expectedCount) return '완료';
  if (receivedCount > 0) return '입고중';
  return '미입고';
}

function refreshDashboard_(ss) {
  const dashboardSheet = ss.getSheetByName(SHEETS.DASHBOARD);
  const scheduleRows = readSchedule_(ss.getSheetByName(SHEETS.SCHEDULE));
  const scheduleSheet = ss.getSheetByName(SHEETS.SCHEDULE);
  const logSheet = ss.getSheetByName(SHEETS.LOG);
  const headers = headerMap_(scheduleSheet);
  const arrivalsByKey = existingArrivalsByKey_(logSheet);

  const rows = scheduleRows.map(row => {
    const sheetRow = scheduleSheet.getRange(row.rowNumber, 1, 1, scheduleSheet.getLastColumn()).getValues()[0];
    const arrivals = arrivalsByKey[row.arrivalKey] || {};
    return {
      label: `${row.program} ${row.episodeText}`,
      expected: row.expectedKnown ? row.expectedCount : '',
      received: Object.keys(arrivals).length,
      status: headers['상태']
        ? sheetRow[headers['상태'] - 1]
        : decideStatus_(Object.keys(arrivals).length, row.expectedCount, row.expectedKnown),
      arrivedAt: headers['파일입고시간'] ? sheetRow[headers['파일입고시간'] - 1] : '',
    };
  });

  dashboardSheet.getRange('B2').setValue(rows.length);
  dashboardSheet.getRange('B3').setValue(rows.filter(row => row.status === '완료').length);
  dashboardSheet.getRange('B4').setValue(rows.filter(row => row.status === '입고중').length);
  dashboardSheet.getRange('B5').setValue(rows.filter(row => row.status === '미입고').length);
  dashboardSheet.getRange('B6').setValue(rows.filter(row => row.status === '확인필요' || row.status === '미매칭').length);
  dashboardSheet.getRange('B7').setValue(new Date()).setNumberFormat(DATE_FORMAT);

  dashboardSheet.getRange(2, 4, dashboardSheet.getMaxRows() - 1, 5).clearContent();
  if (!rows.length) return;

  const tableValues = rows.map(row => [row.label, row.expected || '', row.received || 0, row.status || '', row.arrivedAt || '']);
  dashboardSheet.getRange(2, 4, tableValues.length, 5).setValues(tableValues);
}

function maybeRefreshDashboard_(ss) {
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  const last = Number(props.getProperty('LAST_DASHBOARD_REFRESH_MS') || 0);
  if (now - last < DASHBOARD_REFRESH_INTERVAL_MS) return;

  refreshDashboard_(ss);
  props.setProperty('LAST_DASHBOARD_REFRESH_MS', String(now));
}

function makeArrivalKey_(workDate, channel, program, episodeText) {
  return [workDate, channel, program, episodeText].map(value => String(value || '').trim()).join('|');
}

function formatCellDate_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value || '').trim();
}

function formatTime_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : parseKoreanDateTime_(String(value));
  return Utilities.formatDate(date, Session.getScriptTimeZone(), TIME_FORMAT);
}

function headerMap_(sheet) {
  return headerInfo_(sheet).headers;
}

function dataStartRow_(sheet) {
  return headerInfo_(sheet).row + 1;
}

function headerInfo_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const scanRows = Math.min(Math.max(sheet.getLastRow(), 1), HEADER_SCAN_ROWS);
  const values = sheet.getRange(1, 1, scanRows, lastColumn).getValues();
  const expectedHeaders = ['작업일', '채널', '프로그램', '회차', '회차/묶음', '상태', '파일입고시간', '파일명', '경로', '발생시간', '편성표선택'];

  let best = { row: HEADER_ROW, score: -1, headers: {} };
  values.forEach((row, rowIndex) => {
    const headers = row.reduce((map, value, index) => {
      if (!value) return map;
      const trimmed = String(value).trim();
      const compact = normalizeHeaderName_(trimmed);
      map[trimmed] = index + 1;
      map[compact] = index + 1;
      return map;
    }, {});
    const score = expectedHeaders.filter(header => headers[header]).length;
    if (score > best.score) {
      best = { row: rowIndex + 1, score, headers };
    }
  });

  return best;
}

function normalizeHeaderName_(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function legacyHeaderMap_(sheet) {
  const headers = sheet.getRange(HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.reduce((map, value, index) => {
    if (value) {
      const trimmed = String(value).trim();
      map[trimmed] = index + 1;
      map[normalizeHeaderName_(trimmed)] = index + 1;
    }
    return map;
  }, {});
}

function guessKeyword_(arrival) {
  const parts = String(arrival.path || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => part.indexOf('.') === -1);

  return parts.slice(-3).join(' / ');
}

function guessTelegramProgramName_(arrival) {
  const parts = String(arrival.path || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => part.indexOf('.') === -1);

  const ignored = ['HYKMEDIA', '시리즈', '영상', '입고', '완료', '완료본', '방송본', 'NEWS', 'SPORTS'];
  const candidates = parts.filter(part =>
    ignored.map(value => normalizeText_(value)).indexOf(normalizeText_(part)) === -1
  );

  return (candidates[candidates.length - 1] || parts[parts.length - 1] || '').trim();
}

function normalizeText_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeSearch_(value) {
  return normalizeText_(value).replace(/[^0-9a-zA-Z가-힣]/g, '');
}

function getChatTitle_(chat) {
  if (!chat) return '';
  return chat.title || chat.username || String(chat.id || '');
}

function makeMessageKey_(update, message) {
  const chat = message.chat || {};
  const chatId = chat.id || getChatTitle_(chat) || 'unknown_chat';
  const messageId = message.message_id || 'unknown_message';
  return `${chatId}:${messageId}`;
}

function isProcessedMessage_(messageKey) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('PROCESSED_MESSAGE_KEYS') || '[]';
  const keys = JSON.parse(raw);
  return keys.indexOf(messageKey) !== -1;
}

function markProcessedMessage_(messageKey) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('PROCESSED_MESSAGE_KEYS') || '[]';
  const keys = JSON.parse(raw);
  keys.push(messageKey);

  const uniqueKeys = [...new Set(keys)].slice(-1000);
  props.setProperty('PROCESSED_MESSAGE_KEYS', JSON.stringify(uniqueKeys));
}

function clearProcessedMessageKeys() {
  PropertiesService.getScriptProperties().deleteProperty('PROCESSED_MESSAGE_KEYS');
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService
    .createTextOutput('TVING webhook is alive')
    .setMimeType(ContentService.MimeType.TEXT);
}
