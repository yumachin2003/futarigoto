import { collection, doc, writeBatch } from "firebase/firestore";

/**
 * CSV Helper for Futarigoto
 * Handles parsing, encoding detection (UTF-8 / Shift-JIS), normalization,
 * template generation, and CSV export.
 */

/**
 * Read a File object as text, automatically handling UTF-8 (with or without BOM) and Shift-JIS
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function readCsvFileAsText(file) {
  const buffer = await file.arrayBuffer();

  // Try UTF-8 with fatal check
  try {
    const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
    return utf8Decoder.decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    // If invalid UTF-8 byte sequences found, try Shift-JIS (standard for Japanese Excel CSV)
    try {
      const sjisDecoder = new TextDecoder("shift-jis");
      return sjisDecoder.decode(buffer);
    } catch {
      // Fallback
      const fallbackDecoder = new TextDecoder("utf-8");
      return fallbackDecoder.decode(buffer).replace(/^\uFEFF/, "");
    }
  }
}

/**
 * Parses RFC 4180 compliant CSV string into a 2D array of strings
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsvText(text) {
  const cleanText = text.replace(/^\uFEFF/, "");
  const rows = [];
  let currentRow = [];
  let currentCell = "";
  let insideQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentCell += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++; // skip \n in CRLF
      }
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Normalizes number strings (removes yen symbols, commas, spaces)
 * @param {any} val
 * @returns {number}
 */
export function parseNumber(val) {
  if (val === null || val === undefined || val === "") return 0;
  const str = String(val).replace(/[¥￥,\s]/g, "");
  const num = parseFloat(str);
  return isNaN(num) ? 0 : Math.round(num);
}

/**
 * Normalizes dates to YYYY-MM-DD
 * Supports: YYYY/MM/DD, YYYY-MM-DD, YYYY.MM.DD, YYYY年MM月DD日, Excel serial numbers
 * @param {string|number} rawDate
 * @returns {string}
 */
