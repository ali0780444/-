/**
 * ======================================================================================
 * نظام إدارة الموارد البشرية المتكامل - V29 (Session Fix, Repetitions, Profile Dates)
 * ======================================================================================
 */

const CONFIG = {
  SHEET_EMPLOYEES: "الموظفون",
  SHEET_FINES: "الغرامات",
  SHEET_BONUSES: "المكافآت",
  SHEET_RATIOS: "النسب",
  SHEET_ATTENDANCE: "أوقات الدوام",
  SHEET_DETAILS: "التفاصيل",
  SHEET_SEND_QUEUE: "قائمة الإرسال",
  SHEET_EDIT_REQUESTS: "طلبات التعديل",
  
  FOLDER_OBJECTIONS: "Objection_Images_System", 
  TELEGRAM_TOKEN: "8479073382:AAFlz4PgAGrNxUh976CFbKdw79Bsk3cu954", 
  
  // فهارس الأعمدة (ثابتة - لا تغيرها)
  TRANS_COL_ID: 0, TRANS_COL_FP: 1, TRANS_COL_NAME: 2, TRANS_COL_SECTION: 3,
  TRANS_COL_TYPE: 4, TRANS_COL_AMOUNT: 5, TRANS_COL_REASON: 6, TRANS_COL_DUE_DATE: 7,
  TRANS_COL_GEN_CLASS: 8, TRANS_COL_SPE_CLASS: 9, TRANS_COL_GROUP: 10, 
  TRANS_COL_SEND_TIME: 11, TRANS_COL_ADDED_BY: 12, TRANS_COL_TIMESTAMP: 13,
  TRANS_COL_OBJ_STATUS: 14, TRANS_COL_OBJ_REASON: 15, TRANS_COL_OBJ_IMG: 16, 
  TRANS_COL_HR_RESPONSE: 17, TRANS_COL_HR_USER: 18, TRANS_COL_IS_FOLLOWED: 19
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return createJSONOutput("error", "النظام مشغول");

  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    // التحقق الأولي وإنشاء بيانات تجريبية عند الحاجة
    checkAndCreateDummyData();

    if (action === "login") return handleLogin(data);
    if (action === "get_emp_info") return getEmployeeInfo(data.fp);
    if (action === "get_details") return getDetailsData();
    
    if (action === "save_bulk") return saveBulkTransactions(data);
    
    if (action === "get_my_added") return getMyAddedTransactions(data);
    if (action === "get_my_received") return getMyReceivedTransactions(data);
    if (action === "get_my_attendance") return getMyAttendance(data);
    if (action === "submit_objection") return submitObjection(data);
    if (action === "request_edit") return saveEditRequest(data);
    
    if (action === "get_hr_monitoring_filtered") return getHRMonitoringFiltered(data);
    if (action === "hr_action") return processHRAction(data);
    if (action === "batch_confirm_followup") return batchConfirmFollowup(data);
    if (action === "delete_transaction") return deleteTransaction(data);
    
    if (action === "get_emp_full_profile") return getEmployeeFullProfile(data);
    if (action === "get_edit_requests") return getEditRequests();
    if (action === "hr_edit_action") return processEditRequestAction(data);
    if (action === "manage_users") return manageUsers(data);

    return createJSONOutput("error", "Invalid Action");
  } catch (error) {
    return createJSONOutput("error", error.toString());
  } finally {
    lock.releaseLock();
  }
}

// --- Helper Functions & Logic ---

function tafqeet(n) {
  const num = parseInt(n);
  if (num === 0) return "صفر";
  const map = {
    1000: "ألف", 2000: "ألفين", 3000: "ثلاثة آلاف", 4000: "أربعة آلاف", 5000: "خمسة آلاف",
    10000: "عشرة آلاف", 25000: "خمسة وعشرون ألف", 50000: "خمسون ألف", 75000: "خمسة وسبعون ألف",
    100000: "مائة ألف", 150000: "مائة وخمسون ألف", 200000: "مائتا ألف", 250000: "مائتان وخمسون ألف"
  };
  return map[num] || num.toString();
}