export function normalizeDate(rawDate) {
  if (!rawDate) return new Date().toISOString().split("T")[0];

  const str = String(rawDate).trim();

  // Excel serial date number check (e.g., 45383)
  if (/^\d{5}$/.test(str)) {
    const serial = Number(str);
    const dateObj = new Date(Math.round((serial - 25569) * 86400 * 1000));
    if (!isNaN(dateObj.getTime())) {
      return dateObj.toISOString().split("T")[0];
    }
  }

  // Regex matching YYYY/MM/DD or YYYY-MM-DD or YYYY.MM.DD or YYYY年MM月DD日
  const match = str.match(/^(\d{4})[-/./年](\d{1,2})[-/./月](\d{1,2})日?$/);
  if (match) {
    const y = match[1];
    const m = match[2].padStart(2, "0");
    const d = match[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // If already standard ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // Fallback to JS Date parsing
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  return new Date().toISOString().split("T")[0];
}

/**
 * Normalizes payer string into 'yuma' | 'hanon'
 * @param {string} val
 * @param {string} defaultPayer
 * @returns {'yuma'|'hanon'}
 */
export function normalizePayer(val, defaultPayer = "yuma") {
  if (!val) return defaultPayer;
  const s = String(val).trim().toLowerCase();
  if (/yuma|ゆうま|悠真|ゆう|ユウマ|男/.test(s)) return "yuma";
  if (/hanon|はのん|羽音|ハノン|はの|女/.test(s)) return "hanon";
  return defaultPayer;
}

/**
 * Parses 2D CSV array into expense objects ready for Firestore
 * @param {string[][]} rows
 * @param {Object} options
 * @param {'yuma'|'hanon'} [options.defaultPayer='yuma']
 * @param {'csv'|'force_unsettled'|'force_settled'} [options.settleMode='csv']
 * @returns {{ expenses: any[], totalRows: number, validCount: number, errorCount: number }}
 */
export function parseExpenseRows(rows, options = {}) {
  const { defaultPayer = "yuma", settleMode = "csv" } = options;

  if (!rows || rows.length < 2) {
    return { expenses: [], totalRows: 0, validCount: 0, errorCount: 0 };
  }

  const rawHeaders = rows[0].map((h) => h.trim());
  const headerMap = {};

  rawHeaders.forEach((h, idx) => {
    const lower = h.toLowerCase().replace(/[\s_()（）|｜]/g, "");

    if (/^(日付|購入日|利用日|利用日付|date)$/.test(lower)) headerMap.date = idx;
    else if (/^(店舗購入品目|店舗|購入品目|店名|店舗名|品目|項目|内容|摘要|摘要名|store|item|title|name)$/.test(lower)) headerMap.store = idx;
    else if (/^(支払者?|支払い?|立替者?|立替|支払人|payer|who)$/.test(lower)) headerMap.payer = idx;
    // Partner amounts
    else if (/^(相手分内税|相手内税|相手分税込|相手税込|partnerintax)$/.test(lower)) headerMap.pInTax = idx;
    else if (/^(相手分8%?|相手8%?|相手分8|partnertax8)$/.test(lower)) headerMap.pTax8 = idx;
    else if (/^(相手分10%?|相手10%?|相手分10|partnertax10)$/.test(lower)) headerMap.pTax10 = idx;
    else if (/^(相手分?|相手負担|相手金額|partner|partneramount)$/.test(lower)) headerMap.pGeneral = idx;
    // Shared amounts
    else if (/^(共有内税|共有分内税|共有税込|共有分税込|sharedintax)$/.test(lower)) headerMap.sInTax = idx;
    else if (/^(共有8%?|共有分8%?|共有8|sharedtax8)$/.test(lower)) headerMap.sTax8 = idx;
    else if (/^(共有10%?|共有分10%?|共有10|sharedtax10)$/.test(lower)) headerMap.sTax10 = idx;
    else if (/^(共有分?|共有物品|折半|折半分|shared|sharedamount)$/.test(lower)) headerMap.sGeneral = idx;
    // Settled status
    else if (/^(精算済|精算|状態|ステータス|issettled|settled|status)$/.test(lower)) headerMap.settled = idx;
  });

  const expenses = [];
  let validCount = 0;
  let errorCount = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    // Skip empty lines
    if (!row || row.length === 0 || row.every((c) => !c.trim())) continue;

    const rawDate = headerMap.date !== undefined ? row[headerMap.date] : "";
    const rawStore = headerMap.store !== undefined ? row[headerMap.store] : "";
    const rawPayer = headerMap.payer !== undefined ? row[headerMap.payer] : "";
    const rawSettled = headerMap.settled !== undefined ? row[headerMap.settled] : "";

    const date = normalizeDate(rawDate);
    const store = (rawStore || "").trim();
    const payer = normalizePayer(rawPayer, defaultPayer);

    const partnerAmounts = {
      inTax: parseNumber(headerMap.pInTax !== undefined ? row[headerMap.pInTax] : (headerMap.pGeneral !== undefined ? row[headerMap.pGeneral] : 0)),
      tax8: parseNumber(headerMap.pTax8 !== undefined ? row[headerMap.pTax8] : 0),
      tax10: parseNumber(headerMap.pTax10 !== undefined ? row[headerMap.pTax10] : 0),
    };

    const sharedAmounts = {
      inTax: parseNumber(headerMap.sInTax !== undefined ? row[headerMap.sInTax] : (headerMap.sGeneral !== undefined ? row[headerMap.sGeneral] : 0)),
      tax8: parseNumber(headerMap.sTax8 !== undefined ? row[headerMap.sTax8] : 0),
      tax10: parseNumber(headerMap.sTax10 !== undefined ? row[headerMap.sTax10] : 0),
    };

    let isSettled;
    if (settleMode === "force_settled") {
      isSettled = true;
    } else if (settleMode === "force_unsettled") {
      isSettled = false;
    } else {
      isSettled = /^(済|精算済|完了|true|1|yes|y|○)$/i.test((rawSettled || "").trim());
    }

    const pTotal = Math.round(partnerAmounts.inTax + partnerAmounts.tax8 * 1.08 + partnerAmounts.tax10 * 1.1);
    const sTotal = Math.round(sharedAmounts.inTax + sharedAmounts.tax8 * 1.08 + sharedAmounts.tax10 * 1.1);
    const totalAmount = pTotal + sTotal;

    const errors = [];
    if (!store) errors.push("店舗名がありません");
    if (totalAmount === 0) errors.push("金額が0円です");

    const isValid = errors.length === 0;
    if (isValid) validCount++;
    else errorCount++;

    expenses.push({
      rowIndex: r,
      date,
      store: store || "（店舗名未入力）",
      payer,
      partnerAmounts,
      sharedAmounts,
      isSettled,
      pTotal,
      sTotal,
      totalAmount,
      isValid,
      errors,
    });
  }

  return {
    expenses,
    totalRows: expenses.length,
    validCount,
    errorCount,
  };
}

/**
 * Generates sample CSV string for downloading template
 * @returns {string}
 */
export function generateCsvTemplate() {
  const headers = [
    "日付",
    "店舗｜購入品目",
    "支払者",
    "相手分(内税)",
    "相手分(8%)",
    "相手分(10%)",
    "共有(内税)",
    "共有(8%)",
    "共有(10%)",
    "精算済",
  ];

  const sampleRows = [
    ["2026-10-25", "ツルヤ｜食材まとめ買い", "ゆうま", "0", "3200", "450", "0", "0", "0", "未"],
    ["2026-10-26", "マツモトキヨシ｜日用品", "はのん", "0", "0", "0", "0", "0", "1850", "未"],
    ["2026-10-27", "スターバックス｜コーヒー", "ゆうま", "650", "0", "0", "0", "0", "0", "未"],
  ];

  const csvContent = [
    headers.join(","),
    ...sampleRows.map((r) => r.map((c) => (c.includes(",") ? `"${c}"` : c)).join(",")),
  ].join("\r\n");

  // UTF-8 BOM so Excel opens Japanese characters cleanly
  return "\uFEFF" + csvContent;
}

/**
 * Exports current expense records to a CSV file download
 * @param {any[]} expenses
 */
export function exportExpensesToCsv(expenses) {
  const headers = [
    "日付",
    "店舗｜購入品目",
    "支払者",
    "相手分(内税)",
    "相手分(8%)",
    "相手分(10%)",
    "共有(内税)",
    "共有(8%)",
    "共有(10%)",
    "精算済",
  ];

  const rows = (expenses || []).map((ex) => {
    const payerLabel = ex.payer === "hanon" ? "はのん" : "ゆうま";
    const settledLabel = ex.isSettled ? "済" : "未";
    const storeEscaped = `"${(ex.store || "").replace(/"/g, '""')}"`;

    return [
      ex.date || "",
      storeEscaped,
      payerLabel,
      ex.partnerAmounts?.inTax ?? 0,
      ex.partnerAmounts?.tax8 ?? 0,
      ex.partnerAmounts?.tax10 ?? 0,
      ex.sharedAmounts?.inTax ?? 0,
      ex.sharedAmounts?.tax8 ?? 0,
      ex.sharedAmounts?.tax10 ?? 0,
      settledLabel,
    ].join(",");
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
  a.href = url;
  a.download = `futarigoto_expenses_${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Downloads the template CSV file
 */
export function downloadCsvTemplate() {
  const csvContent = generateCsvTemplate();
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "futarigoto_template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Imports parsed expenses to Firestore in chunks using writeBatch
 * @param {any} db - Firestore database instance
 * @param {any[]} expenses - Array of parsed expense objects
 * @returns {Promise<number>} Number of successfully imported items
 */
export async function importExpensesToFirestore(db, expenses) {
  const validExpenses = expenses.filter((ex) => ex.isValid);
  if (validExpenses.length === 0) return 0;

  const chunkSize = 400; // Firestore batch limit is 500
  const now = Date.now();
  let totalImported = 0;

  for (let i = 0; i < validExpenses.length; i += chunkSize) {
    const chunk = validExpenses.slice(i, i + chunkSize);
    const batch = writeBatch(db);

    chunk.forEach((item, idx) => {
      const docRef = doc(collection(db, "expenses"));
      batch.set(docRef, {
        date: item.date,
        store: item.store,
        payer: item.payer,
        partnerAmounts: item.partnerAmounts,
        sharedAmounts: item.sharedAmounts,
        isSettled: Boolean(item.isSettled),
        // Stagger createdAt slightly to preserve chronological ordering
        createdAt: now - (validExpenses.length - (i + idx)) * 10,
      });
    });

    await batch.commit();
    totalImported += chunk.length;
  }

  return totalImported;
}