function constructTelegramMessage(row, amount, mode) {
  const amtTxt = tafqeet(amount);
  const formattedAmount = `(${amount} - ${amtTxt} دينار عراقي)`;
  const dueDateStr = row.dueDate ? Utilities.formatDate(new Date(row.dueDate), "GMT+3", "yyyy-MM-dd HH:mm") : "غير محدد";
  const entryDateStr = Utilities.formatDate(new Date(), "GMT+3", "yyyy-MM-dd HH:mm");

  let title = mode === 'fine' ? "استقطاع مبلغ قدره" : (mode === 'bonus' ? "إضافة مكافأة قدرها" : "تسجيل نسبة قدرها");
  let context = mode === 'fine' ? "من مكافآت الموظف" : "للموظف";
  if(row.type === 'تنبيه') { title = "توجيه تنبيه إداري"; context = "للموظف"; }

  return `
<b>${title} ${row.type === 'تنبيه' ? '' : formattedAmount} ${context}:</b>
${row.name}
(بصمة: ${row.fp} - قسم: ${row.section})

📝 <b>السبب:</b> ${row.reason}
📅 <b>تاريخ الاستحقاق:</b> ${dueDateStr}
🕒 <b>تاريخ التنزيل:</b> ${entryDateStr}
👤 <b>قام بالإضافة:</b> ${row.addedBy}
....................
<b>إشعار للجميع:</b>
نود التذكير بأنه في حالة تجاوز مجموع الاستقطاعات من المكافآت مبلغ (50000 خمسين ألف دينار)، يمكن الاستفادة من طريقة التخفيض التي تم الإعلان عنها.
`;
}

function saveBulkTransactions(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheetName = CONFIG.SHEET_FINES;
  if(data.mode === 'bonus') sheetName = CONFIG.SHEET_BONUSES; 
  if(data.mode === 'ratio') sheetName = CONFIG.SHEET_RATIOS;
  
  const sheet = ss.getSheetByName(sheetName);
  const queueSheet = ss.getSheetByName(CONFIG.SHEET_SEND_QUEUE);
  const now = new Date();
  
  data.rows.forEach(r => {
    if(!r.fp || !r.name || (!r.amount && r.amount !== 0)) return;

    const uid = Utilities.getUuid();
    const dueDate = r.dueDate ? new Date(r.dueDate) : now;
    const sendTime = r.sendTime ? new Date(r.sendTime) : now;

    sheet.appendRow([
      uid, r.fp, r.name, r.section, r.type, r.amount, r.reason, 
      dueDate, r.genClass, r.speClass, r.groupName, 
      sendTime, data.addedBy, now,
      "", "", "", "", "", "لا"
    ]);
    
    const msg = constructTelegramMessage({
       fp: r.fp, section: r.section, name: r.name, reason: r.reason, 
       dueDate: dueDate, addedBy: data.addedBy, type: r.type
    }, r.amount, data.mode);
    
    queueSheet.appendRow(["Pending", sendTime, r.groupID, msg, uid, ""]);
  });
  
  return createJSONOutput("success", "تم حفظ البيانات وجدولتها");
}

function processQueue() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_SEND_QUEUE);
  const rows = sheet.getDataRange().getValues();
  let processed = 0;
  const now = new Date();

  for (let i = 1; i < rows.length; i++) {
    if (processed >= 15) break; 
    if (rows[i][0] === "Pending") {
      const scheduledTime = new Date(rows[i][1]);
      if (now.getTime() >= scheduledTime.getTime()) {
        const res = sendToTelegramDirect(rows[i][2], rows[i][3]);
        sheet.getRange(i + 1, 1).setValue(res.success ? "Sent" : "Error");
        sheet.getRange(i + 1, 6).setValue(new Date());
        processed++;
      }
    }
  }
}

function sendToTelegramDirect(chatId, text) {
  try {
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`;
    const response = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML", disable_web_page_preview: true }),
      muteHttpExceptions: true
    });
    return { success: JSON.parse(response.getContentText()).ok };
  } catch(e) { return { success: false }; }
}

// --- HR Monitoring (Fixed Repetitions) ---
function getHRMonitoringFiltered(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let allData = [];
  const stats = { 'total': 0, 'pending': 0, 'accepted': 0, 'rejected': 0, 'specialClasses': {} };

  const fromDate = data.dateFrom ? new Date(data.dateFrom).setHours(0,0,0,0) : null;
  const toDate = data.dateTo ? new Date(data.dateTo).setHours(23,59,59,999) : null;
  const targetSpeClass = data.speClass ? data.speClass.trim() : "";

  // 1. بناء خريطة التكرارات العالمية (Global Repetitions Map)
  // المفتاح: البصمة + التصنيف الخاص
  const repetitionMap = {}; 
  const sheets = [{n:CONFIG.SHEET_FINES,t:'fine'},{n:CONFIG.SHEET_BONUSES,t:'bonus'},{n:CONFIG.SHEET_RATIOS,t:'ratio'}];

  sheets.forEach(s => {
      const sh = ss.getSheetByName(s.n);
      if(sh && sh.getLastRow() > 1) {
          const vals = sh.getDataRange().getValues();
          for(let k=1; k<vals.length; k++) {
              const fp = String(vals[k][CONFIG.TRANS_COL_FP]).trim();
              const sp = String(vals[k][CONFIG.TRANS_COL_SPE_CLASS] || "").trim();
              if(sp) {
                  const key = fp + "_" + sp;
                  repetitionMap[key] = (repetitionMap[key] || 0) + 1;
              }
          }
      }
  });

  // 2. الفلترة وجلب البيانات
  sheets.forEach(s => {
    const sh = ss.getSheetByName(s.n);
    if(sh && sh.getLastRow() > 1) {
      const rows = sh.getDataRange().getValues();
      for(let i=1; i<rows.length; i++) {
        const entryTime = new Date(rows[i][CONFIG.TRANS_COL_TIMESTAMP]).getTime();
        const objStatus = rows[i][CONFIG.TRANS_COL_OBJ_STATUS] || "لا يوجد";
        const speClass = String(rows[i][CONFIG.TRANS_COL_SPE_CLASS] || "").trim();
        const fp = String(rows[i][CONFIG.TRANS_COL_FP]).trim();

        let include = true;
        
        // منطق التاريخ: إذا اعتراضات لا نهتم بالتاريخ، إلا إذا حدده المستخدم
        if (data.isObjectionOnly) {
           // نعرض كل الاعتراضات بغض النظر عن التاريخ
           if(objStatus !== 'قيد المراجعة' && objStatus !== 'مقبول' && objStatus !== 'مرفوض') include = false;
        } else {
           // للمتابعة: التاريخ مطلوب
           if(!fromDate && !toDate) include = false; 
           else {
               if (fromDate && entryTime < fromDate) include = false;
               if (toDate && entryTime > toDate) include = false;
           }
        }
        
        if (targetSpeClass && speClass !== targetSpeClass) include = false;

        if (include) {
          stats.total++;
          if(objStatus === 'قيد المراجعة') stats.pending++;
          if(objStatus === 'مقبول') stats.accepted++;
          if(objStatus === 'مرفوض') stats.rejected++;
          if(speClass) stats.specialClasses[speClass] = (stats.specialClasses[speClass] || 0) + 1;

          // جلب التكرار من الخريطة العالمية
          const repCount = speClass ? (repetitionMap[fp + "_" + speClass] || 0) : 0;

          allData.push({
            id: rows[i][CONFIG.TRANS_COL_ID], sheetType: s.t,
            fp: fp, name: rows[i][CONFIG.TRANS_COL_NAME], section: rows[i][CONFIG.TRANS_COL_SECTION],
            type: rows[i][CONFIG.TRANS_COL_TYPE], amount: rows[i][CONFIG.TRANS_COL_AMOUNT], 
            reason: rows[i][CONFIG.TRANS_COL_REASON], speClass: speClass,
            dueDate: formatDateSafe(rows[i][CONFIG.TRANS_COL_DUE_DATE]),
            entryDate: formatDateSafe(rows[i][CONFIG.TRANS_COL_TIMESTAMP]),
            sender: rows[i][CONFIG.TRANS_COL_ADDED_BY],
            objStatus: objStatus, objReason: rows[i][CONFIG.TRANS_COL_OBJ_REASON], objImg: rows[i][CONFIG.TRANS_COL_OBJ_IMG],
            isFollowed: rows[i][CONFIG.TRANS_COL_IS_FOLLOWED] || "لا",
            repetitionCount: repCount 
          });
        }
      }
    }
  });
  return createJSONOutput("success", "Data", { data: allData, stats: stats });
}

function batchConfirmFollowup(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const updates = data.updates;
  let count = 0;
  const grouped = {};
  updates.forEach(u => { if(!grouped[u.sheetType]) grouped[u.sheetType] = []; grouped[u.sheetType].push(u.id); });

  Object.keys(grouped).forEach(type => {
      let sName = CONFIG.SHEET_FINES;
      if(type === 'bonus') sName = CONFIG.SHEET_BONUSES;
      if(type === 'ratio') sName = CONFIG.SHEET_RATIOS;
      const sheet = ss.getSheetByName(sName);
      const rows = sheet.getDataRange().getValues();
      for(let i=1; i<rows.length; i++) {
          if(grouped[type].includes(String(rows[i][CONFIG.TRANS_COL_ID]))) {
              sheet.getRange(i+1, CONFIG.TRANS_COL_IS_FOLLOWED + 1).setValue("نعم");
              count++;
          }
      }
  });
  return createJSONOutput("success", `تم حفظ التغييرات لـ ${count} سجل`);
}

function processHRAction(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sName = CONFIG.SHEET_FINES;
  if (data.sheetType === 'bonus') sName = CONFIG.SHEET_BONUSES;
  if (data.sheetType === 'ratio') sName = CONFIG.SHEET_RATIOS;
  
  const sheet = ss.getSheetByName(sName);
  const rows = sheet.getDataRange().getValues();
  
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][CONFIG.TRANS_COL_ID]) == data.id) {
      const rIdx = i + 1;
      sheet.getRange(rIdx, CONFIG.TRANS_COL_HR_RESPONSE + 1).setValue(data.response);
      sheet.getRange(rIdx, CONFIG.TRANS_COL_HR_USER + 1).setValue(data.hrUser);
      
      if (data.status === "متابعة") {
          sheet.getRange(rIdx, CONFIG.TRANS_COL_OBJ_STATUS + 1).setValue("قيد المراجعة");
          if (data.followGroupId) {
              const rData = rows[i];
              let msg = `⚠️ <b>إحالة للمتابعة الإدارية</b>\n👤 <b>الموظف:</b> ${rData[CONFIG.TRANS_COL_NAME]}\n📅 <b>الاستحقاق:</b> ${formatDateSafe(rData[CONFIG.TRANS_COL_DUE_DATE])}\n🛑 <b>السبب:</b> ${rData[CONFIG.TRANS_COL_REASON]}\n🗣️ <b>الاعتراض:</b> ${rData[CONFIG.TRANS_COL_OBJ_REASON]}\n💬 <b>توجيه HR:</b> ${data.response}`;
              if (rData[CONFIG.TRANS_COL_OBJ_IMG]) msg += `\n📎 <a href="${rData[CONFIG.TRANS_COL_OBJ_IMG]}">مرفق</a>`;
              ss.getSheetByName(CONFIG.SHEET_SEND_QUEUE).appendRow(["Pending", new Date(), data.followGroupId, msg, data.id, ""]);
          }
      } else {
          sheet.getRange(rIdx, CONFIG.TRANS_COL_OBJ_STATUS + 1).setValue(data.status);
      }
      return createJSONOutput("success", "Done");
    }
  }
  return createJSONOutput("error", "NF");
}

function submitObjection(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = CONFIG.SHEET_FINES;
  if(d.sheetType=='bonus') s = CONFIG.SHEET_BONUSES;
  if(d.sheetType=='ratio') s = CONFIG.SHEET_RATIOS;
  
  const sh = ss.getSheetByName(s);
  const r = sh.getDataRange().getValues();
  
  for(let i=1; i<r.length; i++) {
    if(String(r[i][CONFIG.TRANS_COL_ID]) == d.id) {
      if(r[i][CONFIG.TRANS_COL_OBJ_STATUS] && r[i][CONFIG.TRANS_COL_OBJ_STATUS]!="لا يوجد") return createJSONOutput("error","مكرر");
      
      let url = "";
      // معالجة رفع الصورة بشكل سليم
      if(d.imageBase64) {
        try {
          const f = getOrCreateFolder(CONFIG.FOLDER_OBJECTIONS);
          const blob = Utilities.newBlob(Utilities.base64Decode(d.imageBase64.split(',')[1]), d.imageBase64.substring(5,d.imageBase64.indexOf(';')), "OBJ_"+d.id+".jpg");
          const file = f.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          url = file.getUrl();
        } catch(e) { /* Log Error */ }
      }
      
      sh.getRange(i+1, CONFIG.TRANS_COL_OBJ_STATUS+1).setValue("قيد المراجعة");
      sh.getRange(i+1, CONFIG.TRANS_COL_OBJ_REASON+1).setValue(d.reason);
      sh.getRange(i+1, CONFIG.TRANS_COL_OBJ_IMG+1).setValue(url); // حفظ الرابط
      return createJSONOutput("success", "تم");
    }
  }
  return createJSONOutput("error", "NF");
}

// --- Profile & Dates Fix ---
function formatDateSafe(val) {
  if (!val) return "-";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  if (d.getFullYear() < 2000) return "-"; 
  return Utilities.formatDate(d, "GMT+3", "yyyy-MM-dd");
}

function formatTimeSafe(val) {
  if (!val) return "-";
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val); // إذا كان نصاً، ارجعه كما هو
  // تجاهل السنة، فقط ارجع الوقت
  return Utilities.formatDate(d, "GMT+3", "hh:mm a");
}

function getMyAttendance(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const s = ss.getSheetByName(CONFIG.SHEET_ATTENDANCE);
  const r = [];
  if(s) {
    const rows = s.getDataRange().getValues();
    for(let i=1; i<rows.length; i++) {
      if(String(rows[i][0]) == d.fp) {
        // ترتيب الأعمدة في الشيت: 0:بصمة, 1:قسم, 2:اسم, 3:تاريخ_دخول, 4:وقت_دخول, 5:تاريخ_خروج, 6:وقت_خروج, 7:فعلي
        const dateIn = rows[i][3];
        const timeIn = rows[i][4];
        const timeOut = rows[i][6];
        const dur = rows[i][7];

        r.push({
          date: formatDateSafe(dateIn), // عمود التاريخ فقط
          in: formatTimeSafe(timeIn),   // عمود الوقت فقط
          out: formatTimeSafe(timeOut), // عمود الوقت فقط
          dur: formatTimeSafe(dur)      // عمود الوقت فقط
        });
      }
    }
  }
  return createJSONOutput("success", "Att", r);
}

// --- Base Functions ---
function handleLogin(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rows = ss.getSheetByName(CONFIG.SHEET_EMPLOYEES).getDataRange().getDisplayValues();
  const c = String(d.code).trim().toLowerCase();
  const f = String(d.fp).trim();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() == c && String(rows[i][1]).trim() == f) {
      return createJSONOutput("success", "OK", {
        name: rows[i][3], section: rows[i][2],
        perms: { fine: rows[i][4]=='نعم', bonus: rows[i][5]=='نعم', ratio: rows[i][6]=='نعم', hr: rows[i][7]=='نعم', admin: rows[i][8]=='نعم' }
      });
    }
  }
  return createJSONOutput("error", "بيانات خاطئة");
}
function getEmployeeInfo(fp){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const rows=ss.getSheetByName(CONFIG.SHEET_EMPLOYEES).getDataRange().getValues();
  for(let i=1;i<rows.length;i++) {
    if(String(rows[i][1]) == String(fp)) return createJSONOutput("success","Found",{name:rows[i][3], section:rows[i][2]});
  }
  return createJSONOutput("error","Not Found");
}
function getDetailsData(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const data=ss.getSheetByName(CONFIG.SHEET_DETAILS).getDataRange().getDisplayValues();
  let m={}, g=[], fg=[];
  for(let i=1;i<data.length;i++){
    const r=data[i];
    if(r[0]){ if(!m[r[0]]) m[r[0]]=[]; if(r[1]&&!m[r[0]].includes(r[1])) m[r[0]].push(r[1]); }
    if(r[2] && r[3]) g.push({name:r[2],id:r[3],type:r[6]?String(r[6]).trim():"غرامة"});
    if(r[4]&&r[5]&&!fg.some(x=>x.id==r[5])) fg.push({name:r[4],id:r[5]});
  }
  return createJSONOutput("success","Data",{mapping:m,groups:g,followGroups:fg});
}
function getOrCreateFolder(n){const f=DriveApp.getFoldersByName(n);return f.hasNext()?f.next():DriveApp.createFolder(n);}
function createJSONOutput(r,m,d=null){return ContentService.createTextOutput(JSON.stringify({result:r,message:m,data:d})).setMimeType(ContentService.MimeType.JSON);}
function getMyAddedTransactions(d){return getTransactions(d.userName,null,'added');}
function getMyReceivedTransactions(d){return getTransactions(null,d.fp,'received');}
function getTransactions(u,f,m){const ss=SpreadsheetApp.getActiveSpreadsheet();const res=[];[{n:CONFIG.SHEET_FINES,t:'fine'},{n:CONFIG.SHEET_BONUSES,t:'bonus'},{n:CONFIG.SHEET_RATIOS,t:'ratio'}].forEach(s=>{const sh=ss.getSheetByName(s.n);const r=sh.getDataRange().getValues();for(let i=r.length-1;i>=1;i--){let match=false;if(m=='added'&&String(r[i][CONFIG.TRANS_COL_ADDED_BY])==u)match=true;if(m=='received'&&String(r[i][CONFIG.TRANS_COL_FP])==f)match=true;if(match)res.push({id:r[i][0],sheetType:s.t,fp:r[i][1],name:r[i][2],type:r[i][4],amount:r[i][5],reason:r[i][6],date:formatDateSafe(r[i][7]),objStatus:r[i][14]||"لا يوجد"});}});return createJSONOutput("success","Data",res);}
function deleteTransaction(d){const ss=SpreadsheetApp.getActiveSpreadsheet();let s=CONFIG.SHEET_FINES;if(d.sheetType=='bonus')s=CONFIG.SHEET_BONUSES;if(d.sheetType=='ratio')s=CONFIG.SHEET_RATIOS;const sh=ss.getSheetByName(s);const r=sh.getDataRange().getValues();for(let i=1;i<r.length;i++)if(String(r[i][0])==d.id){sh.deleteRow(i+1);return createJSONOutput("success","تم");}return createJSONOutput("error","NF");}
function saveEditRequest(d){const ss=SpreadsheetApp.getActiveSpreadsheet();ss.getSheetByName(CONFIG.SHEET_EDIT_REQUESTS).appendRow(["REQ-"+Math.floor(Math.random()*9999),d.sheetType,d.id,d.requester,d.reqType,d.reason,"-","قيد الانتظار",new Date()]);return createJSONOutput("success","تم");}
function getEditRequests(){const ss=SpreadsheetApp.getActiveSpreadsheet();const r=ss.getSheetByName(CONFIG.SHEET_EDIT_REQUESTS).getDataRange().getValues();const res=[];for(let i=1;i<r.length;i++)res.push({reqId:r[i][0],sheetType:r[i][1],transId:r[i][2],requester:r[i][3],type:r[i][4],reason:r[i][5],original:r[i][6],status:r[i][7]});return createJSONOutput("success","Data",res);}
function processEditRequestAction(d){const ss=SpreadsheetApp.getActiveSpreadsheet();const sh=ss.getSheetByName(CONFIG.SHEET_EDIT_REQUESTS);const r=sh.getDataRange().getValues();for(let i=1;i<r.length;i++)if(String(r[i][0])==d.reqId){sh.getRange(i+1,8).setValue(d.status);return createJSONOutput("success","Done");}return createJSONOutput("error","NF");}
function manageUsers(d){const ss=SpreadsheetApp.getActiveSpreadsheet();const sh=ss.getSheetByName(CONFIG.SHEET_EMPLOYEES);if(d.subAction=='get_all'){const r=sh.getDataRange().getValues();const u=[];for(let i=1;i<r.length;i++)u.push({row:i+1,code:r[i][0],fp:r[i][1],sec:r[i][2],name:r[i][3],pFine:r[i][4],pBonus:r[i][5],pRatio:r[i][6],pHR:r[i][7],pAdmin:r[i][8]});return createJSONOutput("success","Data",u);}if(d.subAction=='add'){sh.appendRow([d.userData.code,d.userData.fp,d.userData.sec,d.userData.name,d.userData.pFine,d.userData.pBonus,d.userData.pRatio,d.userData.pHR,d.userData.pAdmin,"لا"]);return createJSONOutput("success","Added");}if(d.subAction=='delete'){sh.deleteRow(parseInt(d.row));return createJSONOutput("success","Deleted");}}
function getEmployeeFullProfile(d){return createJSONOutput("success","Data",getTransactions(null,d.searchFP,'received').getContent());}

// --- Dummy Data Setup (Run Once Automatically) ---
function checkAndCreateDummyData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const s = ss.getSheetByName(CONFIG.SHEET_EMPLOYEES);
  if(!s || s.getLastRow() < 2) {
    // إعداد أولي سريع إذا كانت البيانات فارغة
    setupSheet(ss, CONFIG.SHEET_EMPLOYEES, ["الرمز","البصمة","القسم","الاسم","غرامات","مكافآت","نسب","HR","Admin","حذف"], [["E01","201","IT","محمد حسين","نعم","نعم","نعم","نعم","نعم","لا"]]);
    setupSheet(ss, CONFIG.SHEET_DETAILS, ["عام","خاص","اسم الجروب","ID الجروب","جروب المتابعة","ID المتابعة","النوع"], [["قوانين","تأخير","عقوبات","-100","متابعة","-100","غرامة"]]);
    setupSheet(ss, CONFIG.SHEET_FINES, ["ID","FP","Name","Section","Type","Amount","Reason","Date","Gen","Spe","Grp","SendTime","Added","Time","ObjStatus","ObjReason","Img","HRRes","HRUser","Followed"]);
    setupSheet(ss, CONFIG.SHEET_ATTENDANCE, ["البصمة","القسم","الاسم","تاريخ الدخول","وقت الدخول","تاريخ الخروج","وقت الخروج","الوقت الفعلي"], [["201","IT","محمد حسين",new Date(),new Date(),new Date(),new Date(),"08:00"]]);
  }
}
function setupSheet(ss, name, headers, dummy=[]) {
  let s = ss.getSheetByName(name);
  if(!s) { s = ss.insertSheet(name); s.appendRow(headers); if(dummy.length) dummy.forEach(r=>s.appendRow(r)); }
}